const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function parseListeningPid(output, port) {
  for (const line of String(output ?? '').split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 5 || columns[0].toUpperCase() !== 'TCP') continue;
    const localAddress = columns[1];
    const state = columns.at(-2)?.toUpperCase();
    const pid = Number(columns.at(-1));
    const separator = localAddress.lastIndexOf(':');
    const localPort = Number(localAddress.slice(separator + 1));
    if (state === 'LISTENING' && localPort === port && Number.isInteger(pid)) return pid;
  }
  return null;
}

function parseTasklistName(output, pid) {
  const line = String(output ?? '').split(/\r?\n/).find((item) => item.trim() && !item.includes('INFO:'));
  const match = line?.match(/^"([^"]+)","(\d+)"/);
  if (!match || Number(match[2]) !== pid) return null;
  return match[1];
}

async function findWindowsPortOwner(port) {
  try {
    const { stdout: netstatOutput } = await execFileAsync('netstat.exe', ['-ano', '-p', 'tcp'], {
      windowsHide: true,
      timeout: 4000,
      maxBuffer: 2 * 1024 * 1024
    });
    const pid = parseListeningPid(netstatOutput, port);
    if (!pid) return null;
    try {
      const { stdout: taskOutput } = await execFileAsync('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
        windowsHide: true,
        timeout: 4000
      });
      return { pid, processName: parseTasklistName(taskOutput, pid) };
    } catch {
      return { pid, processName: null };
    }
  } catch {
    return null;
  }
}

async function findPortOwner(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (process.platform === 'win32') return findWindowsPortOwner(port);
  return null;
}

module.exports = { findPortOwner, parseListeningPid, parseTasklistName };
