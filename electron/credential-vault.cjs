const fs = require('node:fs');
const path = require('node:path');
const { safeStorage } = require('electron');

class CredentialVault {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.credentials = {};
    this.load();
  }

  load() {
    if (!fs.existsSync(this.filePath) || !safeStorage.isEncryptionAvailable()) return;
    try {
      const decrypted = safeStorage.decryptString(fs.readFileSync(this.filePath));
      this.credentials = JSON.parse(decrypted);
    } catch {
      this.credentials = {};
    }
  }

  save() {
    if (!safeStorage.isEncryptionAvailable()) return false;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, safeStorage.encryptString(JSON.stringify(this.credentials)), { mode: 0o600 });
    return true;
  }

  set(instanceId, credential) {
    this.credentials[instanceId] = { ...credential };
    return this.save();
  }

  get(instanceId) {
    return this.credentials[instanceId] ? { ...this.credentials[instanceId] } : null;
  }

  has(instanceId) {
    return Boolean(this.credentials[instanceId]?.privateKey);
  }

  delete(instanceId) {
    delete this.credentials[instanceId];
    this.save();
  }
}

module.exports = { CredentialVault };
