const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { McpSseGateway, MCP_TOOL_COUNT } = require('../electron/mcp-sse-gateway.cjs');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function rpc(id, method, params = {}) {
  return { jsonrpc: '2.0', id, method, params };
}

async function postJson(url, message, accept = 'application/json') {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Accept: accept, 'Content-Type': 'application/json' },
    body: JSON.stringify(message)
  });
  const body = await response.text();
  assert.equal(response.status, 200);
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    const data = body.match(/data: (.+)/)?.[1];
    assert.ok(data, 'SSE response must contain a data event');
    return JSON.parse(data);
  }
  return JSON.parse(body);
}

function legacyRoundTrip(origin, message) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let sent = false;
    const request = http.get(`${origin}/sse`, (response) => {
      response.setEncoding('utf8');
      response.on('data', async (chunk) => {
        buffer += chunk;
        const endpoint = buffer.match(/event: endpoint\ndata: ([^\n]+)/)?.[1];
        if (endpoint && !sent) {
          sent = true;
          try {
            const post = await fetch(new URL(endpoint, origin), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(message)
            });
            assert.equal(post.status, 202);
          } catch (error) {
            request.destroy();
            reject(error);
          }
        }
        const data = buffer.match(/event: message\ndata: (.+)\n\n/)?.[1];
        if (data) {
          request.destroy();
          resolve(JSON.parse(data));
        }
      });
      response.on('error', reject);
    });
    request.on('error', reject);
  });
}

async function main() {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-mcp-'));
  const settingsPath = path.join(tempDirectory, 'mcp-settings.json');
  const calls = [];
  const credentialEvents = [];
  const simulator = {
    async request(method, payload) {
      calls.push({ method, payload });
      if (method === 'instances:list') return [{ id: 'linux-1', name: 'linux-lab', host: '127.0.0.1', port: 2222, running: true }];
      if (method === 'instances:access') return {
        id: 'linux-1', name: 'linux-lab', host: '127.0.0.1', port: 2222, address: '127.0.0.1:2222',
        username: 'root', authMethod: 'password', password: 'instance-secret', authorizedKeys: []
      };
      if (method === 'instances:port-status') return { available: false, occupiedBySelf: false, host: '127.0.0.1', port: 2222, suggestedPort: 2223 };
      if (method === 'commands:list') return [];
      if (method === 'variables:list') return [
        { name: 'PUBLIC_VALUE', value: 'visible', secret: false },
        { name: 'SU_PASSWORD', value: 'monolith', secret: true }
      ];
      if (method === 'builtins:list') return [{ id: 'whoami', enabled: true }];
      if (method === 'audit:list') return [
        { id: 'audit-1', timestamp: '2026-08-01T08:00:00.000Z', type: 'instance.start', ok: true, instanceId: 'linux-1', source: 'local', action: 'Listening' },
        { id: 'audit-2', timestamp: '2026-08-01T07:00:00.000Z', type: 'authentication', ok: false, instanceId: 'linux-1', source: '127.0.0.1', action: 'Rejected' }
      ];
      return { ok: true, method, payload };
    }
  };
  const gateway = new McpSseGateway({
    simulator,
    settingsPath,
    portOwnerResolver: async () => ({ pid: 4242, processName: 'test-owner.exe' }),
    credentialStatusResolver: () => ({ privateKeyManaged: true }),
    credentialMutationResolver: (id) => credentialEvents.push(`mutate:${id}`),
    credentialDeleteResolver: (id) => credentialEvents.push(`delete:${id}`)
  });

  try {
    await gateway.init();
    assert.equal(gateway.getStatus().running, false);
    gateway.settings.port = await freePort();
    const enabled = await gateway.updateSettings({ enabled: true });
    assert.equal(enabled.running, true);
    const origin = `http://${enabled.host}:${enabled.port}`;

    const health = await fetch(`${origin}/health`).then((response) => response.json());
    assert.deepEqual(health, { ok: true, stateless: true, tools: MCP_TOOL_COUNT });

    const initialized = await postJson(`${origin}/mcp`, rpc(1, 'initialize', { protocolVersion: '2025-06-18' }));
    assert.equal(initialized.result.protocolVersion, '2025-06-18');

    const listed = await postJson(`${origin}/mcp`, rpc(2, 'tools/list'), 'application/json, text/event-stream');
    assert.equal(listed.result.tools.length, MCP_TOOL_COUNT);
    assert.equal(MCP_TOOL_COUNT, 20);
    assert.equal(listed.result.tools.find((tool) => tool.name === 'monolith_get_instance_access').annotations.readOnlyHint, true);
    assert.equal(listed.result.tools.find((tool) => tool.name === 'monolith_delete_instance').annotations.destructiveHint, true);

    const variables = await postJson(`${origin}/mcp`, rpc(3, 'tools/call', {
      name: 'monolith_get_variables',
      arguments: {}
    }));
    assert.equal(variables.result.structuredContent[0].value, 'visible');
    assert.equal(variables.result.structuredContent[1].value, '***');

    const access = await postJson(`${origin}/mcp`, rpc(4, 'tools/call', {
      name: 'monolith_get_instance_access',
      arguments: { id: 'linux-1' }
    }));
    assert.equal(access.result.structuredContent.password, '***');
    assert.equal(access.result.structuredContent.privateKeyManaged, true);
    const accessWithSecrets = await postJson(`${origin}/mcp`, rpc(5, 'tools/call', {
      name: 'monolith_get_instance_access',
      arguments: { id: 'linux-1', includeSecrets: true }
    }));
    assert.equal(accessWithSecrets.result.structuredContent.password, 'instance-secret');

    const portStatus = await postJson(`${origin}/mcp`, rpc(6, 'tools/call', {
      name: 'monolith_get_instance_port_status',
      arguments: { id: 'linux-1' }
    }));
    assert.equal(portStatus.result.structuredContent.owner.processName, 'test-owner.exe');

    const audit = await postJson(`${origin}/mcp`, rpc(7, 'tools/call', {
      name: 'monolith_get_audit',
      arguments: { ok: false, type: 'authentication', query: 'rejected' }
    }));
    assert.equal(audit.result.structuredContent.length, 1);
    assert.equal(audit.result.structuredContent[0].id, 'audit-2');

    const invalid = await postJson(`${origin}/mcp`, rpc(8, 'tools/call', {
      name: 'monolith_get_instance',
      arguments: { id: 'linux-1', unexpected: true }
    }));
    assert.equal(invalid.result.isError, true);
    assert.match(invalid.result.content[0].text, /unexpected is not supported/);

    await postJson(`${origin}/mcp`, rpc(9, 'tools/call', {
      name: 'monolith_update_instance_credentials',
      arguments: { id: 'linux-1', username: 'operator', authMethod: 'password', password: 'rotated-secret' }
    }));
    assert.ok(calls.some((entry) => entry.method === 'instances:update-credentials' && entry.payload.password === 'rotated-secret'));
    assert.ok(credentialEvents.includes('mutate:linux-1'));

    await postJson(`${origin}/mcp`, rpc(10, 'tools/call', {
      name: 'monolith_delete_instance',
      arguments: { id: 'linux-1' }
    }));
    assert.ok(credentialEvents.includes('delete:linux-1'));

    const legacy = await legacyRoundTrip(origin, rpc(11, 'ping'));
    assert.deepEqual(legacy.result, {});

    await gateway.updateSettings({ enabled: false });
    assert.equal(gateway.getStatus().running, false);
    assert.equal(gateway.legacyStreams.size, 0);
    const savedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.deepEqual(Object.keys(savedSettings).sort(), ['enabled', 'host', 'port']);
    assert.equal(savedSettings.enabled, false);
    assert.ok(calls.some((entry) => entry.method === 'variables:list'));

    console.log(`MCP smoke check passed: ${MCP_TOOL_COUNT} tools, modern HTTP/SSE and legacy SSE verified`);
  } finally {
    await gateway.stop();
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
