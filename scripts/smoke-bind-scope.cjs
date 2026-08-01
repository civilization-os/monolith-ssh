const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { SimulatorService } = require('../simulator/service-core.cjs');

function connect(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(4000);
    socket.once('connect', () => {
      socket.destroy();
      resolve();
    });
    socket.once('timeout', () => reject(new Error(`Timed out connecting to ${host}:${port}`)));
    socket.once('error', reject);
  });
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function findTestPort(start = 26000) {
  for (let port = start; port < start + 1000; port += 1) {
    const probe = net.createServer();
    try {
      await listen(probe, port);
      await close(probe);
      return port;
    } catch {
      if (probe.listening) await close(probe);
    }
  }
  throw new Error('Unable to find a bind-scope test port');
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-bind-scope-'));
  const service = new SimulatorService(dataDir);

  try {
    fs.writeFileSync(path.join(dataDir, 'instances.json'), '[]');
    await service.init();
    const port = await findTestPort();

    await assert.rejects(
      () => service.createInstance({ kind: 'linux', host: '192.0.2.10', password: 'monolith' }),
      /Listen host/
    );

    const created = await service.createInstance({
      kind: 'linux',
      name: 'lan-bind-test',
      username: 'root',
      password: 'monolith',
      host: '0.0.0.0',
      port
    });
    assert.equal(created.host, '0.0.0.0');

    const runningLan = await service.startInstance(created.id);
    assert.equal(runningLan.running, true);
    await connect('127.0.0.1', runningLan.port);
    const connection = service.getConnection(created.id);
    assert.equal(connection.host, '127.0.0.1');
    assert.equal(connection.bindHost, '0.0.0.0');

    await service.stopInstance(created.id);
    const local = await service.updateInstanceEndpoint(created.id, { host: '127.0.0.1', port: runningLan.port });
    assert.equal(local.host, '127.0.0.1');
    assert.equal((await service.startInstance(created.id)).running, true);
    await connect('127.0.0.1', local.port);

    console.log(`Bind scope smoke test passed on port ${local.port}: 0.0.0.0 -> 127.0.0.1`);
  } finally {
    await service.shutdown();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
