const { Client } = require('ssh2');

const client = new Client();
let output = '';

const timeout = setTimeout(() => {
  client.end();
  console.error('Timed out probing the running Electron simulator');
  process.exitCode = 1;
}, 7000);

client.on('ready', () => {
  client.exec('show version', (error, stream) => {
    if (error) throw error;
    stream.on('data', (data) => { output += data.toString(); });
    stream.stderr.on('data', (data) => { output += data.toString(); });
    stream.on('close', () => {
      clearTimeout(timeout);
      client.end();
      if (!output.includes('Monolith Network OS')) {
        console.error('Unexpected simulator response');
        process.exitCode = 1;
        return;
      }
      console.log('Running Electron simulator answered on 127.0.0.1:2222');
    });
  });
});

client.on('error', (error) => {
  clearTimeout(timeout);
  console.error(error.message);
  process.exitCode = 1;
});

client.connect({ host: '127.0.0.1', port: 2222, username: 'admin', password: 'monolith', readyTimeout: 5000 });
