import './styles/index.css';
import i18next, { setAppLanguage } from './i18n.js';
import { renderShell } from './ui/shell.js';
import { enhanceCustomSelects } from './ui/custom-select.js';
import { renderDashboard } from './views/dashboard.js';
import { renderInstances } from './views/instances.js';
import { mountTerminal, renderTerminal } from './views/terminal.js';
import { renderProfiles } from './views/profiles.js';
import { renderAudit } from './views/audit.js';
import { mcpSseConfig, renderSettings } from './views/settings.js';

const views = {
  dashboard: renderDashboard,
  instances: renderInstances,
  terminal: renderTerminal,
  profiles: renderProfiles,
  audit: renderAudit,
  settings: renderSettings
};

const browserFallbackInstances = [
  { id: 'preview-network', name: 'router-lab-01', kind: 'network', host: '127.0.0.1', port: 2222, address: '127.0.0.1:2222', template: 'Cisco IOS · Virtual', username: 'admin', authMethod: 'password', authorizedKeyCount: 0, embeddedTerminalAvailable: true, running: true },
  { id: 'preview-linux', name: 'linux-lab-01', kind: 'linux', host: '127.0.0.1', port: 2223, address: '127.0.0.1:2223', template: 'Ubuntu 24.04 · Virtual', username: 'root', authMethod: 'password', authorizedKeyCount: 0, embeddedTerminalAvailable: true, running: true }
];

const browserFallbackBuiltins = [
  ['clear', 'clear'], ['exit', 'exit | logout'], ['help', 'help'], ['pwd', 'pwd'], ['whoami', 'whoami'], ['id', 'id'],
  ['hostname', 'hostname'], ['date', 'date'], ['uname', 'uname [-a]'], ['env', 'env'], ['ps', 'ps'], ['ip', 'ip addr | ip route'],
  ['systemctl', 'systemctl status ssh'], ['cd', 'cd [path]'], ['ls', 'ls [path]'], ['cat', 'cat <file>'], ['touch', 'touch <file>'],
  ['mkdir', 'mkdir <directory>'], ['rm', 'rm <path>'], ['echo', 'echo <text> [> file]'], ['uptime', 'uptime'], ['df', 'df [-h]'],
  ['free', 'free [-h]'], ['which', 'which <command>']
].map(([id, usage]) => ({ id, command: id, usage, aliases: [id], enabled: true }));

const browserFallbackVariables = [{ id: 'default-su-password', name: 'SU_PASSWORD', value: 'monolith', secret: true, description: 'su password' }];
const browserFallbackRules = [{
  id: 'default-linux-su', kind: 'linux', scope: 'type', instanceId: null, mode: 'shell', matchType: 'command', pattern: 'su', output: '', behavior: 'interactive',
  steps: [
    { id: 'su-input', type: 'input', prompt: 'Password:', secret: true, saveAs: 'password' },
    { id: 'su-verify', type: 'verify_variable', input: 'password', variable: 'SU_PASSWORD', failureOutput: 'su: Authentication failure' },
    { id: 'su-user', type: 'set_user', target: '{{arg1}}' },
    { id: 'su-finish', type: 'finish' }
  ], requiresArgument: true, enabled: true
}];

const state = {
  route: 'dashboard',
  loading: true,
  error: null,
  auditQuery: '',
  auditFilter: 'all',
  auditEvents: [],
  instances: window.monolith ? [] : browserFallbackInstances,
  selectedInstanceId: null,
  profileScope: 'type',
  profileSection: 'rules',
  profileKind: 'network',
  profileInstanceId: null,
  commandRules: window.monolith ? [] : browserFallbackRules,
  savedCommandRules: window.monolith ? [] : cloneRules(browserFallbackRules),
  profileDirty: false,
  profileApplied: false,
  linuxBuiltins: window.monolith ? [] : browserFallbackBuiltins,
  variables: window.monolith ? [] : browserFallbackVariables,
  savedVariables: window.monolith ? [] : browserFallbackVariables.map((variable) => ({ ...variable })),
  variablesDirty: false,
  variablesApplied: false,
  revealedVariableIds: new Set(),
  mcpStatus: {
    enabled: false,
    running: false,
    host: '127.0.0.1',
    port: 3765,
    endpoint: 'http://127.0.0.1:3765/mcp',
    sseEndpoint: 'http://127.0.0.1:3765/sse',
    lastError: null,
    toolCount: 20
  },
  mcpCopied: false,
  instanceCreator: null,
  credentialViewer: null,
  portDiagnostics: {},
  portEditorInstanceId: null,
  hostDraft: '127.0.0.1',
  portDraft: '',
  busyInstanceId: null
};

const app = document.querySelector('#app');
let pageRoot = null;
let pageTitle = null;
let activeViewCleanup = null;
let removeAuditListener = null;
let removeMcpListener = null;

function mountShell() {
  activeViewCleanup?.();
  activeViewCleanup = null;
  app.innerHTML = renderShell();
  pageRoot = document.querySelector('#page-root');
  pageTitle = document.querySelector('#page-title');
  render();
}

function render() {
  activeViewCleanup?.();
  activeViewCleanup = null;

  const renderView = views[state.route] ?? views.dashboard;
  pageRoot.innerHTML = renderView(state);
  pageTitle.textContent = i18next.t(`nav.${state.route}`);

  document.querySelectorAll('[data-route]').forEach((link) => {
    const active = link.dataset.route === state.route;
    link.classList.toggle('is-active', active);
    link.setAttribute('aria-current', active ? 'page' : 'false');
  });

  enhanceCustomSelects(app);

  if (state.route === 'terminal') activeViewCleanup = mountTerminal(state);
}

async function refreshInstances() {
  if (!window.monolith) return;
  state.instances = await window.monolith.instances.list();
  const conflictIds = new Set(state.instances.filter((instance) => instance.lastError?.code === 'PORT_IN_USE').map((instance) => instance.id));
  for (const id of Object.keys(state.portDiagnostics)) {
    if (!conflictIds.has(id)) delete state.portDiagnostics[id];
  }
  await Promise.all(state.instances
    .filter((instance) => instance.lastError?.code === 'PORT_IN_USE')
    .map(async (instance) => {
      try {
        state.portDiagnostics[instance.id] = await window.monolith.instances.diagnosePort(instance.id);
      } catch {
        state.portDiagnostics[instance.id] = {
          available: false,
          host: instance.host,
          port: instance.port,
          suggestedPort: instance.lastError.suggestedPort ?? null,
          owner: null
        };
      }
    }));
  const selected = state.instances.find((instance) => instance.id === state.selectedInstanceId && instance.running);
  if (!selected) state.selectedInstanceId = state.instances.find((instance) => instance.running)?.id ?? null;
  if (state.profileScope === 'instance' && !state.instances.some((instance) => instance.id === state.profileInstanceId)) {
    state.profileScope = 'type';
    state.profileInstanceId = null;
  }
}

async function refreshAudit() {
  if (!window.monolith) return;
  state.auditEvents = await window.monolith.audit.list();
}

function cloneRules(rules) {
  return rules.map((rule) => ({
    ...rule,
    steps: (rule.steps ?? []).map((step) => ({ ...step, choices: step.choices ? [...step.choices] : undefined }))
  }));
}

async function refreshCommandRules() {
  if (!window.monolith) return;
  const rules = await window.monolith.commands.list();
  state.commandRules = cloneRules(rules);
  state.savedCommandRules = cloneRules(rules);
  state.profileDirty = false;
}

async function refreshLinuxBuiltins() {
  if (!window.monolith) return;
  state.linuxBuiltins = await window.monolith.builtins.list();
}

function cloneVariables(variables) {
  return variables.map((variable) => ({ ...variable }));
}

async function refreshVariables() {
  if (!window.monolith) return;
  const variables = await window.monolith.variables.list();
  state.variables = cloneVariables(variables);
  state.savedVariables = cloneVariables(variables);
  state.variablesDirty = false;
}

async function refreshMcpStatus() {
  if (!window.monolith) return;
  state.mcpStatus = await window.monolith.mcp.getStatus();
}

function updateProfileDirtyIndicator() {
  state.profileDirty = true;
  state.profileApplied = false;
  const indicator = document.querySelector('[data-profile-live-state]');
  if (!indicator) return;
  indicator.classList.add('is-dirty');
  indicator.innerHTML = `<i></i>${i18next.t('profiles.unsaved')}`;
}

function updateVariablesDirtyIndicator() {
  state.variablesDirty = true;
  state.variablesApplied = false;
  const indicator = document.querySelector('[data-variable-live-state]');
  if (!indicator) return;
  indicator.classList.add('is-dirty');
  indicator.innerHTML = `<i></i>${i18next.t('profiles.unsaved')}`;
}

function updateRuleField(target) {
  const card = target.closest('[data-rule-id]');
  if (!card) return;
  const rule = state.commandRules.find((item) => item.id === card.dataset.ruleId);
  if (!rule) return;
  rule[target.dataset.ruleField] = target.type === 'checkbox' ? target.checked : target.value;
  if (target.dataset.ruleField === 'pattern') {
    card.querySelector('.command-rule-card__heading strong').textContent = target.value || i18next.t('profiles.untitledRule');
  }
  updateProfileDirtyIndicator();
}

function createInteractionStep(type, kind) {
  const common = { id: crypto.randomUUID(), type };
  if (type === 'input') return { ...common, prompt: 'Input:', secret: false, saveAs: 'input' };
  if (type === 'verify_variable') return { ...common, input: 'input', variable: state.variables[0]?.name ?? '', failureOutput: 'Verification failed' };
  if (type === 'verify_choice') return { ...common, input: 'input', choices: ['yes', 'y'], caseSensitive: false, failureOutput: 'Cancelled' };
  if (type === 'set_user') return { ...common, target: '{{arg1}}' };
  if (type === 'set_mode') return { ...common, target: 'privileged_exec' };
  if (type === 'output') return { ...common, text: '' };
  return { ...common, type: 'finish' };
}

function defaultInteractionSteps(kind) {
  return [createInteractionStep('input', kind), createInteractionStep(kind === 'network' ? 'set_mode' : 'set_user', kind), createInteractionStep('finish', kind)];
}

function updateInteractionStepField(target) {
  const card = target.closest('[data-rule-id]');
  const stepElement = target.closest('[data-step-id]');
  const rule = state.commandRules.find((item) => item.id === card?.dataset.ruleId);
  if (!rule || !stepElement) return;
  const index = rule.steps.findIndex((step) => step.id === stepElement.dataset.stepId);
  if (index < 0) return;
  const field = target.dataset.stepField;
  if (field === 'type') {
    rule.steps[index] = createInteractionStep(target.value, rule.kind);
  } else if (field === 'choices') {
    rule.steps[index].choices = target.value.split(',').map((choice) => choice.trim()).filter(Boolean);
  } else {
    rule.steps[index][field] = target.type === 'checkbox' ? target.checked : target.value;
  }
  updateProfileDirtyIndicator();
}

function updateVariableField(target) {
  const card = target.closest('[data-variable-id]');
  if (!card) return;
  const variable = state.variables.find((item) => item.id === card.dataset.variableId);
  if (!variable) return;
  variable[target.dataset.variableField] = target.type === 'checkbox' ? target.checked : target.value;
  updateVariablesDirtyIndicator();
}

function validateCommandRules() {
  const variableNames = new Set(state.variables.map((variable) => variable.name));
  for (const rule of state.commandRules) {
    if (!rule.pattern.trim()) throw new Error(i18next.t('profiles.patternRequired'));
    if (rule.matchType === 'regex') {
      try {
        new RegExp(rule.pattern, 'i');
      } catch (error) {
        throw new Error(i18next.t('profiles.invalidRegex', { message: error.message }));
      }
    }
    if (rule.behavior !== 'interactive') continue;
    if (!rule.steps?.length) throw new Error(i18next.t('profiles.interactionStepsRequired'));
    const finishIndex = rule.steps.findIndex((step) => step.type === 'finish');
    if (finishIndex >= 0 && finishIndex !== rule.steps.length - 1) throw new Error(i18next.t('profiles.finishMustBeLast'));
    const capturedInputs = new Set();
    for (const step of rule.steps) {
      if (step.type === 'input') capturedInputs.add(step.saveAs);
      if ((step.type === 'verify_variable' || step.type === 'verify_choice') && !capturedInputs.has(step.input)) {
        throw new Error(i18next.t('profiles.missingInputReference', { name: step.input }));
      }
    }
    const missingStep = rule.steps.find((step) => step.type === 'verify_variable' && !variableNames.has(step.variable));
    if (missingStep) throw new Error(i18next.t('profiles.missingVerificationVariable', { name: missingStep.variable }));
  }
}

function validateVariables() {
  const names = new Set();
  const reserved = new Set(['command', 'hostname', 'instance', 'user', 'arg1', 'input']);
  for (const variable of state.variables) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(variable.name)) throw new Error(i18next.t('profiles.invalidVariableName'));
    if (reserved.has(variable.name)) throw new Error(i18next.t('profiles.reservedVariable', { name: variable.name }));
    if (names.has(variable.name)) throw new Error(i18next.t('profiles.duplicateVariable', { name: variable.name }));
    names.add(variable.name);
  }
  const missingReference = state.commandRules
    .flatMap((rule) => rule.behavior === 'interactive' ? rule.steps ?? [] : [])
    .find((step) => step.type === 'verify_variable' && !names.has(step.variable));
  if (missingReference) throw new Error(i18next.t('profiles.variableInUseMissing', { name: missingReference.variable }));
}

function createRule(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    kind: state.profileKind,
    scope: state.profileScope,
    instanceId: state.profileScope === 'instance' ? state.profileInstanceId : null,
    mode: state.profileKind === 'network' ? 'any' : 'shell',
    matchType: 'exact',
    pattern: '',
    output: '',
    behavior: 'output',
    steps: [],
    requiresArgument: false,
    enabled: true,
    ...overrides
  };
}

async function runAction(action) {
  state.error = null;
  try {
    await action();
  } catch (error) {
    state.error = error.message;
  } finally {
    render();
  }
}

function portConflictMessage(error) {
  const details = error?.details ?? {};
  return i18next.t('instances.errors.portInUse', {
    address: `${details.host ?? '127.0.0.1'}:${details.port ?? '?'}`,
    suggestedPort: details.suggestedPort ?? '—'
  });
}

async function startInstanceWithDiagnosis(instance) {
  state.error = null;
  state.busyInstanceId = instance.id;
  render();
  try {
    await window.monolith.instances.start(instance.id);
    delete state.portDiagnostics[instance.id];
    state.portEditorInstanceId = null;
  } catch (error) {
    if (error.code !== 'PORT_IN_USE') state.error = error.message;
  } finally {
    await Promise.allSettled([refreshInstances(), refreshAudit(), refreshCommandRules()]);
    state.busyInstanceId = null;
    render();
  }
}

async function repairInstancePort(instance) {
  state.error = null;
  state.busyInstanceId = instance.id;
  render();
  try {
    await window.monolith.instances.repairPort(instance.id);
    delete state.portDiagnostics[instance.id];
    state.portEditorInstanceId = null;
  } catch (error) {
    state.error = error.code === 'PORT_IN_USE' ? portConflictMessage(error) : error.message;
  } finally {
    await Promise.allSettled([refreshInstances(), refreshAudit(), refreshCommandRules()]);
    state.busyInstanceId = null;
    render();
  }
}

function previewPassword(length = 24) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return [...values].map((value) => alphabet[value % alphabet.length]).join('');
}

function createInstanceDraft(kind) {
  const sequence = String(state.instances.filter((instance) => instance.kind === kind).length + 1).padStart(2, '0');
  return {
    phase: 'form',
    kind,
    name: `${kind === 'network' ? 'router' : 'linux'}-lab-${sequence}`,
    username: kind === 'network' ? 'admin' : 'root',
    host: '127.0.0.1',
    port: '',
    authMethod: 'password',
    password: previewPassword(),
    revealPassword: false,
    authorizedKey: '',
    privateKey: '',
    fingerprint: '',
    algorithm: '',
    startNow: true,
    submitting: false,
    created: null,
    copied: '',
    savedPath: ''
  };
}

async function openCredentialViewer(instance) {
  state.credentialViewer = {
    instanceId: instance.id,
    loading: true,
    error: null,
    access: null,
    revealPassword: false,
    copied: '',
    savedPath: ''
  };
  render();
  try {
    state.credentialViewer.access = window.monolith
      ? await window.monolith.credentials.getInstanceAccess(instance.id)
      : {
          ...instance,
          password: 'monolith',
          publicKeys: [],
          privateKeyManaged: false
        };
  } catch (error) {
    state.credentialViewer.error = error.message;
  } finally {
    state.credentialViewer.loading = false;
    render();
  }
}

function credentialViewerCopyValue(action) {
  const access = state.credentialViewer?.access;
  if (!access) return '';
  const connectionHost = access.host === '0.0.0.0' ? 'HOST_IP' : '127.0.0.1';
  if (action === 'password-command') return `ssh -p ${access.port} ${access.username}@${connectionHost}`;
  if (action === 'key-command') return `ssh -i ${access.name}.pem -p ${access.port} ${access.username}@${connectionHost}`;
  if (action === 'address') return access.address;
  if (action === 'username') return access.username;
  if (action === 'password') return access.password;
  const [kind, indexValue] = action.split(':');
  const key = access.publicKeys[Number(indexValue)];
  if (kind === 'public-key') return key?.publicKey ?? '';
  if (kind === 'fingerprint') return key?.fingerprint ?? '';
  return '';
}

function updateInstanceCreatorField(target) {
  const creator = state.instanceCreator;
  if (!creator) return;
  const field = target.dataset.instanceField;
  const previousKind = creator.kind;
  creator[field] = target.type === 'checkbox' ? target.checked : target.value;
  if (field === 'kind' && previousKind !== creator.kind && ['root', 'admin'].includes(creator.username)) {
    creator.username = creator.kind === 'network' ? 'admin' : 'root';
  }
}

async function copyCredential(kind) {
  const creator = state.instanceCreator;
  if (!creator) return;
  const port = String(creator.created?.address ?? '').split(':').at(-1);
  const connectionHost = creator.created?.host === '0.0.0.0' ? 'HOST_IP' : '127.0.0.1';
  const values = {
    command: creator.authMethod === 'password'
      ? `ssh -p ${port} ${creator.username}@${connectionHost}`
      : `ssh -i ${creator.name || 'monolithssh-key'}.pem -p ${port} ${creator.username}@${connectionHost}`,
    username: creator.username,
    password: creator.password,
    fingerprint: creator.fingerprint,
    privateKey: creator.privateKey
  };
  await navigator.clipboard.writeText(values[kind] ?? '');
  creator.copied = kind;
}

document.addEventListener('click', async (event) => {
  const routeLink = event.target.closest('[data-route]');
  if (routeLink) {
    state.route = routeLink.dataset.route;
    render();
    return;
  }

  if (event.target.closest('[data-copy-mcp-config]')) {
    await runAction(async () => {
      await navigator.clipboard.writeText(mcpSseConfig(state.mcpStatus));
      state.mcpCopied = true;
    });
    return;
  }

  const terminalSelect = event.target.closest('[data-terminal-select]');
  if (terminalSelect) {
    const instance = state.instances.find((item) => item.id === terminalSelect.dataset.terminalSelect);
    if (!instance?.running) return;
    state.selectedInstanceId = instance.id;
    state.route = 'terminal';
    render();
    return;
  }

  const instanceAction = event.target.closest('[data-instance-action]');
  if (instanceAction) {
    const instance = state.instances.find((item) => item.id === instanceAction.dataset.instance);
    if (!instance) return;

    if (instanceAction.dataset.instanceAction === 'access') {
      await openCredentialViewer(instance);
      return;
    }

    if (instanceAction.dataset.instanceAction === 'terminal') {
      state.selectedInstanceId = instance.id;
      state.route = 'terminal';
      render();
      return;
    }

    if (!window.monolith) return;
    if (instanceAction.dataset.instanceAction === 'toggle' && !instance.running) {
      await startInstanceWithDiagnosis(instance);
      return;
    }
    await runAction(async () => {
      if (instanceAction.dataset.instanceAction === 'toggle') await window.monolith.instances.stop(instance.id);
      if (instanceAction.dataset.instanceAction === 'delete') {
        if (!window.confirm(i18next.t('instances.deleteConfirm', { name: instance.name }))) return;
        await window.monolith.instances.delete(instance.id);
        delete state.portDiagnostics[instance.id];
      }
      await Promise.all([refreshInstances(), refreshAudit(), refreshCommandRules()]);
    });
    return;
  }

  const portAction = event.target.closest('[data-port-action]');
  if (portAction) {
    const instance = state.instances.find((item) => item.id === portAction.dataset.instance);
    if (!instance || !window.monolith) return;
    const action = portAction.dataset.portAction;
    if (action === 'repair') {
      await repairInstancePort(instance);
      return;
    }
    if (action === 'retry') {
      await startInstanceWithDiagnosis(instance);
      return;
    }
    if (action === 'edit') {
      const diagnostic = state.portDiagnostics[instance.id];
      state.portEditorInstanceId = instance.id;
      state.hostDraft = instance.host;
      state.portDraft = String(diagnostic?.suggestedPort ?? instance.lastError?.suggestedPort ?? instance.port);
      render();
      document.querySelector('[data-port-editor-input]')?.focus();
      return;
    }
    if (action === 'cancel-edit') {
      state.portEditorInstanceId = null;
      state.hostDraft = '127.0.0.1';
      state.portDraft = '';
      render();
    }
    return;
  }

  const newInstance = event.target.closest('[data-new-instance]');
  if (newInstance) {
    const kind = document.querySelector('[data-instance-kind]')?.value ?? 'linux';
    state.instanceCreator = createInstanceDraft(kind);
    state.error = null;
    render();
    if (window.monolith?.credentials) {
      try {
        state.instanceCreator.password = await window.monolith.credentials.generatePassword(24);
        render();
      } catch (error) {
        state.error = error.message;
        render();
      }
    }
    return;
  }

  const closeCreator = event.target.closest('[data-close-instance-creator]');
  if (closeCreator && (event.target === closeCreator || closeCreator.tagName === 'BUTTON')) {
    state.instanceCreator = null;
    state.error = null;
    render();
    return;
  }

  const closeCredentialViewer = event.target.closest('[data-close-credential-viewer]');
  if (closeCredentialViewer && (event.target === closeCredentialViewer || closeCredentialViewer.tagName === 'BUTTON')) {
    state.credentialViewer = null;
    render();
    return;
  }

  if (event.target.closest('[data-toggle-access-password]')) {
    state.credentialViewer.revealPassword = !state.credentialViewer.revealPassword;
    render();
    return;
  }

  const accessCopyButton = event.target.closest('[data-copy-access]');
  if (accessCopyButton) {
    await runAction(async () => {
      await navigator.clipboard.writeText(credentialViewerCopyValue(accessCopyButton.dataset.copyAccess));
      state.credentialViewer.copied = accessCopyButton.dataset.copyAccess;
    });
    return;
  }

  if (event.target.closest('[data-export-instance-private-key]')) {
    await runAction(async () => {
      const result = await window.monolith.credentials.exportInstancePrivateKey(state.credentialViewer.instanceId);
      if (result.saved) state.credentialViewer.savedPath = result.path;
    });
    return;
  }

  if (event.target.closest('[data-finish-instance-creator]')) {
    state.instanceCreator = null;
    render();
    return;
  }

  if (event.target.closest('[data-toggle-instance-password]')) {
    state.instanceCreator.revealPassword = !state.instanceCreator.revealPassword;
    render();
    return;
  }

  if (event.target.closest('[data-generate-password]')) {
    await runAction(async () => {
      state.instanceCreator.password = window.monolith?.credentials
        ? await window.monolith.credentials.generatePassword(24)
        : previewPassword();
      state.instanceCreator.revealPassword = true;
    });
    return;
  }

  if (event.target.closest('[data-generate-key]')) {
    await runAction(async () => {
      const creator = state.instanceCreator;
      const generated = window.monolith?.credentials
        ? await window.monolith.credentials.generateKey(`${creator.username}@${creator.name}`)
        : {
            algorithm: 'RSA-3072',
            publicKey: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQDemoPreviewKey monolithssh-preview',
            privateKey: '-----BEGIN RSA PRIVATE KEY-----\nMONOLITHSSH BROWSER PREVIEW\n-----END RSA PRIVATE KEY-----',
            fingerprint: 'SHA256:browser-preview'
          };
      creator.algorithm = generated.algorithm;
      creator.authorizedKey = generated.publicKey;
      creator.privateKey = generated.privateKey;
      creator.fingerprint = generated.fingerprint;
    });
    return;
  }

  const copyButton = event.target.closest('[data-copy-credential]');
  if (copyButton) {
    await runAction(() => copyCredential(copyButton.dataset.copyCredential));
    return;
  }

  if (event.target.closest('[data-save-private-key]')) {
    await runAction(async () => {
      const creator = state.instanceCreator;
      if (!window.monolith?.credentials) {
        await navigator.clipboard.writeText(creator.privateKey);
        creator.copied = 'privateKey';
        return;
      }
      const result = await window.monolith.credentials.savePrivateKey(creator.privateKey, `${creator.name}.pem`);
      if (result.saved) creator.savedPath = result.path;
    });
    return;
  }

  const profileTarget = event.target.closest('[data-profile-scope]');
  if (profileTarget) {
    state.profileScope = profileTarget.dataset.profileScope;
    if (state.profileScope === 'instance') {
      state.profileInstanceId = profileTarget.dataset.profileInstance;
      const instance = state.instances.find((item) => item.id === state.profileInstanceId);
      if (instance) state.profileKind = instance.kind;
    } else {
      state.profileKind = profileTarget.dataset.profileKind;
      state.profileInstanceId = null;
    }
    render();
    return;
  }

  const profileSection = event.target.closest('[data-profile-section]');
  if (profileSection) {
    state.profileSection = profileSection.dataset.profileSection;
    state.error = null;
    render();
    return;
  }

  const deleteBuiltin = event.target.closest('[data-delete-builtin]');
  if (deleteBuiltin) {
    await runAction(async () => {
      state.linuxBuiltins = window.monolith
        ? await window.monolith.builtins.delete(deleteBuiltin.dataset.deleteBuiltin)
        : state.linuxBuiltins.map((builtin) => builtin.id === deleteBuiltin.dataset.deleteBuiltin ? { ...builtin, enabled: false } : builtin);
      await refreshAudit();
    });
    return;
  }

  if (event.target.closest('[data-restore-builtins]')) {
    await runAction(async () => {
      state.linuxBuiltins = window.monolith
        ? await window.monolith.builtins.restore()
        : state.linuxBuiltins.map((builtin) => ({ ...builtin, enabled: true }));
      await refreshAudit();
    });
    return;
  }

  if (event.target.closest('[data-add-rule]')) {
    state.commandRules.push(createRule());
    state.profileDirty = true;
    state.profileApplied = false;
    render();
    const patternInputs = document.querySelectorAll('[data-rule-field="pattern"]');
    patternInputs[patternInputs.length - 1]?.focus();
    return;
  }

  if (event.target.closest('[data-add-su-template]')) {
    state.commandRules.push(createRule({
      kind: 'linux',
      mode: 'shell',
      matchType: 'command',
      pattern: 'su',
      behavior: 'interactive',
      steps: [
        { ...createInteractionStep('input', 'linux'), prompt: 'Password:', secret: true, saveAs: 'password' },
        { ...createInteractionStep('verify_variable', 'linux'), input: 'password', variable: state.variables.find((variable) => variable.name === 'SU_PASSWORD')?.name ?? state.variables[0]?.name ?? '', failureOutput: 'su: Authentication failure' },
        { ...createInteractionStep('set_user', 'linux'), target: '{{arg1}}' },
        createInteractionStep('finish', 'linux')
      ],
      requiresArgument: true
    }));
    state.profileDirty = true;
    state.profileApplied = false;
    render();
    return;
  }

  const addStep = event.target.closest('[data-add-interaction-step]');
  if (addStep) {
    const rule = state.commandRules.find((item) => item.id === addStep.dataset.addInteractionStep);
    if (!rule) return;
    rule.steps ??= [];
    const finishIndex = rule.steps.findIndex((step) => step.type === 'finish');
    rule.steps.splice(finishIndex < 0 ? rule.steps.length : finishIndex, 0, createInteractionStep('output', rule.kind));
    updateProfileDirtyIndicator();
    render();
    return;
  }

  const deleteStep = event.target.closest('[data-delete-interaction-step]');
  if (deleteStep) {
    const rule = state.commandRules.find((item) => item.id === deleteStep.closest('[data-rule-id]')?.dataset.ruleId);
    if (!rule) return;
    rule.steps = rule.steps.filter((step) => step.id !== deleteStep.dataset.deleteInteractionStep);
    updateProfileDirtyIndicator();
    render();
    return;
  }

  const moveStep = event.target.closest('[data-move-interaction-step]');
  if (moveStep) {
    const rule = state.commandRules.find((item) => item.id === moveStep.closest('[data-rule-id]')?.dataset.ruleId);
    const index = rule?.steps.findIndex((step) => step.id === moveStep.dataset.moveInteractionStep) ?? -1;
    const offset = moveStep.dataset.direction === 'up' ? -1 : 1;
    const destination = index + offset;
    if (!rule || index < 0 || destination < 0 || destination >= rule.steps.length) return;
    [rule.steps[index], rule.steps[destination]] = [rule.steps[destination], rule.steps[index]];
    updateProfileDirtyIndicator();
    render();
    return;
  }

  const deleteRule = event.target.closest('[data-delete-rule]');
  if (deleteRule) {
    state.commandRules = state.commandRules.filter((rule) => rule.id !== deleteRule.dataset.deleteRule);
    state.profileDirty = true;
    state.profileApplied = false;
    render();
    return;
  }

  if (event.target.closest('[data-revert-rules]')) {
    state.commandRules = cloneRules(state.savedCommandRules);
    state.profileDirty = false;
    state.profileApplied = false;
    state.error = null;
    render();
    return;
  }

  if (event.target.closest('[data-save-rules]')) {
    await runAction(async () => {
      validateCommandRules();
      const saved = window.monolith
        ? await window.monolith.commands.save(state.commandRules)
        : cloneRules(state.commandRules);
      state.commandRules = cloneRules(saved);
      state.savedCommandRules = cloneRules(saved);
      state.profileDirty = false;
      state.profileApplied = true;
      await refreshAudit();
    });
    return;
  }

  if (event.target.closest('[data-add-variable]')) {
    state.variables.push({ id: crypto.randomUUID(), name: '', value: '', secret: false, description: '' });
    updateVariablesDirtyIndicator();
    render();
    const nameInputs = document.querySelectorAll('[data-variable-field="name"]');
    nameInputs[nameInputs.length - 1]?.focus();
    return;
  }

  const deleteVariable = event.target.closest('[data-delete-variable]');
  if (deleteVariable) {
    state.variables = state.variables.filter((variable) => variable.id !== deleteVariable.dataset.deleteVariable);
    state.revealedVariableIds.delete(deleteVariable.dataset.deleteVariable);
    state.variablesDirty = true;
    state.variablesApplied = false;
    render();
    return;
  }

  const revealVariable = event.target.closest('[data-reveal-variable]');
  if (revealVariable) {
    const id = revealVariable.dataset.revealVariable;
    if (state.revealedVariableIds.has(id)) state.revealedVariableIds.delete(id);
    else state.revealedVariableIds.add(id);
    render();
    return;
  }

  if (event.target.closest('[data-revert-variables]')) {
    state.variables = cloneVariables(state.savedVariables);
    state.variablesDirty = false;
    state.variablesApplied = false;
    state.error = null;
    render();
    return;
  }

  if (event.target.closest('[data-save-variables]')) {
    await runAction(async () => {
      validateVariables();
      const saved = window.monolith
        ? await window.monolith.variables.save(state.variables)
        : cloneVariables(state.variables);
      state.variables = cloneVariables(saved);
      state.savedVariables = cloneVariables(saved);
      state.variablesDirty = false;
      state.variablesApplied = true;
      await refreshAudit();
    });
  }
});

document.addEventListener('input', (event) => {
  if (event.target.matches('[data-port-editor-input]')) {
    state.portDraft = event.target.value;
    return;
  }
  if (event.target.matches('[data-endpoint-host]')) {
    state.hostDraft = event.target.value;
    return;
  }
  if (event.target.matches('[data-instance-field]')) {
    updateInstanceCreatorField(event.target);
    return;
  }

  if (event.target.matches('[data-step-field]')) {
    updateInteractionStepField(event.target);
    return;
  }

  if (event.target.matches('[data-rule-field]')) {
    updateRuleField(event.target);
    return;
  }

  if (event.target.matches('[data-variable-field]')) {
    updateVariableField(event.target);
    return;
  }

  if (event.target.matches('[data-audit-search]')) {
    state.auditQuery = event.target.value;
    render();
    const search = document.querySelector('[data-audit-search]');
    search?.focus();
    search?.setSelectionRange(search.value.length, search.value.length);
  }
});

document.addEventListener('change', async (event) => {
  if (event.target.matches('[data-instance-field]')) {
    updateInstanceCreatorField(event.target);
    if (['kind', 'authMethod', 'host'].includes(event.target.dataset.instanceField)) render();
    return;
  }
  if (event.target.matches('[data-endpoint-host]')) {
    state.hostDraft = event.target.value;
    render();
    return;
  }

  if (event.target.matches('[data-mcp-toggle]')) {
    const enabled = event.target.checked;
    await runAction(async () => {
      state.mcpStatus = window.monolith
        ? await window.monolith.mcp.setEnabled(enabled)
        : { ...state.mcpStatus, enabled, running: enabled };
      state.mcpCopied = false;
    });
    return;
  }

  if (event.target.matches('[data-step-field]')) {
    updateInteractionStepField(event.target);
    if (event.target.dataset.stepField === 'type') render();
    return;
  }

  if (event.target.matches('[data-rule-field]')) {
    updateRuleField(event.target);
    if (event.target.dataset.ruleField === 'behavior') {
      const card = event.target.closest('[data-rule-id]');
      const rule = state.commandRules.find((item) => item.id === card?.dataset.ruleId);
      if (rule?.behavior === 'interactive' && !rule.steps?.length) rule.steps = defaultInteractionSteps(rule.kind);
      render();
    }
    return;
  }

  if (event.target.matches('[data-variable-field]')) {
    updateVariableField(event.target);
    if (event.target.dataset.variableField === 'secret') render();
    return;
  }

  if (event.target.matches('[data-locale]')) {
    void setAppLanguage(event.target.value).then(mountShell);
    return;
  }

  if (event.target.matches('[data-audit-filter]')) {
    state.auditFilter = event.target.value;
    render();
  }

  if (event.target.matches('[data-terminal-target]')) {
    state.selectedInstanceId = event.target.value;
    render();
  }
});

document.addEventListener('submit', async (event) => {
  if (event.target.matches('[data-instance-port-form]')) {
    event.preventDefault();
    const instance = state.instances.find((item) => item.id === event.target.dataset.instance);
    if (!instance || !window.monolith) return;
    const port = Number(state.portDraft);
    state.busyInstanceId = instance.id;
    state.error = null;
    render();
    try {
      await window.monolith.instances.updateEndpoint(instance.id, state.hostDraft, port, true);
      delete state.portDiagnostics[instance.id];
      state.portEditorInstanceId = null;
      state.hostDraft = '127.0.0.1';
      state.portDraft = '';
    } catch (error) {
      state.error = error.code === 'PORT_IN_USE' ? portConflictMessage(error) : error.message;
    } finally {
      await Promise.allSettled([refreshInstances(), refreshAudit(), refreshCommandRules()]);
      state.busyInstanceId = null;
      render();
    }
    return;
  }
  if (event.target.matches('[data-variable-form]')) {
    event.preventDefault();
    return;
  }
  if (!event.target.matches('[data-instance-create-form]')) return;
  event.preventDefault();
  const creator = state.instanceCreator;
  creator.submitting = true;
  state.error = null;
  render();
  try {
    const input = {
      kind: creator.kind,
      name: creator.name.trim(),
      username: creator.username.trim(),
      authMethod: creator.authMethod,
      password: creator.password,
      authorizedKey: creator.authorizedKey.trim(),
      privateKey: creator.privateKey,
      host: creator.host,
      port: creator.port ? Number(creator.port) : undefined
    };
    let created;
    if (window.monolith) {
      created = await window.monolith.instances.create(input);
      if (creator.startNow) created = await window.monolith.instances.start(created.id);
      await Promise.all([refreshInstances(), refreshAudit()]);
    } else {
      const nextPort = 2222 + state.instances.length;
      created = {
        id: crypto.randomUUID(),
        ...input,
        address: `${input.host}:${input.port || nextPort}`,
        authorizedKeyCount: input.authorizedKey ? 1 : 0,
        embeddedTerminalAvailable: input.authMethod !== 'publickey' || Boolean(input.privateKey),
        running: creator.startNow
      };
      state.instances.push(created);
    }
    creator.created = created;
    creator.phase = 'success';
  } catch (error) {
    state.error = error.code === 'PORT_IN_USE' ? portConflictMessage(error) : error.message;
  } finally {
    creator.submitting = false;
    render();
  }
});

async function hydrate() {
  if (!window.monolith) {
    state.loading = false;
    state.selectedInstanceId = state.instances[0].id;
    render();
    return;
  }

  try {
    const [{ version }] = await Promise.all([
      window.monolith.getAppInfo(),
      refreshInstances(),
      refreshAudit(),
      refreshCommandRules(),
      refreshLinuxBuiltins(),
      refreshVariables(),
      refreshMcpStatus()
    ]);
    document.querySelector('[data-app-version]').textContent = `v${version}-desktop`;
    removeAuditListener = window.monolith.audit.onEvent((auditEvent) => {
      state.auditEvents = [auditEvent, ...state.auditEvents].slice(0, 500);
      if (state.route === 'audit') render();
    });
    removeMcpListener = window.monolith.mcp.onStatus((status) => {
      state.mcpStatus = status;
      if (state.route === 'settings') render();
    });
  } catch (error) {
    state.error = error.message;
  } finally {
    state.loading = false;
    render();
  }
}

window.addEventListener('beforeunload', () => {
  activeViewCleanup?.();
  removeAuditListener?.();
  removeMcpListener?.();
});

mountShell();
void hydrate();
