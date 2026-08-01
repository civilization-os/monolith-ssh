import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { icon } from '../ui/icons.js';
import i18next from '../i18n.js';

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function getSelectedInstance(state) {
  const running = state.instances.filter((instance) => instance.running);
  return running.find((instance) => instance.id === state.selectedInstanceId) ?? running[0] ?? null;
}

export function renderTerminal(state) {
  const t = i18next.t.bind(i18next);
  const running = state.instances.filter((instance) => instance.running);
  const selected = getSelectedInstance(state);
  const initialStatus = t(window.monolith ? 'terminal.status.connecting' : 'terminal.status.preview');

  return `
    <div class="page page--terminal">
      <div class="page-heading terminal-page-heading">
        <div><h2>${t('terminal.title')}</h2><p>${t('terminal.subtitle')}</p></div>
        ${selected ? `
          <div class="terminal-page-actions">
            <label><span>${t('terminal.target')}</span><select aria-label="${t('terminal.targetLabel')}" data-terminal-target>${running.map((instance) => `<option value="${instance.id}" ${instance.id === selected.id ? 'selected' : ''}>${escapeHtml(instance.name)} · ${escapeHtml(instance.address)}</option>`).join('')}</select></label>
            <button class="connection-button" type="button" data-terminal-connect><i></i><span>${initialStatus}</span></button>
          </div>
        ` : ''}
      </div>

      ${state.error ? `<p class="inline-error" role="alert">${escapeHtml(state.error)}</p>` : ''}

      ${selected ? `
        <section class="terminal-workspace" aria-label="${t('terminal.workspaceLabel')}">
          <aside class="session-rail">
            <div class="session-rail__heading"><span>${t('terminal.localInstances')}</span><button type="button" aria-label="${t('terminal.goToInstances')}" data-route="instances">${icon('plus')}</button></div>
            <div class="session-stack">
              ${state.instances.map((instance) => `
                <button class="session-item ${instance.id === selected.id ? 'is-active' : ''}" type="button" data-terminal-select="${instance.id}" ${instance.running ? '' : 'disabled'}>
                  <i></i><span><strong>${escapeHtml(instance.name)}</strong><small>${escapeHtml(instance.running ? instance.address : t('common.stopped'))}</small></span>
                </button>
              `).join('')}
            </div>
            <div class="vault-state">${icon('lock')}<span><strong>${escapeHtml(selected.credentialHint)}</strong><small>${t('terminal.localCredential')}</small></span></div>
          </aside>

          <div class="terminal-shell">
            <div class="terminal-tabs">
              ${running.map((instance) => `<button class="terminal-tab ${instance.id === selected.id ? 'is-active' : ''}" type="button" data-terminal-select="${instance.id}"><i></i>${escapeHtml(instance.name)}</button>`).join('')}
              <button class="terminal-tab-add" type="button" aria-label="${t('terminal.createInstance')}" data-route="instances">${icon('plus')}</button>
              <div class="terminal-tools"><span>SSH · UTF-8</span><button type="button" data-terminal-clear>${t('terminal.clear')}</button></div>
            </div>

            <div class="xterm-host" data-terminal-host aria-label="${t('terminal.interactiveLabel')}"></div>

            <footer class="terminal-statusbar">
              <span data-terminal-status><i></i>${initialStatus}</span>
              <span>${escapeHtml(selected.name)}</span>
              <span>${escapeHtml(selected.address)}</span>
              <span data-terminal-size>${t('terminal.columnsRows', { columns: '—', rows: '—' })}</span>
            </footer>
          </div>
        </section>
      ` : `
        <section class="terminal-empty">
          ${icon('terminal')}
          <h3>${t('terminal.noRunning')}</h3>
          <p>${t('terminal.noRunningHint')}</p>
          <button class="outline-button" type="button" data-route="instances">${t('terminal.openInstances')}</button>
        </section>
      `}
    </div>
  `;
}

function readToken(styles, name) {
  return styles.getPropertyValue(name).trim();
}

function createXterm(host) {
  const styles = getComputedStyle(document.documentElement);
  const terminal = new Terminal({
    allowTransparency: false,
    convertEol: true,
    cursorBlink: true,
    cursorStyle: 'block',
    fontFamily: readToken(styles, '--font-mono'),
    fontSize: Number(readToken(styles, '--xterm-font-size')),
    letterSpacing: Number(readToken(styles, '--xterm-letter-spacing')),
    lineHeight: Number(readToken(styles, '--xterm-line-height')),
    scrollback: 5000,
    theme: {
      background: readToken(styles, '--color-terminal-background'),
      foreground: readToken(styles, '--color-terminal-foreground'),
      cursor: readToken(styles, '--color-terminal-cursor'),
      cursorAccent: readToken(styles, '--color-terminal-background'),
      selectionBackground: readToken(styles, '--color-terminal-selection'),
      black: readToken(styles, '--color-terminal-background'),
      brightBlack: readToken(styles, '--color-terminal-muted'),
      red: readToken(styles, '--color-terminal-red'),
      green: readToken(styles, '--color-terminal-green'),
      yellow: readToken(styles, '--color-terminal-yellow'),
      blue: readToken(styles, '--color-terminal-blue'),
      cyan: readToken(styles, '--color-terminal-cyan'),
      magenta: readToken(styles, '--color-terminal-magenta')
    }
  });
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(host);
  return { terminal, fitAddon };
}

function mountPreviewTerminal(terminal) {
  terminal.writeln(`\x1b[1m${i18next.t('terminal.previewTitle')}\x1b[0m`);
  terminal.writeln(i18next.t('terminal.previewHint'));
  terminal.writeln('');
  terminal.write('preview@monolith:~$ ');
  let command = '';
  return terminal.onData((data) => {
    if (data === '\r') {
      terminal.writeln('');
      terminal.writeln(command === 'help' ? i18next.t('terminal.previewHelp') : `preview: ${command || i18next.t('terminal.previewEmpty')}`);
      command = '';
      terminal.write('preview@monolith:~$ ');
    } else if (data === '\u007f' && command) {
      command = command.slice(0, -1);
      terminal.write('\b \b');
    } else if (data >= ' ') {
      command += data;
      terminal.write(data);
    }
  });
}

export function mountTerminal(state) {
  const host = document.querySelector('[data-terminal-host]');
  const selected = getSelectedInstance(state);
  if (!host || !selected) return null;

  const { terminal, fitAddon } = createXterm(host);
  const sizeLabel = document.querySelector('[data-terminal-size]');
  const statusLabel = document.querySelector('[data-terminal-status]');
  const connectionButton = document.querySelector('[data-terminal-connect]');
  const connectionText = connectionButton.querySelector('span');
  const clearButton = document.querySelector('[data-terminal-clear]');
  let sessionId = null;
  let opening = false;
  let disposed = false;

  const setStatus = (status, message) => {
    const label = message || i18next.t(`terminal.status.${status}`, { defaultValue: status });
    const connected = status === 'connected';
    connectionButton.classList.toggle('is-connected', connected);
    connectionText.textContent = label;
    statusLabel.classList.toggle('is-connected', connected);
    statusLabel.innerHTML = `<i></i>${escapeHtml(label)}`;
  };

  const fit = () => {
    fitAddon.fit();
    sizeLabel.textContent = i18next.t('terminal.columnsRows', { columns: terminal.cols, rows: terminal.rows });
    if (sessionId && window.monolith) {
      void window.monolith.terminal.resize(sessionId, { cols: terminal.cols, rows: terminal.rows });
    }
  };

  const resizeObserver = new ResizeObserver(fit);
  resizeObserver.observe(host);

  if (!window.monolith) {
    const previewDisposable = mountPreviewTerminal(terminal);
    const frame = requestAnimationFrame(() => { fit(); terminal.focus(); });
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      previewDisposable.dispose();
      terminal.dispose();
    };
  }

  const removeDataListener = window.monolith.terminal.onData((payload) => {
    if (!sessionId || payload.sessionId === sessionId) terminal.write(payload.data);
  });
  const removeStatusListener = window.monolith.terminal.onStatus((payload) => {
    if (!sessionId || payload.sessionId === sessionId) setStatus(payload.status, payload.message);
  });

  const openConnection = async () => {
    if (opening || sessionId || disposed) return;
    opening = true;
    terminal.reset();
    terminal.writeln(`\x1b[90m${i18next.t('terminal.connectingTo', { name: selected.name, address: selected.address })}\x1b[0m`);
    setStatus('connecting');
    try {
      const result = await window.monolith.terminal.open(selected.id, { cols: terminal.cols, rows: terminal.rows });
      if (disposed) {
        await window.monolith.terminal.close(result.sessionId);
        return;
      }
      sessionId = result.sessionId;
      setStatus('connected');
      fit();
      terminal.focus();
    } catch (error) {
      terminal.writeln(`\r\n\x1b[31m${i18next.t('terminal.connectionFailed', { message: error.message })}\x1b[0m`);
      setStatus('error');
    } finally {
      opening = false;
    }
  };

  const inputDisposable = terminal.onData((data) => {
    if (sessionId) void window.monolith.terminal.write(sessionId, data);
  });

  const clearTerminal = () => {
    terminal.clear();
    terminal.focus();
  };

  const toggleConnection = async () => {
    if (sessionId) {
      const closingSession = sessionId;
      sessionId = null;
      await window.monolith.terminal.close(closingSession);
      setStatus('closed');
      terminal.writeln(`\r\n\x1b[90m${i18next.t('terminal.sessionDisconnected')}\x1b[0m`);
    } else {
      await openConnection();
    }
  };

  clearButton.addEventListener('click', clearTerminal);
  connectionButton.addEventListener('click', toggleConnection);

  const frame = requestAnimationFrame(() => {
    fit();
    void openConnection();
  });

  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    clearButton.removeEventListener('click', clearTerminal);
    connectionButton.removeEventListener('click', toggleConnection);
    inputDisposable.dispose();
    removeDataListener();
    removeStatusListener();
    if (sessionId) void window.monolith.terminal.close(sessionId);
    terminal.dispose();
  };
}
