const { EventEmitter } = require('node:events');
const { generateKeyPairSync, randomUUID, timingSafeEqual } = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { Server, utils } = require('ssh2');
const { createDefaultState, createSession, LINUX_BUILTIN_COMMANDS, normalizeOutput } = require('./engines.cjs');

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  let rightBuffer = Buffer.from(String(right));
  const lengthMismatch = leftBuffer.length !== rightBuffer.length;
  if (lengthMismatch) rightBuffer = leftBuffer;
  return !lengthMismatch && timingSafeEqual(leftBuffer, rightBuffer);
}

const NETWORK_MODES = new Set(['any', 'user_exec', 'privileged_exec', 'global_config', 'interface_config']);
const AUTH_METHODS = new Set(['password', 'publickey', 'both']);
const BIND_HOSTS = new Set(['127.0.0.1', '0.0.0.0']);
const VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const RESERVED_VARIABLES = new Set(['command', 'hostname', 'instance', 'user', 'arg1', 'input']);
const PORT_SCAN_START = 2222;
const PORT_SCAN_LIMIT = 65535;

function normalizeInstanceError(error) {
  if (!error) return null;
  if (typeof error === 'string') {
    const portMatch = error.match(/(?:127\.0\.0\.1|localhost|::1)[: ](\d+)|address already in use .*:(\d+)/i);
    const port = Number(portMatch?.[1] ?? portMatch?.[2]);
    return {
      code: /EADDRINUSE|address already in use/i.test(error) ? 'PORT_IN_USE' : 'START_FAILED',
      message: error,
      technicalMessage: error,
      ...(Number.isInteger(port) ? { port } : {}),
      occurredAt: new Date().toISOString()
    };
  }
  return {
    code: typeof error.code === 'string' ? error.code : 'START_FAILED',
    message: String(error.message ?? error.technicalMessage ?? 'Instance failed to start'),
    technicalMessage: String(error.technicalMessage ?? error.message ?? 'Instance failed to start'),
    host: typeof error.host === 'string' ? error.host : undefined,
    port: Number.isInteger(error.port) ? error.port : undefined,
    suggestedPort: Number.isInteger(error.suggestedPort) ? error.suggestedPort : undefined,
    occurredAt: typeof error.occurredAt === 'string' ? error.occurredAt : new Date().toISOString()
  };
}

function createPortConflictError(host, port, suggestedPort, technicalMessage = '') {
  const error = new Error(`Listen address ${host}:${port} is already in use`);
  error.code = 'PORT_IN_USE';
  error.details = {
    host,
    port,
    suggestedPort: Number.isInteger(suggestedPort) ? suggestedPort : undefined,
    technicalMessage: technicalMessage || `EADDRINUSE: address already in use ${host}:${port}`
  };
  return error;
}

function isPortAvailable(host, port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
}

async function isEndpointAvailable(host, port) {
  if (host === '0.0.0.0' && !await isPortAvailable('127.0.0.1', port)) return false;
  return isPortAvailable(host, port);
}

function parseAuthorizedKey(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.length > 20000) throw new Error('Authorized public key is required and must not exceed 20000 characters');
  const parsed = utils.parseKey(normalized);
  if (parsed instanceof Error || Array.isArray(parsed)) throw new Error('Authorized public key is not a supported SSH public key');
  return normalized;
}

function normalizeStoredInstance(input) {
  const authorizedKeys = Array.isArray(input.authorizedKeys) ? input.authorizedKeys.filter((key) => typeof key === 'string' && key.trim()) : [];
  const inferredMethod = authorizedKeys.length ? (input.password ? 'both' : 'publickey') : 'password';
  return {
    ...input,
    host: BIND_HOSTS.has(input.host) ? input.host : '127.0.0.1',
    authMethod: AUTH_METHODS.has(input.authMethod) ? input.authMethod : inferredMethod,
    password: typeof input.password === 'string' ? input.password : '',
    authorizedKeys,
    lastError: normalizeInstanceError(input.lastError)
  };
}

function defaultVariables() {
  return [{
    id: 'default-su-password',
    name: 'SU_PASSWORD',
    value: 'monolith',
    secret: true,
    description: 'su password'
  }];
}

function normalizeVariable(input, index) {
  const name = String(input?.name ?? '').trim();
  if (!VARIABLE_NAME_PATTERN.test(name)) throw new Error(`Variable ${index + 1}: invalid name`);
  if (RESERVED_VARIABLES.has(name)) throw new Error(`Variable ${index + 1}: ${name} is reserved`);
  const value = String(input?.value ?? '');
  if (value.length > 10000) throw new Error(`Variable ${index + 1}: value exceeds 10000 characters`);
  const description = String(input?.description ?? '').trim();
  if (description.length > 300) throw new Error(`Variable ${index + 1}: description exceeds 300 characters`);
  return {
    id: typeof input.id === 'string' && input.id.length <= 100 ? input.id : randomUUID(),
    name,
    value,
    secret: input.secret === true,
    description
  };
}

function defaultCommandRules() {
  return [{
    id: 'default-linux-su',
    kind: 'linux',
    scope: 'type',
    instanceId: null,
    mode: 'shell',
    matchType: 'command',
    pattern: 'su',
    output: '',
    behavior: 'interactive',
    steps: [
      { id: 'su-input', type: 'input', prompt: 'Password:', secret: true, saveAs: 'password' },
      { id: 'su-verify', type: 'verify_variable', input: 'password', variable: 'SU_PASSWORD', failureOutput: 'su: Authentication failure' },
      { id: 'su-user', type: 'set_user', target: '{{arg1}}' },
      { id: 'su-finish', type: 'finish' }
    ],
    requiresArgument: true,
    enabled: true
  }];
}

function legacyInteractionSteps(input) {
  return [
    { type: 'input', prompt: input.inputPrompt ?? 'Password:', secret: input.inputSecret !== false, saveAs: 'input' },
    { type: 'verify_variable', input: 'input', variable: input.verifyVariable ?? '', failureOutput: input.failureOutput ?? 'Authentication failed' },
    { type: input.action === 'set_mode' ? 'set_mode' : 'set_user', target: input.target ?? '{{arg1}}' },
    ...(String(input.successOutput ?? '') ? [{ type: 'output', text: input.successOutput }] : []),
    { type: 'finish' }
  ];
}

function normalizeInteractionStep(input, stepIndex, ruleIndex, kind) {
  const label = `Rule ${ruleIndex + 1}, step ${stepIndex + 1}`;
  const type = String(input?.type ?? '');
  const id = typeof input?.id === 'string' && input.id.length <= 100 ? input.id : randomUUID();
  const text = (value, maximum, field) => {
    const normalized = String(value ?? '');
    if (normalized.length > maximum) throw new Error(`${label}: ${field} exceeds ${maximum} characters`);
    return normalized;
  };

  if (type === 'input') {
    const prompt = text(input.prompt ?? '', 200, 'prompt');
    const saveAs = String(input.saveAs ?? 'input').trim();
    if (!prompt) throw new Error(`${label}: input prompt is required`);
    if (!VARIABLE_NAME_PATTERN.test(saveAs)) throw new Error(`${label}: input name is invalid`);
    return { id, type, prompt, secret: input.secret === true, saveAs };
  }
  if (type === 'verify_variable') {
    const inputName = String(input.input ?? 'input').trim();
    const variable = String(input.variable ?? '').trim();
    if (!VARIABLE_NAME_PATTERN.test(inputName)) throw new Error(`${label}: input reference is invalid`);
    if (!VARIABLE_NAME_PATTERN.test(variable)) throw new Error(`${label}: verification variable is invalid`);
    return { id, type, input: inputName, variable, failureOutput: text(input.failureOutput ?? 'Authentication failed', 20000, 'failure output') };
  }
  if (type === 'verify_choice') {
    const inputName = String(input.input ?? 'input').trim();
    if (!VARIABLE_NAME_PATTERN.test(inputName)) throw new Error(`${label}: input reference is invalid`);
    const rawChoices = Array.isArray(input.choices) ? input.choices : String(input.choices ?? '').split(',');
    const choices = rawChoices.map((choice) => String(choice).trim()).filter(Boolean);
    if (!choices.length || choices.length > 20 || choices.some((choice) => choice.length > 100)) {
      throw new Error(`${label}: provide 1-20 valid choices`);
    }
    return { id, type, input: inputName, choices, caseSensitive: input.caseSensitive === true, failureOutput: text(input.failureOutput ?? 'Cancelled', 20000, 'failure output') };
  }
  if (type === 'set_user') {
    if (kind !== 'linux') throw new Error(`${label}: set_user only supports Linux rules`);
    return { id, type, target: text(input.target ?? '{{arg1}}', 200, 'target') };
  }
  if (type === 'set_mode') {
    if (kind !== 'network') throw new Error(`${label}: set_mode only supports network rules`);
    const target = String(input.target ?? 'privileged_exec');
    if (!NETWORK_MODES.has(target) || target === 'any') throw new Error(`${label}: target mode is invalid`);
    return { id, type, target };
  }
  if (type === 'output') return { id, type, text: text(input.text ?? '', 20000, 'output') };
  if (type === 'finish') return { id, type };
  throw new Error(`${label}: unsupported interaction step ${type || '(empty)'}`);
}

function normalizeCommandRule(input, index) {
  const kind = input?.kind === 'network' ? 'network' : input?.kind === 'linux' ? 'linux' : null;
  if (!kind) throw new Error(`Rule ${index + 1}: kind must be linux or network`);
  const matchType = ['exact', 'regex', 'command'].includes(input.matchType) ? input.matchType : null;
  if (!matchType) throw new Error(`Rule ${index + 1}: match type must be exact, command or regex`);
  const pattern = String(input.pattern ?? '').trim();
  if (!pattern || pattern.length > 200) throw new Error(`Rule ${index + 1}: pattern must contain 1-200 characters`);
  if (matchType === 'regex') {
    try {
      new RegExp(pattern, 'i');
    } catch (error) {
      throw new Error(`Rule ${index + 1}: invalid regular expression (${error.message})`);
    }
  }
  const output = String(input.output ?? '');
  if (output.length > 20000) throw new Error(`Rule ${index + 1}: output exceeds 20000 characters`);
  const requestedMode = String(input.mode ?? 'any');
  const mode = kind === 'linux' ? 'shell' : requestedMode;
  if (kind === 'network' && !NETWORK_MODES.has(mode)) throw new Error(`Rule ${index + 1}: unsupported network mode`);
  const scope = input.scope === 'instance' ? 'instance' : 'type';
  const instanceId = scope === 'instance' ? String(input.instanceId ?? '') : null;
  if (scope === 'instance' && (!instanceId || instanceId.length > 100)) {
    throw new Error(`Rule ${index + 1}: device-level rules require a valid instance ID`);
  }

  const behavior = input.behavior === 'interactive' ? 'interactive' : 'output';
  const rawSteps = Array.isArray(input.steps) ? input.steps : legacyInteractionSteps(input);
  if (behavior === 'interactive' && (!rawSteps.length || rawSteps.length > 20)) {
    throw new Error(`Rule ${index + 1}: interactive rules require 1-20 steps`);
  }
  const steps = behavior === 'interactive'
    ? rawSteps.map((step, stepIndex) => normalizeInteractionStep(step, stepIndex, index, kind))
    : [];
  const finishIndex = steps.findIndex((step) => step.type === 'finish');
  if (finishIndex >= 0 && finishIndex !== steps.length - 1) throw new Error(`Rule ${index + 1}: finish must be the final interaction step`);
  const capturedInputs = new Set();
  for (const [stepIndex, step] of steps.entries()) {
    if (step.type === 'input') capturedInputs.add(step.saveAs);
    if ((step.type === 'verify_variable' || step.type === 'verify_choice') && !capturedInputs.has(step.input)) {
      throw new Error(`Rule ${index + 1}, step ${stepIndex + 1}: input ${step.input} has not been collected`);
    }
  }

  return {
    id: typeof input.id === 'string' && input.id.length <= 100 ? input.id : randomUUID(),
    kind,
    scope,
    instanceId,
    mode,
    matchType,
    pattern,
    output,
    behavior,
    steps,
    requiresArgument: input.requiresArgument === true,
    enabled: input.enabled !== false
  };
}

class SimulatorService extends EventEmitter {
  constructor(dataDir) {
    super();
    this.dataDir = path.resolve(dataDir);
    this.instancesPath = path.join(this.dataDir, 'instances.json');
    this.auditPath = path.join(this.dataDir, 'audit.jsonl');
    this.rulesPath = path.join(this.dataDir, 'command-rules.json');
    this.featuresPath = path.join(this.dataDir, 'features.json');
    this.variablesPath = path.join(this.dataDir, 'variables.json');
    this.linuxBuiltinsPath = path.join(this.dataDir, 'linux-builtins.json');
    this.keysDir = path.join(this.dataDir, 'keys');
    this.statesDir = path.join(this.dataDir, 'states');
    this.instances = [];
    this.runtimes = new Map();
    this.auditEvents = [];
    this.commandRules = [];
    this.variables = [];
    this.disabledLinuxBuiltins = new Set();
  }

  async init() {
    fs.mkdirSync(this.keysDir, { recursive: true });
    fs.mkdirSync(this.statesDir, { recursive: true });
    this.instances = this.loadInstances();
    this.auditEvents = this.loadAudit();
    this.commandRules = this.loadCommandRules();
    this.variables = this.loadVariables();
    this.disabledLinuxBuiltins = this.loadDisabledLinuxBuiltins();

    for (const instance of this.instances.filter((item) => item.autoStart)) {
      try {
        await this.startInstance(instance.id);
      } catch (error) {
        if (!instance.lastError) instance.lastError = normalizeInstanceError(error);
      }
    }

    return this.listInstances();
  }

  loadInstances() {
    if (fs.existsSync(this.instancesPath)) {
      const stored = JSON.parse(fs.readFileSync(this.instancesPath, 'utf8'));
      if (!Array.isArray(stored)) throw new Error('Instances file must contain an array');
      const normalized = stored.map(normalizeStoredInstance);
      if (stored.some((instance) => !AUTH_METHODS.has(instance.authMethod))) {
        fs.writeFileSync(this.instancesPath, JSON.stringify(normalized, null, 2));
      }
      return normalized;
    }

    const now = new Date().toISOString();
    const defaults = [
      {
        id: 'network-lab-01',
        name: 'router-lab-01',
        kind: 'network',
        template: 'Cisco IOS · Virtual',
        host: '127.0.0.1',
        port: 2222,
        username: 'admin',
        password: 'monolith',
        authMethod: 'password',
        authorizedKeys: [],
        autoStart: true,
        createdAt: now
      },
      {
        id: 'linux-lab-01',
        name: 'linux-lab-01',
        kind: 'linux',
        template: 'Ubuntu 24.04 · Virtual',
        host: '127.0.0.1',
        port: 2223,
        username: 'root',
        password: 'monolith',
        authMethod: 'password',
        authorizedKeys: [],
        autoStart: true,
        createdAt: now
      }
    ];
    fs.writeFileSync(this.instancesPath, JSON.stringify(defaults, null, 2));
    return defaults;
  }

  saveInstances() {
    fs.writeFileSync(this.instancesPath, JSON.stringify(this.instances, null, 2));
  }

  loadAudit() {
    if (!fs.existsSync(this.auditPath)) return [];
    return fs.readFileSync(this.auditPath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-500)
      .map((line) => JSON.parse(line))
      .reverse();
  }

  loadCommandRules() {
    if (!fs.existsSync(this.rulesPath)) {
      const defaults = defaultCommandRules().map(normalizeCommandRule);
      fs.writeFileSync(this.rulesPath, JSON.stringify(defaults, null, 2));
      fs.writeFileSync(this.featuresPath, JSON.stringify({ interactiveRulesV1: true, interactionStepsV2: true }, null, 2));
      return defaults;
    }
    const stored = JSON.parse(fs.readFileSync(this.rulesPath, 'utf8'));
    if (!Array.isArray(stored)) throw new Error('Command rules file must contain an array');
    const rules = stored.map(normalizeCommandRule);
    const features = fs.existsSync(this.featuresPath)
      ? JSON.parse(fs.readFileSync(this.featuresPath, 'utf8'))
      : {};
    if (!features.interactiveRulesV1) {
      const alreadyHasSu = rules.some((rule) => rule.kind === 'linux' && rule.pattern.trim().toLowerCase() === 'su');
      if (!alreadyHasSu) rules.push(...defaultCommandRules().map(normalizeCommandRule));
      fs.writeFileSync(this.rulesPath, JSON.stringify(rules, null, 2));
      fs.writeFileSync(this.featuresPath, JSON.stringify({ ...features, interactiveRulesV1: true }, null, 2));
    }
    if (!features.interactionStepsV2) {
      fs.writeFileSync(this.rulesPath, JSON.stringify(rules, null, 2));
      fs.writeFileSync(this.featuresPath, JSON.stringify({ ...features, interactiveRulesV1: true, interactionStepsV2: true }, null, 2));
    }
    return rules;
  }

  loadVariables() {
    if (!fs.existsSync(this.variablesPath)) {
      const defaults = defaultVariables().map(normalizeVariable);
      fs.writeFileSync(this.variablesPath, JSON.stringify(defaults, null, 2));
      return defaults;
    }
    const stored = JSON.parse(fs.readFileSync(this.variablesPath, 'utf8'));
    if (!Array.isArray(stored)) throw new Error('Variables file must contain an array');
    return stored.map(normalizeVariable);
  }

  listVariables() {
    return this.variables.map((variable) => ({ ...variable }));
  }

  variableMap() {
    return Object.fromEntries(this.variables.map((variable) => [variable.name, variable.value]));
  }

  replaceVariables(input = {}) {
    const variables = Array.isArray(input) ? input : input.variables;
    if (!Array.isArray(variables)) throw new Error('Variables payload must contain a variables array');
    if (variables.length > 100) throw new Error('A maximum of 100 custom variables is supported');
    const normalized = variables.map(normalizeVariable);
    const names = new Set();
    for (const [index, variable] of normalized.entries()) {
      if (names.has(variable.name)) throw new Error(`Variable ${index + 1}: duplicate name ${variable.name}`);
      names.add(variable.name);
    }
    fs.writeFileSync(this.variablesPath, JSON.stringify(normalized, null, 2));
    this.variables = normalized;
    this.recordAudit({
      type: 'variables.update',
      ok: true,
      instanceId: 'variables',
      instanceName: 'variables',
      source: 'local',
      credentials: 'system',
      action: `Applied ${normalized.length} custom variables`
    });
    return this.listVariables();
  }

  loadDisabledLinuxBuiltins() {
    if (!fs.existsSync(this.linuxBuiltinsPath)) return new Set();
    const stored = JSON.parse(fs.readFileSync(this.linuxBuiltinsPath, 'utf8'));
    const disabled = Array.isArray(stored?.disabled) ? stored.disabled : [];
    const knownIds = new Set(LINUX_BUILTIN_COMMANDS.map((command) => command.id));
    return new Set(disabled.filter((id) => knownIds.has(id)));
  }

  saveDisabledLinuxBuiltins() {
    fs.writeFileSync(this.linuxBuiltinsPath, JSON.stringify({
      version: 1,
      disabled: [...this.disabledLinuxBuiltins].sort()
    }, null, 2));
  }

  listLinuxBuiltins() {
    return LINUX_BUILTIN_COMMANDS.map((command) => ({
      ...command,
      aliases: [...command.aliases],
      enabled: !this.disabledLinuxBuiltins.has(command.id)
    }));
  }

  deleteLinuxBuiltin(id) {
    const builtin = LINUX_BUILTIN_COMMANDS.find((command) => command.id === id);
    if (!builtin) throw new Error(`Unknown Linux built-in command: ${id}`);
    this.disabledLinuxBuiltins.add(id);
    this.saveDisabledLinuxBuiltins();
    this.recordAudit({
      type: 'builtins.delete',
      ok: true,
      instanceId: 'linux-builtins',
      instanceName: 'linux-builtins',
      source: 'local',
      credentials: 'system',
      action: `Disabled Linux built-in command: ${builtin.command}`
    });
    return this.listLinuxBuiltins();
  }

  enableLinuxBuiltin(id) {
    const builtin = LINUX_BUILTIN_COMMANDS.find((command) => command.id === id);
    if (!builtin) throw new Error(`Unknown Linux built-in command: ${id}`);
    this.disabledLinuxBuiltins.delete(id);
    this.saveDisabledLinuxBuiltins();
    this.recordAudit({
      type: 'builtins.enable',
      ok: true,
      instanceId: 'linux-builtins',
      instanceName: 'linux-builtins',
      source: 'mcp',
      credentials: 'system',
      action: `Enabled Linux built-in command: ${builtin.command}`
    });
    return this.listLinuxBuiltins();
  }

  restoreLinuxBuiltins() {
    const restored = this.disabledLinuxBuiltins.size;
    this.disabledLinuxBuiltins.clear();
    this.saveDisabledLinuxBuiltins();
    this.recordAudit({
      type: 'builtins.restore',
      ok: true,
      instanceId: 'linux-builtins',
      instanceName: 'linux-builtins',
      source: 'local',
      credentials: 'system',
      action: `Restored ${restored} Linux built-in commands`
    });
    return this.listLinuxBuiltins();
  }

  listCommandRules() {
    return this.commandRules.map((rule) => ({ ...rule, steps: rule.steps.map((step) => ({ ...step, choices: step.choices ? [...step.choices] : undefined })) }));
  }

  replaceCommandRules(input = {}) {
    const rules = Array.isArray(input) ? input : input.rules;
    if (!Array.isArray(rules)) throw new Error('Command rules payload must contain a rules array');
    if (rules.length > 100) throw new Error('A maximum of 100 custom command rules is supported');
    const normalized = rules.map(normalizeCommandRule);
    for (const [index, rule] of normalized.entries()) {
      if (rule.scope !== 'instance') continue;
      const instance = this.instances.find((item) => item.id === rule.instanceId);
      if (!instance) throw new Error(`Rule ${index + 1}: target instance does not exist`);
      if (instance.kind !== rule.kind) throw new Error(`Rule ${index + 1}: target instance type does not match the rule type`);
    }
    const variableNames = new Set(this.variables.map((variable) => variable.name));
    for (const [index, rule] of normalized.entries()) {
      const missingStep = rule.steps.find((step) => step.type === 'verify_variable' && !variableNames.has(step.variable));
      if (missingStep) throw new Error(`Rule ${index + 1}: verification variable ${missingStep.variable} does not exist`);
    }
    fs.writeFileSync(this.rulesPath, JSON.stringify(normalized, null, 2));
    this.commandRules = normalized;
    this.recordAudit({
      type: 'rules.update',
      ok: true,
      instanceId: 'command-rules',
      instanceName: 'command-rules',
      source: 'local',
      credentials: 'system',
      action: `Applied ${normalized.length} custom command rules`
    });
    return this.listCommandRules();
  }

  recordAudit(event) {
    const completeEvent = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...event
    };
    this.auditEvents.unshift(completeEvent);
    this.auditEvents = this.auditEvents.slice(0, 500);
    fs.appendFileSync(this.auditPath, `${JSON.stringify(completeEvent)}\n`);
    this.emit('audit', completeEvent);
    return completeEvent;
  }

  publicInstance(instance) {
    const runtime = this.runtimes.get(instance.id);
    return {
      id: instance.id,
      name: instance.name,
      kind: instance.kind,
      template: instance.template,
      host: instance.host,
      port: instance.port,
      address: `${instance.host}:${instance.port}`,
      username: instance.username,
      authMethod: instance.authMethod,
      authorizedKeyCount: instance.authorizedKeys.length,
      credentialHint: `${instance.username} · ${instance.authMethod}`,
      autoStart: instance.autoStart,
      running: Boolean(runtime),
      lastError: instance.lastError ?? null,
      createdAt: instance.createdAt
    };
  }

  listInstances() {
    return this.instances.map((instance) => this.publicInstance(instance));
  }

  getInstance(id) {
    const instance = this.instances.find((item) => item.id === id);
    if (!instance) throw new Error(`Unknown instance: ${id}`);
    return instance;
  }

  getConnection(id) {
    const instance = this.getInstance(id);
    if (!this.runtimes.has(id)) throw new Error(`${instance.name} is not running`);
    return {
      id: instance.id,
      name: instance.name,
      kind: instance.kind,
      host: instance.host === '0.0.0.0' ? '127.0.0.1' : instance.host,
      bindHost: instance.host,
      port: instance.port,
      username: instance.username,
      authMethod: instance.authMethod,
      password: instance.authMethod === 'password' || instance.authMethod === 'both' ? instance.password : undefined
    };
  }

  getInstanceAccess(id) {
    const instance = this.getInstance(id);
    return {
      id: instance.id,
      name: instance.name,
      host: instance.host,
      port: instance.port,
      address: `${instance.host}:${instance.port}`,
      username: instance.username,
      authMethod: instance.authMethod,
      password: instance.authMethod === 'password' || instance.authMethod === 'both' ? instance.password : null,
      authorizedKeys: [...instance.authorizedKeys]
    };
  }

  updateInstanceCredentials(id, input = {}) {
    const instance = this.getInstance(id);
    const username = input.username === undefined ? instance.username : String(input.username).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_-]{0,31}$/.test(username)) throw new Error('Username must contain 1-32 letters, numbers, underscores or hyphens');
    const authMethod = input.authMethod === undefined ? instance.authMethod : input.authMethod;
    if (!AUTH_METHODS.has(authMethod)) throw new Error('Authentication method must be password, publickey or both');
    const password = input.password === undefined ? instance.password : String(input.password);
    if ((authMethod === 'password' || authMethod === 'both') && (!password || password.length > 256)) {
      throw new Error('Password authentication requires a password of 1-256 characters');
    }
    if (input.authorizedKeys !== undefined && !Array.isArray(input.authorizedKeys)) throw new Error('Authorized keys must be an array');
    const authorizedKeys = input.authorizedKeys === undefined
      ? instance.authorizedKeys
      : input.authorizedKeys.map((key) => parseAuthorizedKey(key));
    if ((authMethod === 'publickey' || authMethod === 'both') && !authorizedKeys.length) {
      throw new Error('Public-key authentication requires at least one authorized public key');
    }
    instance.username = username;
    instance.authMethod = authMethod;
    instance.password = authMethod === 'publickey' ? '' : password;
    instance.authorizedKeys = authMethod === 'password' ? [] : authorizedKeys;
    this.saveInstances();
    this.recordAudit({
      type: 'instance.credentials',
      ok: true,
      instanceId: id,
      instanceName: instance.name,
      source: 'mcp',
      credentials: 'system',
      action: `Updated SSH authentication: ${authMethod}, user ${username}`
    });
    return this.publicInstance(instance);
  }

  executeInstanceCommand(id, command) {
    const instance = this.getInstance(id);
    const runtime = this.runtimes.get(id);
    if (!runtime) throw new Error(`${instance.name} is not running`);
    const rawCommand = String(command ?? '');
    if (!rawCommand.trim() || rawCommand.length > 10000) throw new Error('Command must contain 1-10000 characters');
    const engine = createSession(
      instance,
      runtime.state,
      () => this.saveState(instance, runtime.state),
      instance.username,
      () => this.commandRules,
      () => this.disabledLinuxBuiltins,
      () => this.variableMap()
    );
    const result = engine.execute(rawCommand);
    this.recordAudit({
      type: 'command',
      ok: true,
      instanceId: instance.id,
      instanceName: instance.name,
      source: 'mcp',
      credentials: 'system',
      action: rawCommand
    });
    return {
      output: result.output ?? '',
      clear: result.clear === true,
      exit: result.exit === true,
      requiresInput: result.awaitInput === true,
      prompt: result.awaitInput ? result.prompt : engine.prompt()
    };
  }

  async findAvailablePort(start = PORT_SCAN_START, excludedInstanceId = null, host = '127.0.0.1') {
    const configuredPorts = new Set(this.instances
      .filter((instance) => instance.id !== excludedInstanceId)
      .map((instance) => instance.port));
    const firstPort = Number.isInteger(start) ? Math.max(1024, start) : PORT_SCAN_START;
    for (let port = firstPort; port <= PORT_SCAN_LIMIT; port += 1) {
      if (configuredPorts.has(port)) continue;
      if (await isEndpointAvailable(host, port)) return port;
    }
    throw new Error('No available local TCP port was found');
  }

  async getPortStatus(id) {
    const instance = this.getInstance(id);
    if (this.runtimes.has(id)) {
      return { available: false, occupiedBySelf: true, host: instance.host, port: instance.port, suggestedPort: null };
    }
    const available = await isEndpointAvailable(instance.host, instance.port);
    const suggestedPort = available ? null : await this.findAvailablePort(instance.port + 1, instance.id, instance.host);
    return { available, occupiedBySelf: false, host: instance.host, port: instance.port, suggestedPort };
  }

  async updateInstanceEndpoint(id, input = {}) {
    const instance = this.getInstance(id);
    if (this.runtimes.has(id)) throw new Error('Stop the instance before changing its listen port');
    const host = BIND_HOSTS.has(input.host) ? input.host : null;
    if (!host) throw new Error('Listen host must be 127.0.0.1 or 0.0.0.0');
    const port = Number(input.port);
    if (!Number.isInteger(port) || port < 1024 || port > PORT_SCAN_LIMIT) throw new Error('Listen port must be an integer from 1024 to 65535');
    if (this.instances.some((item) => item.id !== id && item.port === port)) {
      const suggestedPort = await this.findAvailablePort(port + 1, id, host);
      throw createPortConflictError(host, port, suggestedPort, `Port ${port} is already configured for another MonolithSSH instance`);
    }
    if (!await isEndpointAvailable(host, port)) {
      const suggestedPort = await this.findAvailablePort(port + 1, id, host);
      throw createPortConflictError(host, port, suggestedPort);
    }
    const previousEndpoint = `${instance.host}:${instance.port}`;
    instance.host = host;
    instance.port = port;
    instance.lastError = null;
    this.saveInstances();
    this.recordAudit({ type: 'instance.endpoint', ok: true, instanceId: id, instanceName: instance.name, source: 'local', credentials: 'system', action: `Changed listen endpoint from ${previousEndpoint} to ${host}:${port}` });
    return this.publicInstance(instance);
  }

  async updateInstancePort(id, requestedPort) {
    const instance = this.getInstance(id);
    return this.updateInstanceEndpoint(id, { host: instance.host, port: requestedPort });
  }

  async repairAndStartInstance(id) {
    const instance = this.getInstance(id);
    let candidate = await this.findAvailablePort(instance.port + 1, id, instance.host);
    let attempts = 0;
    while (attempts < 20) {
      instance.port = candidate;
      instance.lastError = null;
      this.saveInstances();
      try {
        return await this.startInstance(id);
      } catch (error) {
        if (error.code !== 'PORT_IN_USE') throw error;
        attempts += 1;
        candidate = await this.findAvailablePort(candidate + 1, id, instance.host);
      }
    }
    throw new Error('Unable to reserve an available local TCP port after multiple attempts');
  }

  async createInstance(input = {}) {
    const kind = input.kind === 'network' ? 'network' : 'linux';
    const index = this.instances.filter((instance) => instance.kind === kind).length + 1;
    const name = String(input.name ?? '').trim() || `${kind}-lab-${String(index).padStart(2, '0')}`;
    if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/.test(name)) throw new Error('Instance name must contain 1-64 letters, numbers, spaces, dots, underscores or hyphens');
    const username = String(input.username ?? '').trim() || (kind === 'network' ? 'admin' : 'root');
    if (!/^[A-Za-z_][A-Za-z0-9_-]{0,31}$/.test(username)) throw new Error('Username must contain 1-32 letters, numbers, underscores or hyphens');
    const authMethod = AUTH_METHODS.has(input.authMethod) ? input.authMethod : 'password';
    const password = String(input.password ?? (authMethod === 'password' ? 'monolith' : ''));
    if ((authMethod === 'password' || authMethod === 'both') && (!password || password.length > 256)) {
      throw new Error('Password authentication requires a password of 1-256 characters');
    }
    const authorizedKeys = input.authorizedKey ? [parseAuthorizedKey(input.authorizedKey)] : [];
    if ((authMethod === 'publickey' || authMethod === 'both') && !authorizedKeys.length) {
      throw new Error('Public-key authentication requires an authorized public key');
    }
    const host = input.host === undefined ? '127.0.0.1' : input.host;
    if (!BIND_HOSTS.has(host)) throw new Error('Listen host must be 127.0.0.1 or 0.0.0.0');
    const requestedPort = Number(input.port);
    const hasRequestedPort = Number.isInteger(requestedPort) && requestedPort >= 1024 && requestedPort <= PORT_SCAN_LIMIT;
    const port = hasRequestedPort ? requestedPort : await this.findAvailablePort(PORT_SCAN_START, null, host);
    if (this.instances.some((instance) => instance.port === port) || !await isEndpointAvailable(host, port)) {
      const suggestedPort = await this.findAvailablePort(port + 1, null, host);
      throw createPortConflictError(host, port, suggestedPort);
    }
    const instance = {
      id: randomUUID(),
      name,
      kind,
      template: kind === 'network' ? 'Cisco IOS · Virtual' : 'Ubuntu 24.04 · Virtual',
      host,
      port,
      username,
      password,
      authMethod,
      authorizedKeys,
      autoStart: false,
      createdAt: new Date().toISOString()
    };
    this.instances.push(instance);
    this.saveInstances();
    this.recordAudit({ type: 'instance.create', ok: true, instanceId: instance.id, instanceName: instance.name, source: 'local', credentials: 'system', action: `Created ${kind} instance` });
    return this.publicInstance(instance);
  }

  loadState(instance) {
    const statePath = path.join(this.statesDir, `${instance.id}.json`);
    if (fs.existsSync(statePath)) return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const state = createDefaultState(instance);
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    return state;
  }

  saveState(instance, state) {
    const statePath = path.join(this.statesDir, `${instance.id}.json`);
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  }

  loadHostKey(instance) {
    const keyPath = path.join(this.keysDir, `${instance.id}.pem`);
    if (!fs.existsSync(keyPath)) {
      const { privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        publicKeyEncoding: { type: 'pkcs1', format: 'pem' }
      });
      fs.writeFileSync(keyPath, privateKey, { mode: 0o600 });
    }
    return fs.readFileSync(keyPath);
  }

  isAuthorizedPublicKey(instance, context) {
    if (!instance.authorizedKeys?.length) return false;
    return instance.authorizedKeys.some((storedKey) => {
      const parsed = utils.parseKey(storedKey);
      if (parsed instanceof Error) return false;
      const keyMatches = context.key.algo === parsed.type && context.key.data.equals(parsed.getPublicSSH());
      if (!keyMatches) return false;
      if (!context.signature) return true;
      return parsed.verify(context.blob, context.signature, context.hashAlgo) === true;
    });
  }

  async startInstance(id) {
    if (this.runtimes.has(id)) return this.publicInstance(this.getInstance(id));
    const instance = this.getInstance(id);
    const preflight = await this.getPortStatus(id);
    if (!preflight.available) {
      const conflict = createPortConflictError(instance.host, instance.port, preflight.suggestedPort);
      instance.lastError = normalizeInstanceError({
        code: conflict.code,
        message: conflict.message,
        technicalMessage: conflict.details.technicalMessage,
        host: instance.host,
        port: instance.port,
        suggestedPort: preflight.suggestedPort
      });
      this.saveInstances();
      this.recordAudit({ type: 'instance.error', ok: false, instanceId: id, instanceName: instance.name, source: 'local', credentials: 'system', action: instance.lastError.technicalMessage });
      conflict.details = instance.lastError;
      throw conflict;
    }
    const state = this.loadState(instance);
    const clients = new Set();
    const server = new Server({ hostKeys: [this.loadHostKey(instance)] }, (client, info) => {
      clients.add(client);
      let authenticatedUser = null;
      let authenticationMethod = null;

      client.on('authentication', (context) => {
        const usernameMatches = safeEqual(context.username, instance.username);
        const allowsPassword = instance.authMethod === 'password' || instance.authMethod === 'both';
        const allowsPublicKey = instance.authMethod === 'publickey' || instance.authMethod === 'both';
        const passwordMatches = allowsPassword && context.method === 'password' && safeEqual(context.password, instance.password);
        const publicKeyMatches = allowsPublicKey && context.method === 'publickey' && this.isAuthorizedPublicKey(instance, context);
        const accepted = usernameMatches && (passwordMatches || publicKeyMatches);

        this.recordAudit({
          type: 'authentication',
          ok: accepted,
          instanceId: instance.id,
          instanceName: instance.name,
          source: info.ip,
          credentials: `${context.username} / ${context.method}`,
          action: accepted ? 'Login accepted' : 'Login rejected'
        });

        if (accepted) {
          authenticatedUser = context.username;
          authenticationMethod = context.method;
          context.accept();
        } else {
          context.reject([
            ...(allowsPassword ? ['password'] : []),
            ...(allowsPublicKey ? ['publickey'] : [])
          ]);
        }
      });

      client.on('ready', () => {
        client.on('session', (accept) => {
          const sessionChannel = accept();
          let terminalInfo = { cols: 80, rows: 24 };

          sessionChannel.on('pty', (acceptPty, _reject, infoPty) => {
            terminalInfo = { cols: infoPty.cols, rows: infoPty.rows };
            acceptPty?.();
          });

          sessionChannel.on('window-change', (acceptResize, _reject, infoResize) => {
            terminalInfo = { cols: infoResize.cols, rows: infoResize.rows };
            acceptResize?.();
          });

          sessionChannel.on('shell', (acceptShell) => {
            const stream = acceptShell();
            const engine = createSession(instance, state, () => this.saveState(instance, state), authenticatedUser, () => this.commandRules, () => this.disabledLinuxBuiltins, () => this.variableMap());
            this.attachInteractiveShell({ stream, engine, instance, source: info.ip, username: authenticatedUser, authenticationMethod, terminalInfo });
          });

          sessionChannel.on('exec', (acceptExec, _reject, execInfo) => {
            const stream = acceptExec();
            const engine = createSession(instance, state, () => this.saveState(instance, state), authenticatedUser, () => this.commandRules, () => this.disabledLinuxBuiltins, () => this.variableMap());
            const result = engine.execute(execInfo.command);
            this.recordAudit({
              type: 'command',
              ok: true,
              instanceId: instance.id,
              instanceName: instance.name,
              source: info.ip,
              credentials: `${authenticatedUser} / ${authenticationMethod}`,
              action: execInfo.command
            });
            if (result.output) stream.write(`${normalizeOutput(result.output)}\r\n`);
            stream.exit(0);
            stream.end();
          });
        });
      });

      client.on('close', () => clients.delete(client));
      client.on('error', () => clients.delete(client));
    });

    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(instance.port, instance.host);
      });
    } catch (error) {
      const portUnavailable = error.code === 'EADDRINUSE' || error.code === 'EACCES';
      const suggestedPort = portUnavailable
        ? await this.findAvailablePort(instance.port + 1, instance.id)
        : null;
      const failure = normalizeInstanceError({
        code: portUnavailable ? 'PORT_IN_USE' : 'START_FAILED',
        message: portUnavailable
          ? `Listen address ${instance.host}:${instance.port} is unavailable`
          : `Unable to start ${instance.name}`,
        technicalMessage: error.message,
        host: instance.host,
        port: instance.port,
        suggestedPort
      });
      instance.lastError = failure;
      this.saveInstances();
      this.recordAudit({ type: 'instance.error', ok: false, instanceId: id, instanceName: instance.name, source: 'local', credentials: 'system', action: failure.technicalMessage });
      const publicError = new Error(failure.message);
      publicError.code = failure.code;
      publicError.details = failure;
      throw publicError;
    }

    instance.lastError = null;
    this.runtimes.set(id, { server, clients, state });
    server.on('error', (error) => {
      this.recordAudit({ type: 'instance.error', ok: false, instanceId: id, instanceName: instance.name, source: 'local', credentials: 'system', action: error.message });
    });
    this.saveInstances();
    this.recordAudit({ type: 'instance.start', ok: true, instanceId: id, instanceName: instance.name, source: 'local', credentials: 'system', action: `Listening on ${instance.host}:${instance.port}` });
    return this.publicInstance(instance);
  }

  attachInteractiveShell({ stream, engine, instance, source, username, authenticationMethod }) {
    let command = '';
    let escapeBuffer = '';
    const history = [];
    let historyIndex = 0;

    const writePrompt = () => stream.write(`${engine.prompt()} `);
    const replaceCommand = (nextCommand) => {
      command = nextCommand;
      stream.write(`\x1b[2K\r${engine.prompt()} ${command}`);
    };

    stream.write(engine.banner());
    writePrompt();

    stream.on('data', (chunk) => {
      const input = chunk.toString('utf8');
      if (input === '\x1b[A' || input === '\x1b[B') {
        if (engine.inputMode?.()) return;
        if (!history.length) return;
        historyIndex = input === '\x1b[A' ? Math.max(0, historyIndex - 1) : Math.min(history.length, historyIndex + 1);
        replaceCommand(history[historyIndex] ?? '');
        return;
      }

      for (const character of input) {
        if (escapeBuffer || character === '\x1b') {
          escapeBuffer += character;
          if (/[A-Za-z~]$/.test(escapeBuffer) && escapeBuffer.length > 1) escapeBuffer = '';
          continue;
        }

        if (character === '\r' || character === '\n') {
          if (character === '\n' && !command) continue;
          const submitted = command;
          command = '';
          stream.write('\r\n');
          if (engine.inputMode?.()) {
            const result = engine.submitInput(submitted);
            if (!result.awaitInput) {
              this.recordAudit({
                type: 'interaction',
                ok: result.ok === true,
                instanceId: instance.id,
                instanceName: instance.name,
                source,
                credentials: `${username} / ${authenticationMethod}`,
                action: result.auditAction ?? 'Interactive input processed'
              });
            }
            if (result.output) stream.write(`${normalizeOutput(result.output)}\r\n`);
            if (result.awaitInput) {
              stream.write(`${result.prompt} `);
              continue;
            }
            writePrompt();
            continue;
          }
          if (submitted.trim()) {
            history.push(submitted);
            historyIndex = history.length;
          }
          const result = engine.execute(submitted);
          this.recordAudit({ type: 'command', ok: true, instanceId: instance.id, instanceName: instance.name, source, credentials: `${username} / ${authenticationMethod}`, action: submitted || '(empty)' });
          if (result.clear) stream.write('\x1b[2J\x1b[H');
          if (result.output) stream.write(`${normalizeOutput(result.output)}\r\n`);
          if (result.exit) {
            stream.exit(0);
            stream.end();
            return;
          }
          if (result.awaitInput) {
            stream.write(`${result.prompt} `);
            continue;
          }
          writePrompt();
          continue;
        }

        if (character === '\x03') {
          command = '';
          engine.cancelInput?.();
          stream.write('^C\r\n');
          writePrompt();
          continue;
        }

        if (character === '\x04') {
          stream.end('logout\r\n');
          return;
        }

        if (character === '\x7f' || character === '\b') {
          if (command.length > 0) {
            command = command.slice(0, -1);
            if (!engine.inputMode?.()?.secret) stream.write('\b \b');
          }
          continue;
        }

        if (character >= ' ') {
          command += character;
          if (!engine.inputMode?.()?.secret) stream.write(character);
        }
      }
    });
  }

  async stopInstance(id) {
    const instance = this.getInstance(id);
    const runtime = this.runtimes.get(id);
    if (!runtime) return this.publicInstance(instance);
    for (const client of runtime.clients) client.end();
    await new Promise((resolve) => runtime.server.close(resolve));
    this.runtimes.delete(id);
    this.recordAudit({ type: 'instance.stop', ok: true, instanceId: id, instanceName: instance.name, source: 'local', credentials: 'system', action: 'Instance stopped' });
    return this.publicInstance(instance);
  }

  async deleteInstance(id) {
    const instance = this.getInstance(id);
    await this.stopInstance(id);
    this.instances = this.instances.filter((item) => item.id !== id);
    this.saveInstances();
    const remainingRules = this.commandRules.filter((rule) => rule.scope !== 'instance' || rule.instanceId !== id);
    if (remainingRules.length !== this.commandRules.length) {
      this.commandRules = remainingRules;
      fs.writeFileSync(this.rulesPath, JSON.stringify(this.commandRules, null, 2));
    }
    for (const filePath of [path.join(this.keysDir, `${id}.pem`), path.join(this.statesDir, `${id}.json`)]) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    this.recordAudit({ type: 'instance.delete', ok: true, instanceId: id, instanceName: instance.name, source: 'local', credentials: 'system', action: 'Instance deleted' });
    return { id };
  }

  listAudit() {
    return this.auditEvents;
  }

  async shutdown() {
    await Promise.all([...this.runtimes.keys()].map((id) => this.stopInstance(id)));
  }
}

module.exports = { SimulatorService };
