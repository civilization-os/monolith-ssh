const path = require('node:path');
const { timingSafeEqual } = require('node:crypto');

const LINUX_BUILTIN_COMMANDS = Object.freeze([
  { id: 'clear', command: 'clear', aliases: ['clear'], usage: 'clear' },
  { id: 'exit', command: 'exit', aliases: ['exit', 'logout'], usage: 'exit | logout' },
  { id: 'help', command: 'help', aliases: ['help'], usage: 'help' },
  { id: 'pwd', command: 'pwd', aliases: ['pwd'], usage: 'pwd' },
  { id: 'whoami', command: 'whoami', aliases: ['whoami'], usage: 'whoami' },
  { id: 'id', command: 'id', aliases: ['id'], usage: 'id' },
  { id: 'hostname', command: 'hostname', aliases: ['hostname'], usage: 'hostname' },
  { id: 'date', command: 'date', aliases: ['date'], usage: 'date' },
  { id: 'uname', command: 'uname', aliases: ['uname'], usage: 'uname [-a]' },
  { id: 'env', command: 'env', aliases: ['env'], usage: 'env' },
  { id: 'ps', command: 'ps', aliases: ['ps'], usage: 'ps' },
  { id: 'ip', command: 'ip', aliases: ['ip'], usage: 'ip addr | ip route' },
  { id: 'systemctl', command: 'systemctl', aliases: ['systemctl'], usage: 'systemctl status ssh' },
  { id: 'cd', command: 'cd', aliases: ['cd'], usage: 'cd [path]' },
  { id: 'ls', command: 'ls', aliases: ['ls'], usage: 'ls [path]' },
  { id: 'cat', command: 'cat', aliases: ['cat'], usage: 'cat <file>' },
  { id: 'touch', command: 'touch', aliases: ['touch'], usage: 'touch <file>' },
  { id: 'mkdir', command: 'mkdir', aliases: ['mkdir'], usage: 'mkdir <directory>' },
  { id: 'rm', command: 'rm', aliases: ['rm'], usage: 'rm <path>' },
  { id: 'echo', command: 'echo', aliases: ['echo'], usage: 'echo <text> [> file]' },
  { id: 'uptime', command: 'uptime', aliases: ['uptime'], usage: 'uptime' },
  { id: 'df', command: 'df', aliases: ['df'], usage: 'df [-h]' },
  { id: 'free', command: 'free', aliases: ['free'], usage: 'free [-h]' },
  { id: 'which', command: 'which', aliases: ['which'], usage: 'which <command>' }
]);

function linuxBuiltinForName(name) {
  return LINUX_BUILTIN_COMMANDS.find((builtin) => builtin.aliases.includes(name));
}

function normalizeOutput(value = '') {
  return String(value).replace(/\r?\n/g, '\r\n');
}

function parseArgs(command) {
  const matches = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  return matches.map((token) => token.replace(/^(["'])|(["'])$/g, ''));
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ''));
  let rightBuffer = Buffer.from(String(right ?? ''));
  const lengthMismatch = leftBuffer.length !== rightBuffer.length;
  if (lengthMismatch) rightBuffer = leftBuffer;
  return !lengthMismatch && timingSafeEqual(leftBuffer, rightBuffer);
}

function commandMatches(input, pattern) {
  const inputParts = input.trim().toLowerCase().split(/\s+/);
  const patternParts = pattern.trim().toLowerCase().split(/\s+/);
  return inputParts.length === patternParts.length
    && inputParts.every((part, index) => patternParts[index].startsWith(part));
}

function renderRuleOutput(output, context) {
  const values = {
    ...(context.variables ?? {}),
    command: context.command,
    hostname: context.hostname,
    instance: context.instance,
    user: context.user,
    input: context.input ?? '',
    ...Object.fromEntries((context.args ?? []).map((value, index) => [`arg${index + 1}`, value])),
    ...(context.values ?? {})
  };
  return String(output ?? '').replace(/\{\{([A-Za-z_][A-Za-z0-9_.-]*)\}\}/g, (_match, key) => values[key] ?? '');
}

function executeCustomRule(rules, context) {
  const matchingScope = (rule, scope) => rule.scope === scope
    && (scope !== 'instance' || rule.instanceId === context.instanceId);

  for (const scope of ['instance', 'type']) {
    for (const rule of (rules ?? []).filter((candidate) => matchingScope(candidate, scope))) {
      if (!rule.enabled || rule.kind !== context.kind) continue;
      if (rule.mode !== 'any' && rule.mode !== context.mode) continue;

      const args = parseArgs(context.command);
      const matches = rule.matchType === 'regex'
        ? new RegExp(rule.pattern, 'i').test(context.command)
        : rule.matchType === 'command'
          ? args[0]?.toLowerCase() === rule.pattern.trim().toLowerCase()
          : context.command.trim().toLowerCase() === rule.pattern.trim().toLowerCase();

      if (!matches) continue;
      const ruleContext = { ...context, args: args.slice(1) };
      if (rule.behavior !== 'interactive') {
        return { output: renderRuleOutput(rule.output, ruleContext) };
      }
      if (rule.requiresArgument && args.length < 2) {
        const verification = rule.steps.find((step) => step.type === 'verify_variable' || step.type === 'verify_choice');
        return { output: renderRuleOutput(verification?.failureOutput ?? 'Missing required argument', ruleContext) };
      }
      return {
        interaction: {
          steps: rule.steps,
          context: ruleContext
        }
      };
    }
  }
  return null;
}

class InteractiveSession {
  constructor() {
    this.pendingInteraction = null;
  }

  inputMode() {
    const waiting = this.pendingInteraction?.waiting;
    return waiting ? { secret: waiting.secret === true } : null;
  }

  cancelInput() {
    this.pendingInteraction = null;
  }

  beginInteraction(interaction) {
    this.pendingInteraction = {
      steps: interaction.steps.map((step) => ({ ...step })),
      context: { ...interaction.context },
      values: {},
      index: 0,
      waiting: null,
      auditActions: []
    };
    return this.advanceInteraction();
  }

  submitInput(input) {
    const runtime = this.pendingInteraction;
    if (!runtime?.waiting) return {};
    runtime.values[runtime.waiting.saveAs] = input;
    runtime.context.input = input;
    runtime.waiting = null;
    return this.advanceInteraction();
  }

  renderInteractionValue(value, runtime) {
    return renderRuleOutput(value, {
      ...runtime.context,
      user: this.currentInteractionUser(),
      variables: this.getVariables(),
      values: runtime.values
    });
  }

  currentInteractionUser() {
    return this.instance.username;
  }

  completeInteraction(runtime, result = {}) {
    this.pendingInteraction = null;
    return {
      ok: result.ok !== false,
      output: result.output ?? '',
      auditAction: result.auditAction ?? (runtime.auditActions.join('; ') || 'Interactive flow completed')
    };
  }

  applyInteractionAction(step, runtime) {
    return { ok: false, output: `Unsupported interaction action: ${step.type}` };
  }

  advanceInteraction() {
    const runtime = this.pendingInteraction;
    if (!runtime) return {};
    const output = [];

    while (runtime.index < runtime.steps.length) {
      const step = runtime.steps[runtime.index++];
      if (step.type === 'input') {
        runtime.waiting = step;
        return {
          awaitInput: true,
          prompt: this.renderInteractionValue(step.prompt, runtime),
          output: output.join('\n')
        };
      }
      if (step.type === 'verify_variable') {
        const actual = runtime.values[step.input] ?? '';
        const expected = this.getVariables()?.[step.variable] ?? '';
        if (!safeEqual(actual, expected)) {
          return this.completeInteraction(runtime, {
            ok: false,
            output: this.renderInteractionValue(step.failureOutput, runtime),
            auditAction: `Interaction verification failed for ${step.variable}`
          });
        }
        runtime.auditActions.push(`Verified ${step.variable}`);
        continue;
      }
      if (step.type === 'verify_choice') {
        const actual = String(runtime.values[step.input] ?? '');
        const comparable = step.caseSensitive ? actual : actual.toLowerCase();
        const accepted = step.choices.some((choice) => (step.caseSensitive ? choice : choice.toLowerCase()) === comparable);
        if (!accepted) {
          return this.completeInteraction(runtime, {
            ok: false,
            output: this.renderInteractionValue(step.failureOutput, runtime),
            auditAction: 'Interaction choice rejected'
          });
        }
        runtime.auditActions.push(`Accepted choice ${actual}`);
        continue;
      }
      if (step.type === 'output') {
        const rendered = this.renderInteractionValue(step.text, runtime);
        if (rendered) output.push(rendered);
        continue;
      }
      if (step.type === 'set_user' || step.type === 'set_mode') {
        const result = this.applyInteractionAction(step, runtime);
        if (result.ok === false) return this.completeInteraction(runtime, result);
        if (result.output) output.push(result.output);
        if (result.auditAction) runtime.auditActions.push(result.auditAction);
        continue;
      }
      if (step.type === 'finish') return this.completeInteraction(runtime, { output: output.join('\n') });
      return this.completeInteraction(runtime, { ok: false, output: `Unsupported interaction step: ${step.type}` });
    }

    return this.completeInteraction(runtime, { output: output.join('\n') });
  }
}

class NetworkSession extends InteractiveSession {
  constructor(instance, sharedState, persist, getCommandRules, getVariables) {
    super();
    this.instance = instance;
    this.state = sharedState;
    this.persist = persist;
    this.getCommandRules = getCommandRules;
    this.getVariables = getVariables;
    this.mode = 'user_exec';
    this.interfaceName = null;
  }

  applyInteractionAction(step, runtime) {
    if (step.type !== 'set_mode') return super.applyInteractionAction(step, runtime);
    const target = this.renderInteractionValue(step.target, runtime);
    if (!['user_exec', 'privileged_exec', 'global_config', 'interface_config'].includes(target)) {
      return { ok: false, output: `% Invalid target mode: ${target}`, auditAction: 'Network mode change rejected' };
    }
    this.mode = target;
    if (target !== 'interface_config') this.interfaceName = null;
    return { ok: true, auditAction: `Session mode changed to ${target}` };
  }

  banner() {
    return [
      '',
      'Monolith Network OS Software',
      `${this.state.hostname} uptime is 18 days, 4 hours, 12 minutes`,
      '',
      'User Access Verification',
      ''
    ].join('\r\n');
  }

  prompt() {
    const hostname = this.state.hostname;
    if (this.mode === 'user_exec') return `${hostname}>`;
    if (this.mode === 'privileged_exec') return `${hostname}#`;
    if (this.mode === 'global_config') return `${hostname}(config)#`;
    return `${hostname}(config-if)#`;
  }

  runningConfig() {
    const interfaces = Object.entries(this.state.interfaces).flatMap(([name, config]) => [
      `interface ${name}`,
      config.ipAddress ? ` ip address ${config.ipAddress}` : ' no ip address',
      config.shutdown ? ' shutdown' : ' no shutdown',
      '!'
    ]);

    return [
      'Building configuration...',
      '',
      'Current configuration : 1024 bytes',
      '!',
      'version 17.9',
      `hostname ${this.state.hostname}`,
      '!',
      ...interfaces,
      'line vty 0 4',
      ' login local',
      ' transport input ssh',
      '!',
      'end'
    ].join('\n');
  }

  interfaceSummary() {
    const rows = Object.entries(this.state.interfaces).map(([name, config]) => {
      const ip = config.ipAddress?.split(' ')[0] ?? 'unassigned';
      const status = config.shutdown ? 'administratively down' : 'up';
      const protocol = config.shutdown ? 'down' : 'up';
      return `${name.padEnd(24)}${ip.padEnd(18)}YES manual ${status.padEnd(22)}${protocol}`;
    });

    return [
      'Interface               IP-Address        OK? Method Status                Protocol',
      ...rows
    ].join('\n');
  }

  execute(rawCommand) {
    const command = rawCommand.trim();
    const lower = command.toLowerCase();

    if (!command) return {};
    const customResult = executeCustomRule(this.getCommandRules(), {
      command,
      hostname: this.state.hostname,
      instance: this.instance.name,
      instanceId: this.instance.id,
      user: this.instance.username,
      kind: 'network',
      mode: this.mode,
      variables: this.getVariables()
    });
    if (customResult?.interaction) return this.beginInteraction(customResult.interaction);
    if (customResult) return customResult;
    if (lower === 'clear' || commandMatches(command, 'clear screen')) return { clear: true };
    if (lower === 'logout' || lower === 'quit') return { exit: true, output: 'Connection closed by remote host.' };

    if (lower === '?' || commandMatches(command, 'help')) {
      return { output: this.help() };
    }

    if (commandMatches(command, 'show version')) {
      return {
        output: [
          'Monolith Network OS Software, Version 17.9.4',
          'Technical Support: https://example.invalid/support',
          'Compiled Thu 31-Jul-26 10:24 by monolith',
          '',
          `${this.state.hostname} uptime is 18 days, 4 hours, 12 minutes`,
          'System image file is "flash:monolith-universalk9.bin"',
          'Configuration register is 0x2102'
        ].join('\n')
      };
    }

    if (commandMatches(command, 'show running-config') || commandMatches(command, 'show run')) {
      return { output: this.runningConfig() };
    }

    if (commandMatches(command, 'show startup-config')) {
      return { output: this.state.startupConfig || '% Startup configuration is not present' };
    }

    if (commandMatches(command, 'show ip interface brief')) {
      return { output: this.interfaceSummary() };
    }

    if (commandMatches(command, 'show clock')) {
      return { output: `${new Date().toISOString()} UTC` };
    }

    if (this.mode === 'user_exec') {
      if (commandMatches(command, 'enable')) {
        this.mode = 'privileged_exec';
        return {};
      }
      return { output: `% Invalid input detected at '^' marker.` };
    }

    if (this.mode === 'privileged_exec') {
      if (commandMatches(command, 'disable')) {
        this.mode = 'user_exec';
        return {};
      }
      if (commandMatches(command, 'configure terminal')) {
        this.mode = 'global_config';
        return { output: 'Enter configuration commands, one per line. End with CNTL/Z.' };
      }
      if (commandMatches(command, 'write memory') || commandMatches(command, 'copy running-config startup-config')) {
        this.state.startupConfig = this.runningConfig();
        this.persist();
        return { output: 'Building configuration...\n[OK]' };
      }
      if (commandMatches(command, 'exit')) return { exit: true, output: 'Connection closed by remote host.' };
      return { output: `% Invalid input detected at '^' marker.` };
    }

    if (lower === 'end') {
      this.mode = 'privileged_exec';
      this.interfaceName = null;
      return {};
    }

    if (lower === 'exit') {
      if (this.mode === 'interface_config') {
        this.mode = 'global_config';
        this.interfaceName = null;
      } else {
        this.mode = 'privileged_exec';
      }
      return {};
    }

    if (this.mode === 'global_config') {
      if (lower.startsWith('hostname ')) {
        const hostname = command.slice(command.indexOf(' ') + 1).trim();
        if (!/^[a-z0-9][a-z0-9-]{0,31}$/i.test(hostname)) {
          return { output: '% Invalid hostname' };
        }
        this.state.hostname = hostname;
        this.persist();
        return {};
      }

      if (lower.startsWith('interface ')) {
        this.interfaceName = command.slice(command.indexOf(' ') + 1).trim();
        this.state.interfaces[this.interfaceName] ??= { ipAddress: null, shutdown: false };
        this.mode = 'interface_config';
        this.persist();
        return {};
      }

      return { output: `% Invalid input detected at '^' marker.` };
    }

    const interfaceConfig = this.state.interfaces[this.interfaceName];
    if (lower.startsWith('ip address ')) {
      interfaceConfig.ipAddress = command.slice('ip address '.length).trim();
      this.persist();
      return {};
    }
    if (lower === 'no ip address') {
      interfaceConfig.ipAddress = null;
      this.persist();
      return {};
    }
    if (lower === 'shutdown' || lower === 'no shutdown') {
      interfaceConfig.shutdown = lower === 'shutdown';
      this.persist();
      return {};
    }

    return { output: `% Invalid input detected at '^' marker.` };
  }

  help() {
    if (this.mode === 'user_exec') return 'enable  exit  help  show';
    if (this.mode === 'privileged_exec') return 'configure  disable  exit  help  show  write';
    if (this.mode === 'global_config') return 'end  exit  hostname  interface';
    return 'end  exit  ip address  no shutdown  shutdown';
  }
}

class LinuxSession extends InteractiveSession {
  constructor(instance, sharedState, persist, username, getCommandRules, getDisabledLinuxBuiltins, getVariables) {
    super();
    this.instance = instance;
    this.state = sharedState;
    this.persist = persist;
    this.username = username;
    this.getCommandRules = getCommandRules;
    this.getDisabledLinuxBuiltins = getDisabledLinuxBuiltins;
    this.getVariables = getVariables;
    this.cwd = username === 'root' ? '/root' : `/home/${username}`;
    this.userStack = [];
  }

  banner() {
    return [
      `Welcome to Monolith Linux 24.04 LTS (${this.instance.name})`,
      '',
      'This is a deterministic virtual shell. Type help for commands.',
      ''
    ].join('\r\n');
  }

  prompt() {
    const displayPath = this.cwd === '/root' ? '~' : this.cwd;
    return `${this.username}@${this.state.hostname}:${displayPath}${this.username === 'root' ? '#' : '$'}`;
  }

  resolvePath(input = '.') {
    const candidate = input.startsWith('/') ? input : path.posix.join(this.cwd, input);
    return path.posix.normalize(candidate);
  }

  listDirectory(targetPath) {
    const normalized = targetPath === '/' ? '/' : `${targetPath.replace(/\/$/, '')}/`;
    const entries = new Set();
    for (const filePath of Object.keys(this.state.files)) {
      if (!filePath.startsWith(normalized) || filePath === targetPath) continue;
      const remainder = filePath.slice(normalized.length);
      if (remainder) entries.add(remainder.split('/')[0]);
    }
    return [...entries].sort().join('  ');
  }

  currentInteractionUser() {
    return this.username;
  }

  applyInteractionAction(step, runtime) {
    if (step.type !== 'set_user') return super.applyInteractionAction(step, runtime);
    const targetUser = this.renderInteractionValue(step.target, runtime).trim();
    if (!/^[a-z_][a-z0-9_-]{0,31}$/i.test(targetUser)) {
      return { ok: false, output: `su: invalid user ${targetUser || '(empty)'}`, auditAction: 'Session user change rejected' };
    }
    this.userStack.push({ username: this.username, cwd: this.cwd });
    this.username = targetUser;
    this.cwd = targetUser === 'root' ? '/root' : `/home/${targetUser}`;
    this.state.files[this.cwd] ??= { type: 'dir' };
    this.persist();
    return { ok: true, auditAction: `Session user switched to ${targetUser}` };
  }

  execute(rawCommand) {
    const command = rawCommand.trim();
    const args = parseArgs(command);
    const name = args[0]?.toLowerCase();

    if (!command) return {};
    const customResult = executeCustomRule(this.getCommandRules(), {
      command,
      hostname: this.state.hostname,
      instance: this.instance.name,
      instanceId: this.instance.id,
      user: this.username,
      kind: 'linux',
      mode: 'shell',
      variables: this.getVariables()
    });
    if (customResult?.interaction) {
      return this.beginInteraction(customResult.interaction);
    }
    if (customResult) return customResult;
    const builtin = linuxBuiltinForName(name);
    if (builtin && this.getDisabledLinuxBuiltins().has(builtin.id)) {
      return { output: `bash: ${args[0]}: command not found` };
    }
    if (name === 'clear') return { clear: true };
    if (name === 'exit' || name === 'logout') {
      const previousUser = this.userStack.pop();
      if (!previousUser) return { exit: true, output: 'logout' };
      this.username = previousUser.username;
      this.cwd = previousUser.cwd;
      return { output: 'logout' };
    }
    if (name === 'help') {
      const available = LINUX_BUILTIN_COMMANDS
        .filter((item) => !this.getDisabledLinuxBuiltins().has(item.id))
        .map((item) => item.command)
        .sort();
      return { output: `Available commands: ${available.join(' ')}` };
    }
    if (name === 'pwd') return { output: this.cwd };
    if (name === 'whoami') return { output: this.username };
    if (name === 'id') return { output: this.username === 'root' ? 'uid=0(root) gid=0(root) groups=0(root)' : `uid=1000(${this.username}) gid=1000(${this.username})` };
    if (name === 'hostname') return { output: this.state.hostname };
    if (name === 'date') return { output: new Date().toString() };
    if (name === 'uname') return { output: args.includes('-a') ? `Linux ${this.state.hostname} 6.8.0-monolith #1 SMP x86_64 GNU/Linux` : 'Linux' };
    if (name === 'env') return { output: `HOME=${this.username === 'root' ? '/root' : `/home/${this.username}`}\nUSER=${this.username}\nSHELL=/bin/bash\nTERM=xterm-256color` };
    if (name === 'ps') return { output: '  PID TTY          TIME CMD\n    1 ?        00:00:02 systemd\n  412 ?        00:00:00 sshd\n  644 pts/0    00:00:00 bash\n  701 pts/0    00:00:00 ps' };
    if (name === 'ip' && args[1] === 'addr') return { output: '1: lo: <LOOPBACK,UP> mtu 65536\n    inet 127.0.0.1/8 scope host lo\n2: eth0: <BROADCAST,MULTICAST,UP> mtu 1500\n    inet 10.24.8.12/24 scope global eth0' };
    if (name === 'ip' && args[1] === 'route') return { output: 'default via 10.24.8.1 dev eth0\n10.24.8.0/24 dev eth0 proto kernel scope link src 10.24.8.12' };
    if (name === 'systemctl') return { output: '● ssh.service - OpenBSD Secure Shell server\n     Loaded: loaded\n     Active: active (running) since Thu 2026-07-13 08:04:21 UTC' };
    if (name === 'uptime') return { output: ' 13:24:08 up 18 days,  4:12,  1 user,  load average: 0.08, 0.05, 0.01' };
    if (name === 'df') return { output: 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/vda1        40G  6.2G   32G  17% /\ntmpfs           512M     0  512M   0% /run' };
    if (name === 'free') return { output: '               total        used        free      shared  buff/cache   available\nMem:         1048576      262144      524288       16384      262144      720896\nSwap:              0           0           0' };
    if (name === 'which') {
      const requested = args[1]?.toLowerCase();
      const requestedBuiltin = linuxBuiltinForName(requested);
      if (!requestedBuiltin || this.getDisabledLinuxBuiltins().has(requestedBuiltin.id)) return {};
      return { output: `/usr/bin/${requestedBuiltin.command}` };
    }

    if (name === 'cd') {
      const target = this.resolvePath(args[1] || (this.username === 'root' ? '/root' : `/home/${this.username}`));
      if (this.state.files[target]?.type !== 'dir') return { output: `bash: cd: ${args[1] ?? ''}: No such file or directory` };
      this.cwd = target;
      return {};
    }

    if (name === 'ls') {
      const target = this.resolvePath(args.find((arg) => !arg.startsWith('-')) || '.');
      const entry = this.state.files[target];
      if (!entry) return { output: `ls: cannot access '${args[1] ?? '.'}': No such file or directory` };
      return { output: entry.type === 'dir' ? this.listDirectory(target) : path.posix.basename(target) };
    }

    if (name === 'cat') {
      const target = this.resolvePath(args[1] || '');
      const entry = this.state.files[target];
      if (!entry || entry.type !== 'file') return { output: `cat: ${args[1] ?? ''}: No such file or directory` };
      return { output: entry.content };
    }

    if (name === 'touch' || name === 'mkdir') {
      if (!args[1]) return { output: `${name}: missing operand` };
      const target = this.resolvePath(args[1]);
      this.state.files[target] = name === 'mkdir' ? { type: 'dir' } : { type: 'file', content: this.state.files[target]?.content ?? '' };
      this.persist();
      return {};
    }

    if (name === 'rm') {
      if (!args[1]) return { output: 'rm: missing operand' };
      const target = this.resolvePath(args[1]);
      if (!this.state.files[target]) return { output: `rm: cannot remove '${args[1]}': No such file or directory` };
      delete this.state.files[target];
      this.persist();
      return {};
    }

    if (name === 'echo') {
      const redirectIndex = args.indexOf('>');
      if (redirectIndex > 0 && args[redirectIndex + 1]) {
        const target = this.resolvePath(args[redirectIndex + 1]);
        this.state.files[target] = { type: 'file', content: args.slice(1, redirectIndex).join(' ') };
        this.persist();
        return {};
      }
      return { output: args.slice(1).join(' ') };
    }

    return { output: `bash: ${args[0]}: command not found` };
  }
}

function createDefaultState(instance) {
  if (instance.kind === 'network') {
    return {
      hostname: instance.name,
      startupConfig: '',
      interfaces: {
        'GigabitEthernet0/0': { ipAddress: '10.24.0.1 255.255.255.0', shutdown: false },
        'GigabitEthernet0/1': { ipAddress: null, shutdown: true }
      }
    };
  }

  return {
    hostname: instance.name,
    files: {
      '/': { type: 'dir' },
      '/etc': { type: 'dir' },
      '/etc/hostname': { type: 'file', content: instance.name },
      '/etc/os-release': { type: 'file', content: 'NAME="Monolith Linux"\nVERSION="24.04 LTS"' },
      '/home': { type: 'dir' },
      '/root': { type: 'dir' },
      '/root/README.txt': { type: 'file', content: 'Welcome to the MonolithSSH virtual Linux shell.' },
      '/var': { type: 'dir' },
      '/var/log': { type: 'dir' },
      '/var/log/auth.log': { type: 'file', content: 'sshd: Server listening on 0.0.0.0 port 22.' }
    }
  };
}

function createSession(instance, sharedState, persist, username, getCommandRules = () => [], getDisabledLinuxBuiltins = () => new Set(), getVariables = () => ({})) {
  return instance.kind === 'network'
    ? new NetworkSession(instance, sharedState, persist, getCommandRules, getVariables)
    : new LinuxSession(instance, sharedState, persist, username, getCommandRules, getDisabledLinuxBuiltins, getVariables);
}

module.exports = {
  createDefaultState,
  createSession,
  LINUX_BUILTIN_COMMANDS,
  normalizeOutput
};
