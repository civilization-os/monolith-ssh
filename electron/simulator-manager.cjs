const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { utilityProcess } = require('electron');

class SimulatorManager extends EventEmitter {
  constructor({ entryPath, dataDir }) {
    super();
    this.entryPath = entryPath;
    this.dataDir = dataDir;
    this.child = null;
    this.pending = new Map();
    this.readyPromise = null;
    this.resolveReady = null;
    this.rejectReady = null;
  }

  start() {
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    this.child = utilityProcess.fork(this.entryPath, [this.dataDir], {
      serviceName: 'Monolith SSH Simulator',
      stdio: 'pipe'
    });

    this.child.on('message', (message) => this.handleMessage(message));
    this.child.on('exit', (code) => this.handleExit(code));
    this.child.on('error', (error) => this.handleFatal(error));
    this.child.stderr?.on('data', (data) => this.emit('log', { level: 'error', message: data.toString() }));
    this.child.stdout?.on('data', (data) => this.emit('log', { level: 'info', message: data.toString() }));

    return this.readyPromise;
  }

  handleMessage(message) {
    if (message.kind === 'ready') {
      this.resolveReady?.(message.instances);
      return;
    }

    if (message.kind === 'fatal') {
      this.handleFatal(new Error(message.error));
      return;
    }

    if (message.kind === 'event') {
      this.emit(message.event, message.payload);
      return;
    }

    if (message.kind === 'response') {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(message.requestId);
      if (message.ok) {
        pending.resolve(message.result);
      } else {
        const payload = typeof message.error === 'string' ? { message: message.error } : message.error ?? {};
        const error = new Error(payload.message || 'Simulator request failed');
        error.code = payload.code || 'REQUEST_FAILED';
        error.details = payload.details ?? null;
        pending.reject(error);
      }
    }
  }

  handleFatal(error) {
    this.rejectReady?.(error);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    this.emit('fatal', error);
  }

  handleExit(code) {
    this.child = null;
    this.handleFatal(new Error(`Simulator service exited with code ${code}`));
  }

  async request(method, payload = {}) {
    await this.start();
    if (!this.child) throw new Error('Simulator service is not running');

    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Simulator request timed out: ${method}`));
      }, 10000);

      this.pending.set(requestId, { resolve, reject, timeout });
      this.child.postMessage({ kind: 'request', requestId, method, payload });
    });
  }

  async shutdown() {
    if (!this.child) return;
    try {
      await this.request('shutdown');
    } finally {
      this.child?.kill();
      this.child = null;
    }
  }

  kill() {
    this.child?.kill();
    this.child = null;
  }
}

module.exports = { SimulatorManager };
