const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { Client } = require('ssh2');
const { describePublicKey, generateLoginKey } = require('../electron/credential-utils.cjs');
const { SshClientManager } = require('../electron/ssh-client-manager.cjs');
const { SimulatorService } = require('../simulator/service-core.cjs');

function execSsh({ host, port, username, password, privateKey, command }) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let output = '';
    client.on('ready', () => {
      client.exec(command, (error, stream) => {
        if (error) {
          reject(error);
          client.end();
          return;
        }
        stream.on('data', (data) => { output += data.toString(); });
        stream.stderr.on('data', (data) => { output += data.toString(); });
        stream.on('close', () => {
          client.end();
          resolve(output);
        });
      });
    });
    client.on('error', reject);
    const options = { host, port, username, readyTimeout: 5000 };
    if (password) options.password = password;
    if (privateKey) options.privateKey = privateKey;
    client.connect(options);
  });
}

function waitFor(predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error('Timed out waiting for SSH terminal output'));
      }
    }, 20);
  });
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-ssh-smoke-'));
  const service = new SimulatorService(tempRoot);
  const terminalClients = new SshClientManager();

  try {
    const networkPort = await findFreePort();
    const linuxPort = await findFreePort();
    const now = new Date().toISOString();
    fs.writeFileSync(path.join(tempRoot, 'instances.json'), JSON.stringify([
      { id: 'network-lab-01', name: 'router-lab-01', kind: 'network', template: 'Cisco IOS · Virtual', host: '127.0.0.1', port: networkPort, username: 'admin', password: 'monolith', autoStart: true, createdAt: now },
      { id: 'linux-lab-01', name: 'linux-lab-01', kind: 'linux', template: 'Ubuntu 24.04 · Virtual', host: '127.0.0.1', port: linuxPort, username: 'root', password: 'monolith', autoStart: true, createdAt: now }
    ], null, 2));
    await service.init();
    const instances = service.listInstances();
    const network = instances.find((instance) => instance.kind === 'network');
    const linux = instances.find((instance) => instance.kind === 'linux');
    if (JSON.stringify(instances).includes('monolith')) throw new Error('Instance list leaked a plaintext password');

    const keyPort = await findFreePort();
    const loginKey = generateLoginKey('operator@key-lab');
    const keyInstance = await service.createInstance({
      kind: 'linux',
      name: 'key-lab-01',
      username: 'operator',
      authMethod: 'publickey',
      authorizedKey: loginKey.publicKey,
      port: keyPort
    });
    await service.startInstance(keyInstance.id);
    const passwordAccess = service.getInstanceAccess(network.id);
    if (passwordAccess.password !== 'monolith' || passwordAccess.authorizedKeys.length !== 0) throw new Error('Password access details mismatch');
    const keyAccess = service.getInstanceAccess(keyInstance.id);
    if (keyAccess.password !== null || keyAccess.authorizedKeys[0] !== loginKey.publicKey) throw new Error('Public-key access details mismatch');
    if (describePublicKey(keyAccess.authorizedKeys[0]).fingerprint !== loginKey.fingerprint) throw new Error('Public-key fingerprint mismatch');

    const networkOutput = await execSsh({ ...service.getConnection(network.id), command: 'show version' });
    const linuxOutput = await execSsh({ ...service.getConnection(linux.id), command: 'pwd' });
    const keyOutput = await execSsh({ ...service.getConnection(keyInstance.id), privateKey: loginKey.privateKey, command: 'whoami' });

    if (!networkOutput.includes('Monolith Network OS')) throw new Error('Network simulator response mismatch');
    if (!linuxOutput.includes('/root')) throw new Error('Linux simulator response mismatch');
    if (!keyOutput.includes('operator')) throw new Error('Public-key simulator authentication mismatch');
    let rejectedPassword = false;
    try {
      await execSsh({ ...service.getConnection(keyInstance.id), password: 'not-accepted', command: 'whoami' });
    } catch {
      rejectedPassword = true;
    }
    if (!rejectedPassword) throw new Error('Public-key-only instance unexpectedly accepted a password');
    const rotated = service.updateInstanceCredentials(keyInstance.id, {
      username: 'rotated-operator',
      authMethod: 'password',
      password: 'rotated-password'
    });
    if (rotated.username !== 'rotated-operator' || rotated.authMethod !== 'password') throw new Error('Credential rotation did not update the public instance');
    const rotatedOutput = await execSsh({ ...service.getConnection(keyInstance.id), command: 'whoami' });
    if (!rotatedOutput.includes('rotated-operator')) throw new Error('Rotated password credential was not applied immediately');
    let rejectedOldKey = false;
    try {
      await execSsh({ host: keyInstance.host, port: keyInstance.port, username: 'operator', privateKey: loginKey.privateKey, command: 'whoami' });
    } catch {
      rejectedOldKey = true;
    }
    if (!rejectedOldKey) throw new Error('Replaced public key unexpectedly remained authorized');
    if (service.listAudit().filter((event) => event.type === 'authentication' && event.ok).length < 3) throw new Error('Authentication audit events missing');

    const terminalEvents = [];
    const fakeSender = {
      id: 1,
      isDestroyed: () => false,
      send: (channel, payload) => terminalEvents.push({ channel, payload })
    };
    const { sessionId } = await terminalClients.open(service.getConnection(network.id), fakeSender, { cols: 100, rows: 30 });
    await waitFor(() => terminalEvents.some((event) => event.channel === 'terminal:data' && event.payload.data.includes(network.name)));
    service.replaceCommandRules({ rules: [{
      id: 'type-live-rule-smoke-test',
      kind: 'network',
      scope: 'type',
      instanceId: null,
      mode: 'any',
      matchType: 'exact',
      pattern: 'show live-rule',
      output: 'type rule active on {{hostname}} for {{user}}',
      enabled: true
    }] });
    terminalClients.write(sessionId, 'show live-rule\r');
    await waitFor(() => terminalEvents.some((event) => event.channel === 'terminal:data' && event.payload.data.includes(`type rule active on ${network.name} for admin`)));
    service.replaceCommandRules({ rules: [
      {
        id: 'type-live-rule-smoke-test', kind: 'network', scope: 'type', instanceId: null, mode: 'any', matchType: 'exact',
        pattern: 'show live-rule', output: 'type rule should be overridden', enabled: true
      },
      {
        id: 'device-live-rule-smoke-test', kind: 'network', scope: 'instance', instanceId: network.id, mode: 'any', matchType: 'exact',
        pattern: 'show live-rule', output: 'device rule wins on {{instance}}', enabled: true
      }
    ] });
    terminalClients.write(sessionId, 'show live-rule\r');
    await waitFor(() => terminalEvents.some((event) => event.channel === 'terminal:data' && event.payload.data.includes(`device rule wins on ${network.name}`)));
    if (!fs.existsSync(path.join(tempRoot, 'command-rules.json'))) throw new Error('Command rules were not persisted');
    terminalClients.write(sessionId, 'show version\r');
    await waitFor(() => terminalEvents.some((event) => event.channel === 'terminal:data' && event.payload.data.includes('Version 17.9.4')));
    terminalClients.resize(sessionId, { cols: 120, rows: 40 });

    const { sessionId: linuxSessionId } = await terminalClients.open(service.getConnection(linux.id), fakeSender, { cols: 100, rows: 30 });
    await waitFor(() => terminalEvents.some((event) => event.channel === 'terminal:data' && event.payload.data.includes('Welcome to Monolith Linux')));
    const beforeInitialUptime = terminalEvents.length;
    terminalClients.write(linuxSessionId, 'uptime\r');
    await waitFor(() => terminalEvents.slice(beforeInitialUptime).some((event) => event.channel === 'terminal:data' && event.payload.data.includes('load average')));
    service.deleteLinuxBuiltin('uptime');
    const persistedBuiltinState = JSON.parse(fs.readFileSync(path.join(tempRoot, 'linux-builtins.json'), 'utf8'));
    if (!persistedBuiltinState.disabled.includes('uptime')) throw new Error('Deleted Linux built-in was not persisted');
    const reloadedServiceState = new SimulatorService(tempRoot).loadDisabledLinuxBuiltins();
    if (!reloadedServiceState.has('uptime')) throw new Error('Deleted Linux built-in did not reload from disk');
    const beforeDisabledUptime = terminalEvents.length;
    terminalClients.write(linuxSessionId, 'uptime\r');
    await waitFor(() => terminalEvents.slice(beforeDisabledUptime).some((event) => event.channel === 'terminal:data' && event.payload.data.includes('uptime: command not found')));
    service.restoreLinuxBuiltins();
    const beforeRestoredUptime = terminalEvents.length;
    terminalClients.write(linuxSessionId, 'uptime\r');
    await waitFor(() => terminalEvents.slice(beforeRestoredUptime).some((event) => event.channel === 'terminal:data' && event.payload.data.includes('load average')));

    service.replaceVariables({ variables: [
      { id: 'su-password-smoke', name: 'SU_PASSWORD', value: 'new-secret', secret: true, description: 'SSH smoke test credential' },
      { id: 'enable-password-smoke', name: 'ENABLE_PASSWORD', value: 'enable-secret', secret: true, description: 'Network interaction credential' }
    ] });
    service.replaceCommandRules({ rules: [
      ...service.listCommandRules(),
      {
        id: 'enable-interaction-smoke', kind: 'network', scope: 'type', instanceId: null, mode: 'user_exec', matchType: 'exact', pattern: 'enable', output: '', behavior: 'interactive',
        steps: [
          { id: 'enable-input', type: 'input', prompt: 'Password:', secret: true, saveAs: 'password' },
          { id: 'enable-verify', type: 'verify_variable', input: 'password', variable: 'ENABLE_PASSWORD', failureOutput: '% Access denied' },
          { id: 'enable-mode', type: 'set_mode', target: 'privileged_exec' },
          { id: 'enable-finish', type: 'finish' }
        ], enabled: true
      },
      {
        id: 'confirm-interaction-smoke', kind: 'linux', scope: 'type', instanceId: null, mode: 'shell', matchType: 'exact', pattern: 'confirm-demo', output: '', behavior: 'interactive',
        steps: [
          { id: 'confirm-input', type: 'input', prompt: 'Continue? [y/N]', secret: false, saveAs: 'answer' },
          { id: 'confirm-verify', type: 'verify_choice', input: 'answer', choices: ['yes', 'y'], failureOutput: 'Cancelled' },
          { id: 'confirm-output', type: 'output', text: 'Confirmed {{answer}}' },
          { id: 'confirm-finish', type: 'finish' }
        ], enabled: true
      },
      {
        id: 'su-interaction-smoke', kind: 'linux', scope: 'type', instanceId: null, mode: 'shell', matchType: 'command', pattern: 'su', output: '', behavior: 'interactive',
        inputPrompt: 'Password:', inputSecret: true, verifyVariable: 'SU_PASSWORD', action: 'switch_user', target: '{{arg1}}', successOutput: '', failureOutput: 'su: Authentication failure', requiresArgument: true, enabled: true
      }
    ] });
    const migratedSuRule = service.listCommandRules().find((rule) => rule.id === 'su-interaction-smoke');
    if (!migratedSuRule?.steps?.some((step) => step.type === 'set_user') || 'inputPrompt' in migratedSuRule) {
      throw new Error('Legacy interactive rule did not migrate to interaction steps');
    }
    const persistedVariables = JSON.parse(fs.readFileSync(path.join(tempRoot, 'variables.json'), 'utf8'));
    if (persistedVariables[0]?.value !== 'new-secret' || !persistedVariables[0]?.secret) throw new Error('Custom variables were not persisted');

    const beforeEnable = terminalEvents.length;
    terminalClients.write(sessionId, 'enable\r');
    await waitFor(() => terminalEvents.slice(beforeEnable).some((event) => event.channel === 'terminal:data' && event.payload.data.includes('Password:')));
    const beforeEnablePassword = terminalEvents.length;
    terminalClients.write(sessionId, 'enable-secret\r');
    await waitFor(() => terminalEvents.slice(beforeEnablePassword).some((event) => event.channel === 'terminal:data' && event.payload.data.includes(`${network.name}#`)));
    if (terminalEvents.slice(beforeEnablePassword).some((event) => event.channel === 'terminal:data' && event.payload.data.includes('enable-secret'))) throw new Error('Network secret interaction input was echoed');

    const beforeRejectedChoice = terminalEvents.length;
    terminalClients.write(linuxSessionId, 'confirm-demo\r');
    await waitFor(() => terminalEvents.slice(beforeRejectedChoice).some((event) => event.channel === 'terminal:data' && event.payload.data.includes('Continue? [y/N]')));
    terminalClients.write(linuxSessionId, 'n\r');
    await waitFor(() => terminalEvents.slice(beforeRejectedChoice).some((event) => event.channel === 'terminal:data' && event.payload.data.includes('Cancelled')));
    const beforeAcceptedChoice = terminalEvents.length;
    terminalClients.write(linuxSessionId, 'confirm-demo\r');
    await waitFor(() => terminalEvents.slice(beforeAcceptedChoice).some((event) => event.channel === 'terminal:data' && event.payload.data.includes('Continue? [y/N]')));
    terminalClients.write(linuxSessionId, 'yes\r');
    await waitFor(() => terminalEvents.slice(beforeAcceptedChoice).some((event) => event.channel === 'terminal:data' && event.payload.data.includes('Confirmed yes')));

    const beforeRejectedSu = terminalEvents.length;
    terminalClients.write(linuxSessionId, 'su alice\r');
    await waitFor(() => terminalEvents.slice(beforeRejectedSu).some((event) => event.channel === 'terminal:data' && event.payload.data.includes('Password:')));
    const beforeRejectedSecret = terminalEvents.length;
    terminalClients.write(linuxSessionId, 'wrong-secret\r');
    await waitFor(() => terminalEvents.slice(beforeRejectedSecret).some((event) => event.channel === 'terminal:data' && event.payload.data.includes('Authentication failure')));
    if (terminalEvents.slice(beforeRejectedSecret).some((event) => event.channel === 'terminal:data' && event.payload.data.includes('wrong-secret'))) throw new Error('Rejected secret interaction input was echoed');

    const beforeSu = terminalEvents.length;
    terminalClients.write(linuxSessionId, 'su alice\r');
    await waitFor(() => terminalEvents.slice(beforeSu).some((event) => event.channel === 'terminal:data' && event.payload.data.includes('Password:')));
    const beforeSecret = terminalEvents.length;
    terminalClients.write(linuxSessionId, 'new-secret\r');
    await waitFor(() => terminalEvents.slice(beforeSecret).some((event) => event.channel === 'terminal:data' && event.payload.data.includes('alice@')));
    if (terminalEvents.slice(beforeSecret).some((event) => event.channel === 'terminal:data' && event.payload.data.includes('new-secret'))) throw new Error('Secret interaction input was echoed');
    const beforeWhoami = terminalEvents.length;
    terminalClients.write(linuxSessionId, 'whoami\r');
    await waitFor(() => terminalEvents.slice(beforeWhoami).some((event) => event.channel === 'terminal:data' && event.payload.data.includes('alice')));
    const beforeExitUser = terminalEvents.length;
    terminalClients.write(linuxSessionId, 'exit\r');
    await waitFor(() => terminalEvents.slice(beforeExitUser).some((event) => event.channel === 'terminal:data' && event.payload.data.includes('root@')));
    if (service.listAudit().some((event) => String(event.action).includes('new-secret'))) throw new Error('Secret interaction input leaked into audit events');
    terminalClients.closeAll();

    console.log(`SSH smoke test passed: ${network.address}, ${linux.address}, password/public-key authentication, live credential rotation, rules, recoverable built-ins, su, choice and network-mode interactions`);
  } finally {
    terminalClients.closeAll();
    await service.shutdown();
    const expectedPrefix = `${path.resolve(os.tmpdir())}${path.sep}monolith-ssh-smoke-`;
    if (path.resolve(tempRoot).startsWith(expectedPrefix)) fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
