const { randomInt } = require('node:crypto');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');

const MAX_SCRIPT_LENGTH = 20000;
const MAX_OUTPUT_LENGTH = 20000;
const MAX_STATE_KEYS = 100;
const MAX_STATE_BYTES = 8192;
const INSTRUCTION_GRANULARITY = 1000;
const MAX_INSTRUCTIONS = 100000;
const STATE_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;

function luaString(value) {
  return to_luastring(String(value), true);
}

function cloneState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, item]) => (
    item === null || ['string', 'number', 'boolean'].includes(typeof item)
  )));
}

function pushValue(L, value, depth = 0) {
  if (depth > 8 || value === null || value === undefined) {
    lua.lua_pushnil(L);
    return;
  }
  if (typeof value === 'string') {
    lua.lua_pushstring(L, luaString(value));
    return;
  }
  if (typeof value === 'boolean') {
    lua.lua_pushboolean(L, value);
    return;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    Number.isInteger(value) ? lua.lua_pushinteger(L, value) : lua.lua_pushnumber(L, value);
    return;
  }
  if (Array.isArray(value)) {
    lua.lua_createtable(L, value.length, 0);
    value.forEach((item, index) => {
      pushValue(L, item, depth + 1);
      lua.lua_rawseti(L, -2, index + 1);
    });
    return;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    lua.lua_createtable(L, 0, entries.length);
    for (const [key, item] of entries) {
      pushValue(L, item, depth + 1);
      lua.lua_setfield(L, -2, luaString(key));
    }
    return;
  }
  lua.lua_pushnil(L);
}

function readPrimitive(L, index, label, allowNil = true) {
  if (lua.lua_isnil(L, index)) {
    if (allowNil) return null;
    throw new Error(`${label} cannot be nil`);
  }
  if (lua.lua_isboolean(L, index)) return lua.lua_toboolean(L, index);
  if (lua.lua_isnumber(L, index)) return lua.lua_tonumber(L, index);
  if (lua.lua_isstring(L, index)) return lua.lua_tojsstring(L, index);
  throw new Error(`${label} must be a string, number, boolean or nil`);
}

function readField(L, tableIndex, name, fallback) {
  lua.lua_getfield(L, tableIndex, luaString(name));
  const value = lua.lua_isnil(L, -1) ? fallback : readPrimitive(L, -1, `return.${name}`);
  lua.lua_pop(L, 1);
  return value;
}

function validateState(state, label) {
  if (Object.keys(state).length > MAX_STATE_KEYS) throw new Error(`${label} state exceeds ${MAX_STATE_KEYS} keys`);
  if (Buffer.byteLength(JSON.stringify(state), 'utf8') > MAX_STATE_BYTES) {
    throw new Error(`${label} state exceeds ${MAX_STATE_BYTES} bytes`);
  }
}

function createStateLibrary(L, state, label) {
  lua.lua_createtable(L, 0, 3);

  lua.lua_pushjsfunction(L, (inner) => {
    try {
      if (lua.lua_type(inner, 1) !== lua.LUA_TSTRING) throw new Error(`${label}.get key must be a string`);
      const key = lua.lua_tojsstring(inner, 1);
      if (!STATE_KEY_PATTERN.test(key)) throw new Error(`${label}.get key is invalid`);
      if (Object.hasOwn(state, key)) pushValue(inner, state[key]);
      else if (lua.lua_gettop(inner) >= 2) lua.lua_pushvalue(inner, 2);
      else lua.lua_pushnil(inner);
      return 1;
    } catch (error) {
      return lauxlib.luaL_error(inner, luaString(error.message));
    }
  });
  lua.lua_setfield(L, -2, luaString('get'));

  lua.lua_pushjsfunction(L, (inner) => {
    try {
      if (lua.lua_type(inner, 1) !== lua.LUA_TSTRING) throw new Error(`${label}.set key must be a string`);
      const key = lua.lua_tojsstring(inner, 1);
      if (!STATE_KEY_PATTERN.test(key)) throw new Error(`${label}.set key is invalid`);
      const value = readPrimitive(inner, 2, `${label}.set value`);
      if (value === null) delete state[key];
      else state[key] = value;
      validateState(state, label);
      lua.lua_pushboolean(inner, true);
      return 1;
    } catch (error) {
      return lauxlib.luaL_error(inner, luaString(error.message));
    }
  });
  lua.lua_setfield(L, -2, luaString('set'));

  lua.lua_pushjsfunction(L, (inner) => {
    try {
      if (lua.lua_type(inner, 1) !== lua.LUA_TSTRING) throw new Error(`${label}.delete key must be a string`);
      const key = lua.lua_tojsstring(inner, 1);
      if (!STATE_KEY_PATTERN.test(key)) throw new Error(`${label}.delete key is invalid`);
      const existed = Object.hasOwn(state, key);
      delete state[key];
      lua.lua_pushboolean(inner, existed);
      return 1;
    } catch (error) {
      return lauxlib.luaL_error(inner, luaString(error.message));
    }
  });
  lua.lua_setfield(L, -2, luaString('delete'));
  lua.lua_setglobal(L, luaString(label));
}

function openSafeLibraries(L) {
  const libraries = [
    ['_G', lualib.luaopen_base],
    [lualib.LUA_TABLIBNAME, lualib.luaopen_table],
    [lualib.LUA_STRLIBNAME, lualib.luaopen_string],
    [lualib.LUA_MATHLIBNAME, lualib.luaopen_math],
    [lualib.LUA_UTF8LIBNAME, lualib.luaopen_utf8]
  ];
  for (const [name, open] of libraries) {
    lauxlib.luaL_requiref(L, luaString(name), open, 1);
    lua.lua_pop(L, 1);
  }

  for (const name of ['collectgarbage', 'dofile', 'load', 'loadfile', 'print', 'require', 'pcall', 'xpcall', 'io', 'os', 'package', 'debug', 'js', 'fengari']) {
    lua.lua_pushnil(L);
    lua.lua_setglobal(L, luaString(name));
  }

  lua.lua_getglobal(L, luaString('string'));
  for (const name of ['dump', 'rep']) {
    lua.lua_pushnil(L);
    lua.lua_setfield(L, -2, luaString(name));
  }
  lua.lua_pop(L, 1);

  lua.lua_createtable(L, 0, 2);
  lua.lua_pushjsfunction(L, (inner) => {
    lua.lua_pushstring(inner, luaString(new Date().toISOString()));
    return 1;
  });
  lua.lua_setfield(L, -2, luaString('now'));
  lua.lua_pushjsfunction(L, (inner) => {
    lua.lua_pushinteger(inner, Math.floor(Date.now() / 1000));
    return 1;
  });
  lua.lua_setfield(L, -2, luaString('unix'));
  lua.lua_setglobal(L, luaString('clock'));

  lua.lua_createtable(L, 0, 1);
  lua.lua_pushjsfunction(L, (inner) => {
    try {
      const minimum = lauxlib.luaL_checkinteger(inner, 1);
      const maximum = lauxlib.luaL_checkinteger(inner, 2);
      if (minimum > maximum) throw new Error('random.int minimum must not exceed maximum');
      if (maximum - minimum > 0x7ffffffe) throw new Error('random.int range is too large');
      lua.lua_pushinteger(inner, randomInt(minimum, maximum + 1));
      return 1;
    } catch (error) {
      return lauxlib.luaL_error(inner, luaString(error.message));
    }
  });
  lua.lua_setfield(L, -2, luaString('int'));
  lua.lua_setglobal(L, luaString('random'));
}

function luaError(L, prefix) {
  const detail = lua.lua_isstring(L, -1) ? lua.lua_tojsstring(L, -1) : 'Unknown Lua error';
  return new Error(`${prefix}: ${detail}`);
}

function assertScriptSource(script) {
  const source = String(script ?? '');
  if (!source.trim()) throw new Error('Lua script cannot be empty');
  if (source.length > MAX_SCRIPT_LENGTH) throw new Error(`Lua script exceeds ${MAX_SCRIPT_LENGTH} characters`);
  return source;
}

function validateLuaScript(script) {
  const source = assertScriptSource(script);
  const L = lauxlib.luaL_newstate();
  try {
    const bytes = luaString(source);
    const loaded = lauxlib.luaL_loadbufferx(L, bytes, bytes.length, luaString('command-rule'), luaString('t'));
    if (loaded !== lua.LUA_OK) throw luaError(L, 'Lua compile error');
  } finally {
    lua.lua_close(L);
  }
}

function executeLuaScript({ script, context, sessionState, instanceState }) {
  const source = assertScriptSource(script);

  const nextSessionState = cloneState(sessionState);
  const nextInstanceState = cloneState(instanceState);
  const previousInstanceState = JSON.stringify(nextInstanceState);
  const L = lauxlib.luaL_newstate();

  try {
    openSafeLibraries(L);
    pushValue(L, context);
    lua.lua_setglobal(L, luaString('ctx'));
    createStateLibrary(L, nextSessionState, 'session');
    createStateLibrary(L, nextInstanceState, 'instance');

    let executed = 0;
    lua.lua_sethook(L, (inner) => {
      executed += INSTRUCTION_GRANULARITY;
      if (executed > MAX_INSTRUCTIONS) {
        lauxlib.luaL_error(inner, luaString(`instruction limit exceeded (${MAX_INSTRUCTIONS})`));
      }
    }, lua.LUA_MASKCOUNT, INSTRUCTION_GRANULARITY);

    const bytes = luaString(source);
    const loaded = lauxlib.luaL_loadbufferx(L, bytes, bytes.length, luaString('command-rule'), luaString('t'));
    if (loaded !== lua.LUA_OK) throw luaError(L, 'Lua compile error');
    if (lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) throw luaError(L, 'Lua runtime error');

    const result = {
      output: '',
      ok: true,
      clear: false,
      exit: false,
      setUser: null,
      setMode: null
    };
    if (!lua.lua_isnil(L, -1)) {
      if (!lua.lua_istable(L, -1)) throw new Error('Lua script must return a table or nil');
      const tableIndex = lua.lua_absindex(L, -1);
      result.output = String(readField(L, tableIndex, 'output', '') ?? '');
      result.ok = readField(L, tableIndex, 'ok', true) !== false;
      result.clear = readField(L, tableIndex, 'clear', false) === true;
      result.exit = readField(L, tableIndex, 'exit', false) === true;
      result.setUser = readField(L, tableIndex, 'set_user', null);
      result.setMode = readField(L, tableIndex, 'set_mode', null);
    }
    if (result.output.length > MAX_OUTPUT_LENGTH) throw new Error(`Lua output exceeds ${MAX_OUTPUT_LENGTH} characters`);
    if (result.setUser !== null && typeof result.setUser !== 'string') throw new Error('return.set_user must be a string or nil');
    if (result.setMode !== null && typeof result.setMode !== 'string') throw new Error('return.set_mode must be a string or nil');
    validateState(nextSessionState, 'session');
    validateState(nextInstanceState, 'instance');
    return {
      ...result,
      sessionState: nextSessionState,
      instanceState: nextInstanceState,
      instanceChanged: JSON.stringify(nextInstanceState) !== previousInstanceState
    };
  } finally {
    lua.lua_close(L);
  }
}

module.exports = {
  executeLuaScript,
  validateLuaScript,
  MAX_SCRIPT_LENGTH,
  MAX_OUTPUT_LENGTH,
  MAX_INSTRUCTIONS,
  MAX_STATE_BYTES,
  MAX_STATE_KEYS
};
