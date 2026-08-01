const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const htmlPath = path.join(distDir, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
const localReferences = references.filter((reference) => !/^(?:[a-z]+:|#)/i.test(reference));
const absoluteReferences = localReferences.filter((reference) => reference.startsWith('/'));

if (absoluteReferences.length) {
  throw new Error(`Electron file:// bundle contains root-relative assets: ${absoluteReferences.join(', ')}`);
}

for (const reference of localReferences) {
  const assetPath = path.resolve(distDir, reference);
  if (!fs.existsSync(assetPath)) throw new Error(`Built asset does not exist: ${reference}`);
}

console.log(`Electron bundle asset check passed: ${localReferences.length} relative assets found`);
