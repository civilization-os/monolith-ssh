const assert = require('node:assert/strict');
const { executeLuaScript, validateLuaScript } = require('../simulator/lua-runtime.cjs');
const { createDefaultState, createSession } = require('../simulator/engines.cjs');

function runRuntimeChecks() {
  const script = `
    assert(os == nil and io == nil and require == nil and load == nil and pcall == nil and xpcall == nil)
    assert(string.rep == nil)
    local session_count = session.get("count", 0) + 1
    local instance_count = instance.get("count", 0) + 1
    session.set("count", session_count)
    instance.set("count", instance_count)
    return {
      output = ctx.command .. ":" .. session_count .. ":" .. instance_count,
      ok = true
    }
  `;
  validateLuaScript(script);
  const first = executeLuaScript({ script, context: { command: 'dynamic' }, sessionState: {}, instanceState: {} });
  assert.equal(first.output, 'dynamic:1:1');
  assert.deepEqual(first.sessionState, { count: 1 });
  assert.deepEqual(first.instanceState, { count: 1 });

  const second = executeLuaScript({
    script,
    context: { command: 'dynamic' },
    sessionState: first.sessionState,
    instanceState: first.instanceState
  });
  assert.equal(second.output, 'dynamic:2:2');
  assert.match(executeLuaScript({
    script: 'return { output = clock.now() .. ":" .. random.int(1, 9) }',
    context: {},
    sessionState: {},
    instanceState: {}
  }).output, /^\d{4}-\d{2}-\d{2}T.+:[1-9]$/);

  const original = { safe: true };
  assert.throws(() => executeLuaScript({
    script: 'instance.set("safe", false); error("rollback")',
    context: {},
    sessionState: {},
    instanceState: original
  }), /rollback/);
  assert.deepEqual(original, { safe: true });
  assert.throws(() => executeLuaScript({
    script: 'while true do end',
    context: {},
    sessionState: {},
    instanceState: {}
  }), /instruction limit exceeded/);
  assert.throws(() => validateLuaScript('this is not lua!'), /Lua compile error/);
}

function runSessionChecks() {
  const linux = { id: 'linux-lua', name: 'linux-lua', kind: 'linux', username: 'admin' };
  const linuxState = createDefaultState(linux);
  let persisted = 0;
  const rules = [{
    id: 'counter-rule',
    kind: 'linux',
    scope: 'type',
    instanceId: null,
    mode: 'shell',
    matchType: 'exact',
    pattern: 'counter',
    behavior: 'lua',
    luaScript: 'local n=session.get("n",0)+1; session.set("n",n); instance.set("total",instance.get("total",0)+1); return { output="count="..n }',
    enabled: true
  }, {
    id: 'user-rule',
    kind: 'linux',
    scope: 'type',
    instanceId: null,
    mode: 'shell',
    matchType: 'exact',
    pattern: 'become-root',
    behavior: 'lua',
    luaScript: 'return { set_user="root", output="switched" }',
    enabled: true
  }];
  const engine = createSession(linux, linuxState, () => { persisted += 1; }, 'admin', () => rules);
  assert.equal(engine.execute('counter').output, 'count=1');
  assert.equal(engine.execute('counter').output, 'count=2');
  assert.equal(linuxState.lua['counter-rule'].total, 2);
  assert.equal(engine.execute('become-root').output, 'switched');
  assert.equal(engine.execute('whoami').output, 'root');
  assert.ok(persisted >= 3);

  const network = { id: 'network-lua', name: 'router-lua', kind: 'network', username: 'admin' };
  const networkState = createDefaultState(network);
  const networkRules = [{
    id: 'enable-rule',
    kind: 'network',
    scope: 'type',
    instanceId: null,
    mode: 'user_exec',
    matchType: 'exact',
    pattern: 'lua-enable',
    behavior: 'lua',
    luaScript: 'return { set_mode="privileged_exec", output="enabled" }',
    enabled: true
  }];
  const networkEngine = createSession(network, networkState, () => {}, 'admin', () => networkRules);
  assert.equal(networkEngine.execute('lua-enable').output, 'enabled');
  assert.equal(networkEngine.prompt(), 'router-lua#');

  rules[0].luaScript = 'while true do end';
  const limited = engine.execute('counter');
  assert.equal(limited.ok, false);
  assert.match(limited.output, /instruction limit exceeded/);
}

runRuntimeChecks();
runSessionChecks();
console.log('Lua command-rule smoke test passed.');
