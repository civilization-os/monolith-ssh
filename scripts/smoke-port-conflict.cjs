const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { SimulatorService } = require('../simulator/service-core.cjs');

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function findTestPort(start = 24000) {
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
  throw new Error('Unable to find a test port');
}

async function expectPortConflict(action, expectedPort) {
  try {
    await action();
    assert.fail('Expected a PORT_IN_USE error');
  } catch (error) {
    assert.equal(error.code, 'PORT_IN_USE');
    assert.equal(error.details.port, expectedPort);
    assert.ok(Number.isInteger(error.details.suggestedPort));
  }
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-port-conflict-'));
  const blocker = net.createServer();
  let service;

  try {
    fs.writeFileSync(path.join(dataDir, 'instances.json'), '[]');
    const occupiedPort = await findTestPort();

    service = new SimulatorService(dataDir);
    await service.init();
    const instance = await service.createInstance({
      kind: 'linux',
      name: 'port-conflict-test',
      username: 'root',
      password: 'monolith',
      port: occupiedPort
    });

    await listen(blocker, occupiedPort);
    await expectPortConflict(() => service.startInstance(instance.id), occupiedPort);

    const failedInstance = service.listInstances().find((item) => item.id === instance.id);
    assert.equal(failedInstance.lastError.code, 'PORT_IN_USE');
    assert.equal(failedInstance.lastError.port, occupiedPort);

    const status = await service.getPortStatus(instance.id);
    assert.equal(status.available, false);
    assert.ok(status.suggestedPort !== occupiedPort);

    const repaired = await service.repairAndStartInstance(instance.id);
    assert.equal(repaired.running, true);
    assert.notEqual(repaired.port, occupiedPort);
    assert.equal(repaired.lastError, null);

    await service.stopInstance(instance.id);
    await expectPortConflict(() => service.updateInstancePort(instance.id, occupiedPort), occupiedPort);

    await close(blocker);
    const restored = await service.updateInstancePort(instance.id, occupiedPort);
    assert.equal(restored.port, occupiedPort);
    assert.equal((await service.startInstance(instance.id)).running, true);
    await service.stopInstance(instance.id);

    console.log(`Port conflict smoke test passed: ${occupiedPort} -> ${repaired.port} -> ${occupiedPort}`);
  } finally {
    if (blocker.listening) await close(blocker);
    await service?.shutdown();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
