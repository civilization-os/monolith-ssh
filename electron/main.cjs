const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { CredentialVault } = require('./credential-vault.cjs');
const { describePublicKey, generateLoginKey, generatePassword } = require('./credential-utils.cjs');
const { SimulatorManager } = require('./simulator-manager.cjs');
const { SshClientManager } = require('./ssh-client-manager.cjs');
const { McpSseGateway } = require('./mcp-sse-gateway.cjs');
const { findPortOwner } = require('./port-diagnostics.cjs');

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const WINDOW_CHROME = Object.freeze({ background: '#191a18', foreground: '#f4f5ef', height: 36 });
const sshClients = new SshClientManager();
let simulator = null;
let mcpGateway = null;
let credentialVault = null;
let shutdownStarted = false;

function serializeError(error) {
  return {
    code: error?.code ?? 'REQUEST_FAILED',
    message: error?.message ?? 'The operation failed',
    details: error?.details ?? null
  };
}

async function instanceAction(action) {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
}

function decorateInstance(instance) {
  const hasPrivateKey = credentialVault?.has(instance.id) === true;
  return {
    ...instance,
    hasPrivateKey,
    embeddedTerminalAvailable: instance.authMethod !== 'publickey' || hasPrivateKey
  };
}

async function savePrivateKeyDialog(event, privateKey, suggestedName) {
  const owner = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showSaveDialog(owner, {
    title: 'Save SSH private key',
    defaultPath: String(suggestedName || 'monolithssh-key.pem').replace(/[^A-Za-z0-9._-]/g, '-'),
    filters: [{ name: 'PEM private key', extensions: ['pem'] }]
  });
  if (result.canceled || !result.filePath) return { saved: false };
  fs.writeFileSync(result.filePath, String(privateKey), { mode: 0o600 });
  return { saved: true, path: result.filePath };
}

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 920,
    minHeight: 640,
    backgroundColor: '#f7f7f5',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: WINDOW_CHROME.background,
      symbolColor: WINDOW_CHROME.foreground,
      height: WINDOW_CHROME.height
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const webContentsId = window.webContents.id;
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => sshClients.closeForSender(webContentsId));

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDevelopment) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

function broadcast(channel, payload) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.webContents.isDestroyed()) window.webContents.send(channel, payload);
  }
}

function registerIpcHandlers() {
  ipcMain.handle('app:get-info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform
  }));

  ipcMain.handle('instances:list', async () => (await simulator.request('instances:list')).map(decorateInstance));
  ipcMain.handle('instances:create', (_event, input = {}) => instanceAction(async () => {
    const { privateKey: suppliedPrivateKey, ...simulatorInput } = input;
    const privateKey = typeof suppliedPrivateKey === 'string' ? suppliedPrivateKey : null;
    const instance = await simulator.request('instances:create', simulatorInput);
    if (privateKey) credentialVault.set(instance.id, { privateKey });
    return decorateInstance(instance);
  }));
  ipcMain.handle('instances:start', (_event, id) => instanceAction(async () => decorateInstance(await simulator.request('instances:start', { id }))));
  ipcMain.handle('instances:stop', async (_event, id) => decorateInstance(await simulator.request('instances:stop', { id })));
  ipcMain.handle('instances:delete', async (_event, id) => {
    const deleted = await simulator.request('instances:delete', { id });
    credentialVault.delete(id);
    return decorateInstance(deleted);
  });
  ipcMain.handle('instances:diagnose-port', (_event, id) => instanceAction(async () => {
    const status = await simulator.request('instances:port-status', { id });
    const owner = status.available || status.occupiedBySelf ? null : await findPortOwner(status.port);
    return { ...status, owner };
  }));
  ipcMain.handle('instances:update-port', (_event, { id, port, start }) => instanceAction(async () => {
    const updated = await simulator.request('instances:update-port', { id, port });
    if (start === true) return decorateInstance(await simulator.request('instances:start', { id }));
    return decorateInstance(updated);
  }));
  ipcMain.handle('instances:update-endpoint', (_event, { id, host, port, start }) => instanceAction(async () => {
    const updated = await simulator.request('instances:update-endpoint', { id, host, port });
    if (start === true) return decorateInstance(await simulator.request('instances:start', { id }));
    return decorateInstance(updated);
  }));
  ipcMain.handle('instances:repair-port', (_event, id) => instanceAction(async () => decorateInstance(await simulator.request('instances:repair-port', { id }))));
  ipcMain.handle('credentials:generate-password', (_event, length) => generatePassword(length));
  ipcMain.handle('credentials:generate-key', (_event, label) => generateLoginKey(label));
  ipcMain.handle('credentials:save-private-key', (event, { privateKey, suggestedName }) => savePrivateKeyDialog(event, privateKey, suggestedName));
  ipcMain.handle('credentials:get-instance-access', (_event, id) => instanceAction(async () => {
    const access = await simulator.request('instances:access', { id });
    const stored = credentialVault.get(id);
    const { authorizedKeys, ...details } = access;
    return {
      ...details,
      publicKeys: authorizedKeys.map((publicKey) => ({ publicKey, ...describePublicKey(publicKey) })),
      privateKeyManaged: Boolean(stored?.privateKey)
    };
  }));
  ipcMain.handle('credentials:export-instance-private-key', (event, id) => instanceAction(async () => {
    const access = await simulator.request('instances:access', { id });
    const stored = credentialVault.get(id);
    if (!stored?.privateKey) throw new Error('No managed private key is available for this instance');
    return savePrivateKeyDialog(event, stored.privateKey, `${access.name}.pem`);
  }));
  ipcMain.handle('commands:list', () => simulator.request('commands:list'));
  ipcMain.handle('commands:save', (_event, rules) => simulator.request('commands:save', { rules }));
  ipcMain.handle('variables:list', () => simulator.request('variables:list'));
  ipcMain.handle('variables:save', (_event, variables) => simulator.request('variables:save', { variables }));
  ipcMain.handle('builtins:list', () => simulator.request('builtins:list'));
  ipcMain.handle('builtins:delete', (_event, id) => simulator.request('builtins:delete', { id }));
  ipcMain.handle('builtins:restore', () => simulator.request('builtins:restore'));
  ipcMain.handle('audit:list', () => simulator.request('audit:list'));
  ipcMain.handle('mcp:get-status', () => mcpGateway.getStatus());
  ipcMain.handle('mcp:set-enabled', (_event, enabled) => mcpGateway.updateSettings({ enabled }));

  ipcMain.handle('terminal:open', async (event, { instanceId, dimensions }) => {
    const connection = await simulator.request('instances:connection', { id: instanceId });
    const storedCredential = credentialVault.get(instanceId);
    if (connection.authMethod === 'publickey' && !storedCredential?.privateKey) {
      throw new Error('This instance uses an external public key. Connect with the matching private key from an external SSH client.');
    }
    return sshClients.open({ ...connection, privateKey: storedCredential?.privateKey }, event.sender, dimensions);
  });
  ipcMain.handle('terminal:write', (_event, { sessionId, data }) => sshClients.write(sessionId, data));
  ipcMain.handle('terminal:resize', (_event, { sessionId, dimensions }) => sshClients.resize(sessionId, dimensions));
  ipcMain.handle('terminal:close', (_event, sessionId) => sshClients.close(sessionId));
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
}

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  app.setAppUserModelId('com.monolithssh.desktop');
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  credentialVault = new CredentialVault(path.join(app.getPath('userData'), 'credentials.bin'));
  simulator = new SimulatorManager({
    entryPath: path.join(__dirname, '..', 'simulator', 'service.cjs'),
    dataDir: path.join(app.getPath('userData'), 'simulator')
  });

  simulator.on('audit', (event) => broadcast('audit:event', event));
  simulator.on('log', ({ level, message }) => {
    const logger = level === 'error' ? console.error : console.log;
    logger(`[simulator] ${message.trimEnd()}`);
  });

  try {
    await simulator.start();
  } catch (error) {
    dialog.showErrorBox('Simulator failed to start', error.message);
  }

  mcpGateway = new McpSseGateway({
    simulator,
    settingsPath: path.join(app.getPath('userData'), 'mcp-settings.json'),
    portOwnerResolver: findPortOwner,
    credentialStatusResolver: (id) => ({ privateKeyManaged: credentialVault.has(id) }),
    credentialMutationResolver: (id, input) => {
      if (input.authMethod === 'password' || input.authorizedKeys !== undefined) credentialVault.delete(id);
    },
    credentialDeleteResolver: (id) => credentialVault.delete(id)
  });
  mcpGateway.on('status', (status) => broadcast('mcp:status', status));
  await mcpGateway.init();

  registerIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('before-quit', (event) => {
  if (!hasSingleInstanceLock || shutdownStarted) return;
  event.preventDefault();
  shutdownStarted = true;
  sshClients.closeAll();
  void Promise.allSettled([
    mcpGateway?.stop(),
    simulator?.shutdown()
  ]).finally(() => {
    simulator?.kill();
    app.exit(0);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
