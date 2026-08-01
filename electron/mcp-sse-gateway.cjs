const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const DEFAULT_SETTINGS = Object.freeze({ enabled: false, host: '127.0.0.1', port: 3765 });
const SUPPORTED_PROTOCOLS = new Set(['2025-06-18', '2025-03-26', '2024-11-05']);

const RAW_TOOLS = [
  {
    name: 'monolith_get_state',
    description: 'Read the complete MonolithSSH application state: instances, command rules, variables, and Linux built-ins.',
    inputSchema: {
      type: 'object',
      properties: {
        includeSecrets: { type: 'boolean', default: false },
        includeAudit: { type: 'boolean', default: false },
        auditLimit: { type: 'integer', minimum: 1, maximum: 500, default: 100 }
      },
      additionalProperties: false
    }
  },
  {
    name: 'monolith_list_instances',
    description: 'List all local SSH simulator instances and their running state.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'monolith_get_instance',
    description: 'Read one SSH simulator instance by id.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 100 } }, required: ['id'], additionalProperties: false }
  },
  {
    name: 'monolith_get_instance_access',
    description: 'Read connection commands and configured authentication material. Passwords are redacted unless includeSecrets is explicitly true; managed private keys are never returned.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 1, maxLength: 100 },
        includeSecrets: { type: 'boolean', default: false }
      },
      required: ['id'],
      additionalProperties: false
    }
  },
  {
    name: 'monolith_create_instance',
    description: 'Create a Linux or network-device simulator instance with password, public-key, or combined SSH authentication and optionally start it.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['linux', 'network'] },
        name: { type: 'string', maxLength: 64 },
        username: { type: 'string', maxLength: 32 },
        authMethod: { type: 'string', enum: ['password', 'publickey', 'both'], default: 'password' },
        password: { type: 'string', maxLength: 256 },
        authorizedKey: { type: 'string', maxLength: 20000, description: 'One OpenSSH public key for publickey or both authentication.' },
        host: { type: 'string', enum: ['127.0.0.1', '0.0.0.0'], default: '127.0.0.1', description: 'Use 0.0.0.0 to accept connections from other devices.' },
        port: { type: 'integer', minimum: 1024, maximum: 65535 },
        start: { type: 'boolean', default: false }
      },
      required: ['kind'],
      additionalProperties: false
    }
  },
  {
    name: 'monolith_set_instance_running',
    description: 'Start or stop an SSH simulator instance.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, running: { type: 'boolean' } }, required: ['id', 'running'], additionalProperties: false }
  },
  {
    name: 'monolith_update_instance_endpoint',
    description: 'Change the listen host and port of a stopped SSH simulator instance.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        host: { type: 'string', enum: ['127.0.0.1', '0.0.0.0'] },
        port: { type: 'integer', minimum: 1024, maximum: 65535 },
        start: { type: 'boolean', default: false }
      },
      required: ['id', 'host', 'port'],
      additionalProperties: false
    }
  },
  {
    name: 'monolith_update_instance_credentials',
    description: 'Change the username, authentication method, password, and authorized public keys. New SSH connections use the updated credentials immediately.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 1, maxLength: 100 },
        username: { type: 'string', minLength: 1, maxLength: 32 },
        authMethod: { type: 'string', enum: ['password', 'publickey', 'both'] },
        password: { type: 'string', maxLength: 256 },
        authorizedKeys: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 20000 } }
      },
      required: ['id'],
      additionalProperties: false
    }
  },
  {
    name: 'monolith_get_instance_port_status',
    description: 'Check whether an instance listen endpoint is available, suggest another port, and report the owning process when available.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 100 } }, required: ['id'], additionalProperties: false }
  },
  {
    name: 'monolith_repair_instance_port',
    description: 'Move an instance to the next available local port and start it.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 100 } }, required: ['id'], additionalProperties: false }
  },
  {
    name: 'monolith_delete_instance',
    description: 'Delete an instance together with its local host key, state, and device-level rules.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false }
  },
  {
    name: 'monolith_execute_command',
    description: 'Execute one non-interactive command against a running instance and return its output.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 100 }, command: { type: 'string', minLength: 1, maxLength: 10000 } }, required: ['id', 'command'], additionalProperties: false }
  },
  {
    name: 'monolith_get_command_rules',
    description: 'List every type-level and device-level command rule.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'monolith_replace_command_rules',
    description: 'Replace all command rules. The new rules apply to existing SSH sessions immediately.',
    inputSchema: { type: 'object', properties: { rules: { type: 'array', maxItems: 500, items: { type: 'object' } } }, required: ['rules'], additionalProperties: false }
  },
  {
    name: 'monolith_get_variables',
    description: 'List custom variables. Secret values are redacted unless includeSecrets is true.',
    inputSchema: { type: 'object', properties: { includeSecrets: { type: 'boolean', default: false } }, additionalProperties: false }
  },
  {
    name: 'monolith_replace_variables',
    description: 'Replace all custom variables. New values apply to existing SSH sessions immediately.',
    inputSchema: { type: 'object', properties: { variables: { type: 'array', maxItems: 500, items: { type: 'object' } } }, required: ['variables'], additionalProperties: false }
  },
  {
    name: 'monolith_get_linux_builtins',
    description: 'List the Linux built-in command catalog and enabled state.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'monolith_set_linux_builtin',
    description: 'Enable or disable one Linux built-in command immediately.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, enabled: { type: 'boolean' } }, required: ['id', 'enabled'], additionalProperties: false }
  },
  {
    name: 'monolith_restore_linux_builtins',
    description: 'Restore the complete default Linux built-in command catalog.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'monolith_get_audit',
    description: 'Search and filter recent local audit events.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
        instanceId: { type: 'string', maxLength: 100 },
        type: { type: 'string', maxLength: 100 },
        source: { type: 'string', maxLength: 200 },
        ok: { type: 'boolean' },
        query: { type: 'string', maxLength: 500 },
        since: { type: 'string', maxLength: 50, description: 'ISO-8601 lower timestamp bound.' }
      },
      additionalProperties: false
    }
  }
];

const READ_ONLY_TOOL_NAMES = new Set([
  'monolith_get_state', 'monolith_list_instances', 'monolith_get_instance', 'monolith_get_instance_access',
  'monolith_get_instance_port_status', 'monolith_get_command_rules', 'monolith_get_variables',
  'monolith_get_linux_builtins', 'monolith_get_audit'
]);
const DESTRUCTIVE_TOOL_NAMES = new Set([
  'monolith_delete_instance', 'monolith_execute_command', 'monolith_replace_command_rules',
  'monolith_replace_variables', 'monolith_restore_linux_builtins', 'monolith_update_instance_credentials'
]);
const NON_IDEMPOTENT_TOOL_NAMES = new Set(['monolith_create_instance', 'monolith_execute_command', 'monolith_repair_instance_port']);
const TOOLS = Object.freeze(RAW_TOOLS.map((tool) => Object.freeze({
  ...tool,
  annotations: {
    readOnlyHint: READ_ONLY_TOOL_NAMES.has(tool.name),
    destructiveHint: DESTRUCTIVE_TOOL_NAMES.has(tool.name),
    idempotentHint: !NON_IDEMPOTENT_TOOL_NAMES.has(tool.name),
    openWorldHint: false
  }
})));

function redactVariables(variables, includeSecrets) {
  return variables.map((variable) => ({
    ...variable,
    value: variable.secret && !includeSecrets ? '***' : variable.value
  }));
}

function toolResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value
  };
}

function validateSchema(value, schema, path = 'arguments') {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`);
    for (const key of schema.required ?? []) {
      if (value[key] === undefined) throw new Error(`${path}.${key} is required`);
    }
    if (schema.additionalProperties === false) {
      const unknown = Object.keys(value).find((key) => !Object.hasOwn(schema.properties ?? {}, key));
      if (unknown) throw new Error(`${path}.${unknown} is not supported`);
    }
    for (const [key, child] of Object.entries(value)) {
      if (schema.properties?.[key]) validateSchema(child, schema.properties[key], `${path}.${key}`);
    }
    return;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) throw new Error(`${path} must contain at most ${schema.maxItems} items`);
    value.forEach((item, index) => validateSchema(item, schema.items ?? {}, `${path}[${index}]`));
    return;
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') throw new Error(`${path} must be a string`);
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) throw new Error(`${path} is too short`);
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) throw new Error(`${path} exceeds ${schema.maxLength} characters`);
    if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path} must be one of: ${schema.enum.join(', ')}`);
    return;
  }
  if (schema.type === 'integer') {
    if (!Number.isInteger(value)) throw new Error(`${path} must be an integer`);
    if (Number.isFinite(schema.minimum) && value < schema.minimum) throw new Error(`${path} must be at least ${schema.minimum}`);
    if (Number.isFinite(schema.maximum) && value > schema.maximum) throw new Error(`${path} must not exceed ${schema.maximum}`);
    return;
  }
  if (schema.type === 'boolean' && typeof value !== 'boolean') throw new Error(`${path} must be a boolean`);
}

function redactInstanceAccess(access, includeSecrets, privateKeyManaged) {
  return {
    ...access,
    password: access.password && !includeSecrets ? '***' : access.password,
    privateKeyManaged
  };
}

class McpSseGateway extends EventEmitter {
  constructor({
    simulator,
    settingsPath,
    portOwnerResolver = async () => null,
    credentialStatusResolver = () => ({ privateKeyManaged: false }),
    credentialMutationResolver = () => {},
    credentialDeleteResolver = () => {}
  }) {
    super();
    this.simulator = simulator;
    this.settingsPath = path.resolve(settingsPath);
    this.portOwnerResolver = portOwnerResolver;
    this.credentialStatusResolver = credentialStatusResolver;
    this.credentialMutationResolver = credentialMutationResolver;
    this.credentialDeleteResolver = credentialDeleteResolver;
    this.settings = { ...DEFAULT_SETTINGS };
    this.server = null;
    this.legacyStreams = new Map();
    this.lastError = null;
  }

  async init() {
    this.settings = this.loadSettings();
    if (this.settings.enabled) {
      try {
        await this.start();
      } catch (error) {
        this.lastError = error.message;
        this.settings.enabled = false;
        this.saveSettings();
      }
    }
    return this.getStatus();
  }

  loadSettings() {
    if (!fs.existsSync(this.settingsPath)) return { ...DEFAULT_SETTINGS };
    try {
      const stored = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8'));
      return {
        enabled: stored?.enabled === true,
        host: DEFAULT_SETTINGS.host,
        port: Number.isInteger(stored?.port) && stored.port >= 1024 && stored.port <= 65535 ? stored.port : DEFAULT_SETTINGS.port
      };
    } catch (error) {
      this.lastError = `MCP settings were reset: ${error.message}`;
      return { ...DEFAULT_SETTINGS };
    }
  }

  saveSettings() {
    fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true });
    fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2));
  }

  getStatus() {
    const origin = `http://${this.settings.host}:${this.settings.port}`;
    return {
      enabled: this.settings.enabled,
      running: Boolean(this.server?.listening),
      host: this.settings.host,
      port: this.settings.port,
      endpoint: `${origin}/mcp`,
      sseEndpoint: `${origin}/sse`,
      lastError: this.lastError,
      toolCount: TOOLS.length
    };
  }

  async updateSettings(input = {}) {
    const enabled = input.enabled === true;
    this.lastError = null;
    if (enabled) {
      this.settings.enabled = true;
      try {
        await this.start();
      } catch (error) {
        this.settings.enabled = false;
        this.lastError = error.message;
        this.saveSettings();
        throw error;
      }
    } else {
      this.settings.enabled = false;
      await this.stop();
    }
    this.saveSettings();
    const status = this.getStatus();
    this.emit('status', status);
    return status;
  }

  start() {
    if (this.server?.listening) return Promise.resolve(this.getStatus());
    this.server = http.createServer((request, response) => {
      void this.handleRequest(request, response).catch((error) => {
        if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        if (!response.writableEnded) response.end(JSON.stringify({ error: error.message }));
      });
    });
    return new Promise((resolve, reject) => {
      const onError = (error) => {
        this.server?.off('listening', onListening);
        this.server = null;
        reject(error);
      };
      const onListening = () => {
        this.server?.off('error', onError);
        resolve(this.getStatus());
      };
      this.server.once('error', onError);
      this.server.once('listening', onListening);
      this.server.listen(this.settings.port, this.settings.host);
    });
  }

  async stop() {
    for (const response of this.legacyStreams.values()) response.end();
    this.legacyStreams.clear();
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise((resolve) => server.close(resolve));
  }

  validateLocalRequest(request) {
    const hostHeader = String(request.headers.host ?? '');
    let requestHost = '';
    try {
      requestHost = new URL(`http://${hostHeader}`).hostname;
    } catch {
      throw new Error('Invalid Host header');
    }
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(requestHost)) throw new Error('Host is not allowed');
    const origin = request.headers.origin;
    if (!origin) return;
    let originHost = '';
    try {
      originHost = new URL(origin).hostname;
    } catch {
      throw new Error('Invalid Origin header');
    }
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(originHost)) throw new Error('Origin is not allowed');
  }

  readJson(request) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      request.on('data', (chunk) => {
        size += chunk.length;
        if (size > 1024 * 1024) {
          reject(new Error('Request body exceeds 1 MiB'));
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new Error('Request body must be valid JSON'));
        }
      });
      request.on('error', reject);
    });
  }

  async handleRequest(request, response) {
    try {
      this.validateLocalRequest(request);
    } catch (error) {
      response.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: error.message }));
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === 'GET' && url.pathname === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ ok: true, stateless: true, tools: TOOLS.length }));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/mcp') {
      await this.handleStatelessPost(request, response);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/mcp') {
      response.writeHead(405, { Allow: 'POST', 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'This stateless endpoint does not keep a standalone GET stream' }));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/sse') {
      this.handleLegacySse(response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/messages') {
      await this.handleLegacyMessage(request, response, url.searchParams.get('sessionId'));
      return;
    }
    response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Not found' }));
  }

  async handleStatelessPost(request, response) {
    const message = await this.readJson(request);
    const rpcResponse = await this.dispatchRpc(message);
    if (!rpcResponse) {
      response.writeHead(202, { 'Cache-Control': 'no-store' });
      response.end();
      return;
    }
    const acceptsSse = String(request.headers.accept ?? '').includes('text/event-stream');
    if (acceptsSse) {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-store',
        Connection: 'keep-alive'
      });
      response.end(`event: message\ndata: ${JSON.stringify(rpcResponse)}\n\n`);
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(rpcResponse));
  }

  handleLegacySse(response) {
    const sessionId = randomUUID();
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive'
    });
    this.legacyStreams.set(sessionId, response);
    response.write(`event: endpoint\ndata: /messages?sessionId=${encodeURIComponent(sessionId)}\n\n`);
    response.on('close', () => this.legacyStreams.delete(sessionId));
  }

  async handleLegacyMessage(request, response, sessionId) {
    const stream = sessionId ? this.legacyStreams.get(sessionId) : null;
    if (!stream) {
      response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'Unknown or closed SSE connection' }));
      return;
    }
    const message = await this.readJson(request);
    const rpcResponse = await this.dispatchRpc(message);
    response.writeHead(202, { 'Cache-Control': 'no-store' });
    response.end();
    if (rpcResponse && !stream.writableEnded) stream.write(`event: message\ndata: ${JSON.stringify(rpcResponse)}\n\n`);
  }

  async dispatchRpc(message) {
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return { jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid JSON-RPC request' } };
    }
    const notification = message.id === undefined;
    try {
      let result;
      if (message.method === 'initialize') {
        const requested = message.params?.protocolVersion;
        result = {
          protocolVersion: SUPPORTED_PROTOCOLS.has(requested) ? requested : '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'monolithssh', version: '0.1.0' },
          instructions: 'Stateless local control surface for MonolithSSH. Mutations are handled by the application service; the MCP gateway stores no business state. Secret values are redacted unless a tool call explicitly sets includeSecrets to true. Managed private keys are never returned.'
        };
      } else if (message.method === 'ping') {
        result = {};
      } else if (message.method === 'tools/list') {
        result = { tools: TOOLS };
      } else if (message.method === 'tools/call') {
        result = await this.callTool(message.params?.name, message.params?.arguments ?? {});
      } else if (message.method.startsWith('notifications/')) {
        return null;
      } else {
        return notification ? null : { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } };
      }
      return notification ? null : { jsonrpc: '2.0', id: message.id, result };
    } catch (error) {
      if (notification) return null;
      if (message.method === 'tools/call') {
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: { content: [{ type: 'text', text: error.message }], isError: true }
        };
      }
      return { jsonrpc: '2.0', id: message.id, error: { code: -32000, message: error.message } };
    }
  }

  async callTool(name, args) {
    const tool = TOOLS.find((item) => item.name === name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    validateSchema(args, tool.inputSchema);
    if (name === 'monolith_get_state') {
      const [instances, rules, variables, builtins, audit] = await Promise.all([
        this.simulator.request('instances:list'),
        this.simulator.request('commands:list'),
        this.simulator.request('variables:list'),
        this.simulator.request('builtins:list'),
        args.includeAudit === true ? this.simulator.request('audit:list') : Promise.resolve(null)
      ]);
      const value = { instances, rules, variables: redactVariables(variables, args.includeSecrets === true), builtins };
      value.instanceAccess = await Promise.all(instances.map(async (instance) => {
        const access = await this.simulator.request('instances:access', { id: instance.id });
        const credentialStatus = await this.credentialStatusResolver(instance.id);
        return redactInstanceAccess(access, args.includeSecrets === true, credentialStatus?.privateKeyManaged === true);
      }));
      if (audit) value.audit = audit.slice(0, Number.isInteger(args.auditLimit) ? args.auditLimit : 100);
      return toolResult(value);
    }
    if (name === 'monolith_list_instances') return toolResult(await this.simulator.request('instances:list'));
    if (name === 'monolith_get_instance') {
      const instances = await this.simulator.request('instances:list');
      const instance = instances.find((item) => item.id === args.id);
      if (!instance) throw new Error(`Unknown instance: ${args.id}`);
      return toolResult(instance);
    }
    if (name === 'monolith_get_instance_access') {
      const access = await this.simulator.request('instances:access', { id: args.id });
      const credentialStatus = await this.credentialStatusResolver(args.id);
      return toolResult(redactInstanceAccess(access, args.includeSecrets === true, credentialStatus?.privateKeyManaged === true));
    }
    if (name === 'monolith_create_instance') {
      const instance = await this.simulator.request('instances:create', {
        kind: args.kind,
        name: args.name,
        username: args.username,
        authMethod: args.authMethod,
        password: args.password,
        authorizedKey: args.authorizedKey,
        host: args.host,
        port: args.port
      });
      if (args.start === true) return toolResult(await this.simulator.request('instances:start', { id: instance.id }));
      return toolResult(instance);
    }
    if (name === 'monolith_set_instance_running') {
      const method = args.running ? 'instances:start' : 'instances:stop';
      return toolResult(await this.simulator.request(method, { id: args.id }));
    }
    if (name === 'monolith_update_instance_endpoint') {
      const instance = await this.simulator.request('instances:update-endpoint', { id: args.id, host: args.host, port: args.port });
      if (args.start === true) return toolResult(await this.simulator.request('instances:start', { id: instance.id }));
      return toolResult(instance);
    }
    if (name === 'monolith_update_instance_credentials') {
      const updated = await this.simulator.request('instances:update-credentials', {
        id: args.id,
        username: args.username,
        authMethod: args.authMethod,
        password: args.password,
        authorizedKeys: args.authorizedKeys
      });
      await this.credentialMutationResolver(args.id, args);
      return toolResult(updated);
    }
    if (name === 'monolith_get_instance_port_status') {
      const status = await this.simulator.request('instances:port-status', { id: args.id });
      const owner = status.available || status.occupiedBySelf ? null : await this.portOwnerResolver(status.port);
      return toolResult({ ...status, owner });
    }
    if (name === 'monolith_repair_instance_port') return toolResult(await this.simulator.request('instances:repair-port', { id: args.id }));
    if (name === 'monolith_delete_instance') {
      const deleted = await this.simulator.request('instances:delete', { id: args.id });
      await this.credentialDeleteResolver(args.id);
      return toolResult(deleted);
    }
    if (name === 'monolith_execute_command') return toolResult(await this.simulator.request('instances:execute', { id: args.id, command: args.command }));
    if (name === 'monolith_get_command_rules') return toolResult(await this.simulator.request('commands:list'));
    if (name === 'monolith_replace_command_rules') return toolResult(await this.simulator.request('commands:save', { rules: args.rules }));
    if (name === 'monolith_get_variables') {
      const variables = await this.simulator.request('variables:list');
      return toolResult(redactVariables(variables, args.includeSecrets === true));
    }
    if (name === 'monolith_replace_variables') return toolResult(await this.simulator.request('variables:save', { variables: args.variables }));
    if (name === 'monolith_get_linux_builtins') return toolResult(await this.simulator.request('builtins:list'));
    if (name === 'monolith_set_linux_builtin') {
      const method = args.enabled ? 'builtins:enable' : 'builtins:delete';
      return toolResult(await this.simulator.request(method, { id: args.id }));
    }
    if (name === 'monolith_restore_linux_builtins') return toolResult(await this.simulator.request('builtins:restore'));
    if (name === 'monolith_get_audit') {
      const events = await this.simulator.request('audit:list');
      const limit = Number.isInteger(args.limit) ? Math.min(500, Math.max(1, args.limit)) : 100;
      const since = args.since ? Date.parse(args.since) : null;
      if (args.since && !Number.isFinite(since)) throw new Error('arguments.since must be a valid ISO-8601 timestamp');
      const query = String(args.query ?? '').toLowerCase();
      const filtered = events.filter((event) => {
        if (args.instanceId && event.instanceId !== args.instanceId) return false;
        if (args.type && event.type !== args.type) return false;
        if (args.source && event.source !== args.source) return false;
        if (typeof args.ok === 'boolean' && event.ok !== args.ok) return false;
        if (since && Date.parse(event.timestamp) < since) return false;
        if (query && !Object.values(event).join(' ').toLowerCase().includes(query)) return false;
        return true;
      });
      return toolResult(filtered.slice(0, limit));
    }
    throw new Error(`Tool is registered but not implemented: ${name}`);
  }
}

module.exports = { McpSseGateway, MCP_TOOL_COUNT: TOOLS.length };
