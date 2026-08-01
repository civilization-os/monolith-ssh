const { randomUUID } = require('node:crypto');
const { Client } = require('ssh2');

class SshClientManager {
  constructor() {
    this.sessions = new Map();
  }

  open(connection, sender, dimensions = {}) {
    const sessionId = randomUUID();
    const client = new Client();
    const cols = Number(dimensions.cols) || 80;
    const rows = Number(dimensions.rows) || 24;

    return new Promise((resolve, reject) => {
      let settled = false;
      const rejectOnce = (error) => {
        if (settled) {
          this.send(sender, 'terminal:status', { sessionId, status: 'error', message: error.message });
          return;
        }
        settled = true;
        reject(error);
      };

      client.on('ready', () => {
        client.shell({ term: 'xterm-256color', cols, rows }, (error, stream) => {
          if (error) {
            client.end();
            rejectOnce(error);
            return;
          }

          const session = { sessionId, client, stream, senderId: sender.id };
          this.sessions.set(sessionId, session);

          stream.on('data', (data) => this.send(sender, 'terminal:data', { sessionId, data: data.toString('utf8') }));
          stream.stderr.on('data', (data) => this.send(sender, 'terminal:data', { sessionId, data: data.toString('utf8') }));
          stream.on('close', () => {
            this.sessions.delete(sessionId);
            client.end();
            this.send(sender, 'terminal:status', { sessionId, status: 'closed' });
          });

          settled = true;
          this.send(sender, 'terminal:status', { sessionId, status: 'connected' });
          resolve({ sessionId });
        });
      });

      client.on('error', rejectOnce);
      const connectionOptions = {
        host: connection.host,
        port: connection.port,
        username: connection.username,
        readyTimeout: 5000,
        keepaliveInterval: 15000
      };
      if (connection.password) connectionOptions.password = connection.password;
      if (connection.privateKey) connectionOptions.privateKey = connection.privateKey;
      client.connect(connectionOptions);
    });
  }

  send(sender, channel, payload) {
    if (!sender.isDestroyed()) sender.send(channel, payload);
  }

  write(sessionId, data) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Terminal session is not open');
    session.stream.write(String(data));
  }

  resize(sessionId, dimensions = {}) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const cols = Number(dimensions.cols) || 80;
    const rows = Number(dimensions.rows) || 24;
    session.stream.setWindow(rows, cols, 0, 0);
  }

  close(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    session.stream.end();
    session.client.end();
  }

  closeForSender(senderId) {
    for (const [sessionId, session] of this.sessions) {
      if (session.senderId === senderId) this.close(sessionId);
    }
  }

  closeAll() {
    for (const sessionId of [...this.sessions.keys()]) this.close(sessionId);
  }
}

module.exports = { SshClientManager };
