const { contextBridge, ipcRenderer } = require('electron');

async function invokeInstanceAction(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (result?.ok) return result.value;
  const error = new Error(result?.error?.message || 'The instance operation failed');
  error.code = result?.error?.code || 'REQUEST_FAILED';
  error.details = result?.error?.details ?? null;
  throw error;
}

contextBridge.exposeInMainWorld('monolith', {
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  instances: {
    list: () => ipcRenderer.invoke('instances:list'),
    create: (input) => invokeInstanceAction('instances:create', input),
    start: (id) => invokeInstanceAction('instances:start', id),
    stop: (id) => ipcRenderer.invoke('instances:stop', id),
    delete: (id) => ipcRenderer.invoke('instances:delete', id),
    diagnosePort: (id) => invokeInstanceAction('instances:diagnose-port', id),
    updatePort: (id, port, start = false) => invokeInstanceAction('instances:update-port', { id, port, start }),
    updateEndpoint: (id, host, port, start = false) => invokeInstanceAction('instances:update-endpoint', { id, host, port, start }),
    repairPort: (id) => invokeInstanceAction('instances:repair-port', id)
  },
  credentials: {
    generatePassword: (length) => ipcRenderer.invoke('credentials:generate-password', length),
    generateKey: (label) => ipcRenderer.invoke('credentials:generate-key', label),
    savePrivateKey: (privateKey, suggestedName) => ipcRenderer.invoke('credentials:save-private-key', { privateKey, suggestedName }),
    getInstanceAccess: (id) => invokeInstanceAction('credentials:get-instance-access', id),
    exportInstancePrivateKey: (id) => invokeInstanceAction('credentials:export-instance-private-key', id)
  },
  commands: {
    list: () => ipcRenderer.invoke('commands:list'),
    save: (rules) => ipcRenderer.invoke('commands:save', rules)
  },
  variables: {
    list: () => ipcRenderer.invoke('variables:list'),
    save: (variables) => ipcRenderer.invoke('variables:save', variables)
  },
  builtins: {
    list: () => ipcRenderer.invoke('builtins:list'),
    delete: (id) => ipcRenderer.invoke('builtins:delete', id),
    restore: () => ipcRenderer.invoke('builtins:restore')
  },
  audit: {
    list: () => ipcRenderer.invoke('audit:list'),
    onEvent: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('audit:event', listener);
      return () => ipcRenderer.removeListener('audit:event', listener);
    }
  },
  mcp: {
    getStatus: () => ipcRenderer.invoke('mcp:get-status'),
    setEnabled: (enabled) => ipcRenderer.invoke('mcp:set-enabled', enabled),
    onStatus: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('mcp:status', listener);
      return () => ipcRenderer.removeListener('mcp:status', listener);
    }
  },
  terminal: {
    open: (instanceId, dimensions) => ipcRenderer.invoke('terminal:open', { instanceId, dimensions }),
    write: (sessionId, data) => ipcRenderer.invoke('terminal:write', { sessionId, data }),
    resize: (sessionId, dimensions) => ipcRenderer.invoke('terminal:resize', { sessionId, dimensions }),
    close: (sessionId) => ipcRenderer.invoke('terminal:close', sessionId),
    onData: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('terminal:data', listener);
      return () => ipcRenderer.removeListener('terminal:data', listener);
    },
    onStatus: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('terminal:status', listener);
      return () => ipcRenderer.removeListener('terminal:status', listener);
    }
  }
});
