const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const nsis = pkg.build?.nsis ?? {};
const failures = [];

function requireSetting(condition, message) {
  if (!condition) failures.push(message);
}

if (process.argv.includes('--config')) {
  requireSetting(nsis.oneClick === false, 'NSIS must use the assisted installer');
  requireSetting(nsis.perMachine === false, 'Installer must offer current-user and all-users modes');
  requireSetting(nsis.allowElevation === true, 'Installer must support elevation for all-users mode');
  requireSetting(nsis.allowToChangeInstallationDirectory === true, 'Installer must allow a custom installation directory');
  requireSetting(nsis.createDesktopShortcut === true, 'Desktop shortcut support must be enabled');
  requireSetting(nsis.createStartMenuShortcut === true, 'Start menu shortcut support must be enabled');
  requireSetting(nsis.runAfterFinish === true, 'Finish page must offer to launch the application');
  requireSetting(nsis.displayLanguageSelector === true, 'Installer language selector must be enabled');
  requireSetting(Array.isArray(nsis.installerLanguages) && nsis.installerLanguages.includes('zh_CN') && nsis.installerLanguages.includes('en_US'), 'Installer must include Chinese and English');

  for (const file of ['build/installer.nsh', 'build/license_zh_CN.txt', 'build/license_en_US.txt', 'assets/icon.ico']) {
    requireSetting(fs.existsSync(path.join(root, file)), `Missing installer resource: ${file}`);
  }

  const includeScript = fs.readFileSync(path.join(root, 'build/installer.nsh'), 'utf8');
  requireSetting(includeScript.includes('MonolithAppendLog'), 'Installer must persist a diagnostic log');
  requireSetting(includeScript.includes('SetDetailsView show'), 'Installer must expose detailed progress output');
}

if (process.argv.includes('--artifact')) {
  const artifact = path.join(root, 'release', `MonolithSSH-${pkg.version}-Setup.exe`);
  const blockmap = `${artifact}.blockmap`;
  requireSetting(fs.existsSync(artifact) && fs.statSync(artifact).size > 1024 * 1024, 'Installer executable is missing or unexpectedly small');
  requireSetting(fs.existsSync(blockmap) && fs.statSync(blockmap).size > 0, 'Installer blockmap is missing');
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}

console.log('Installer configuration check passed');
