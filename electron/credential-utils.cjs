const { createHash, generateKeyPairSync, randomInt } = require('node:crypto');
const { utils } = require('ssh2');

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*-_+=';

function generatePassword(length = 24) {
  const normalizedLength = Number.isInteger(length) ? Math.min(64, Math.max(16, length)) : 24;
  return Array.from({ length: normalizedLength }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]).join('');
}

function generateLoginKey(label = 'monolithssh') {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 3072,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' }
  });
  const parsed = utils.parseKey(privateKey);
  if (parsed instanceof Error || Array.isArray(parsed)) throw new Error('Unable to generate a supported SSH login key');
  const publicBlob = parsed.getPublicSSH();
  const publicKey = `${parsed.type} ${publicBlob.toString('base64')} ${String(label).replace(/\s+/g, '-')}`;
  const fingerprint = `SHA256:${createHash('sha256').update(publicBlob).digest('base64').replace(/=+$/, '')}`;
  return { algorithm: 'RSA-3072', privateKey, publicKey, fingerprint };
}

function describePublicKey(value) {
  const parsed = utils.parseKey(String(value ?? '').trim());
  if (parsed instanceof Error || Array.isArray(parsed)) throw new Error('Unable to inspect the SSH public key');
  const publicBlob = parsed.getPublicSSH();
  return {
    algorithm: parsed.type,
    fingerprint: `SHA256:${createHash('sha256').update(publicBlob).digest('base64').replace(/=+$/, '')}`
  };
}

module.exports = { describePublicKey, generateLoginKey, generatePassword };
