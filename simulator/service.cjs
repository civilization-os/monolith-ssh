const path = require('node:path');
const { SimulatorService } = require('./service-core.cjs');

const dataDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(process.cwd(), '.monolith-data');
const service = new SimulatorService(dataDir);
const parentPort = process.parentPort;

if (!parentPort) {
  throw new Error('The simulator service must be launched as an Electron utility process.');
}

const handlers = {
  'instances:list': () => service.listInstances(),
  'instances:create': (payload) => service.createInstance(payload),
  'instances:start': ({ id }) => service.startInstance(id),
  'instances:stop': ({ id }) => service.stopInstance(id),
  'instances:delete': ({ id }) => service.deleteInstance(id),
  'instances:port-status': ({ id }) => service.getPortStatus(id),
  'instances:update-port': ({ id, port }) => service.updateInstancePort(id, port),
  'instances:update-endpoint': ({ id, host, port }) => service.updateInstanceEndpoint(id, { host, port }),
  'instances:repair-port': ({ id }) => service.repairAndStartInstance(id),
  'instances:connection': ({ id }) => service.getConnection(id),
  'instances:access': ({ id }) => service.getInstanceAccess(id),
  'instances:update-credentials': ({ id, ...input }) => service.updateInstanceCredentials(id, input),
  'instances:execute': ({ id, command }) => service.executeInstanceCommand(id, command),
  'commands:list': () => service.listCommandRules(),
  'commands:save': (payload) => service.replaceCommandRules(payload),
  'variables:list': () => service.listVariables(),
  'variables:save': (payload) => service.replaceVariables(payload),
  'builtins:list': () => service.listLinuxBuiltins(),
  'builtins:delete': ({ id }) => service.deleteLinuxBuiltin(id),
  'builtins:enable': ({ id }) => service.enableLinuxBuiltin(id),
  'builtins:restore': () => service.restoreLinuxBuiltins(),
  'audit:list': () => service.listAudit(),
  shutdown: () => service.shutdown()
};

service.on('audit', (event) => {
  parentPort.postMessage({ kind: 'event', event: 'audit', payload: event });
});

parentPort.on('message', async ({ data }) => {
  if (!data || data.kind !== 'request') return;
  const handler = handlers[data.method];
  if (!handler) {
    parentPort.postMessage({ kind: 'response', requestId: data.requestId, ok: false, error: `Unknown method: ${data.method}` });
    return;
  }

  try {
    const result = await handler(data.payload ?? {});
    parentPort.postMessage({ kind: 'response', requestId: data.requestId, ok: true, result });
  } catch (error) {
    parentPort.postMessage({
      kind: 'response',
      requestId: data.requestId,
      ok: false,
      error: {
        message: error.message,
        code: error.code ?? 'REQUEST_FAILED',
        details: error.details ?? null
      }
    });
  }
});

service.init()
  .then((instances) => parentPort.postMessage({ kind: 'ready', instances }))
  .catch((error) => parentPort.postMessage({ kind: 'fatal', error: error.message }));
