import { icon } from '../ui/icons.js';
import i18next from '../i18n.js';

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export function mcpSseConfig(status) {
  return JSON.stringify({
    mcpServers: {
      monolithssh: {
        url: status.sseEndpoint,
        transport: 'sse'
      }
    }
  }, null, 2);
}

export function renderSettings(state) {
  const t = i18next.t.bind(i18next);
  const status = state.mcpStatus;
  const config = mcpSseConfig(status);
  const running = status.enabled && status.running;
  const toolGroups = [
    ['instances', t('settings.tools.instances'), t('settings.tools.instancesHint')],
    ['credentials', t('settings.tools.credentials'), t('settings.tools.credentialsHint')],
    ['diagnostics', t('settings.tools.diagnostics'), t('settings.tools.diagnosticsHint')],
    ['commands', t('settings.tools.commands'), t('settings.tools.commandsHint')],
    ['rules', t('settings.tools.rules'), t('settings.tools.rulesHint')],
    ['variables', t('settings.tools.variables'), t('settings.tools.variablesHint')],
    ['builtins', t('settings.tools.builtins'), t('settings.tools.builtinsHint')],
    ['audit', t('settings.tools.audit'), t('settings.tools.auditHint')]
  ];

  return `
    <div class="page mcp-settings-page">
      <div class="page-heading mcp-page-heading">
        <div><span class="page-kicker">MCP / SSE</span><h2>${t('settings.title')}</h2><p>${t('settings.subtitle')}</p></div>
        <span class="mcp-transport-state ${running ? 'is-running' : ''}"><i></i>${t(running ? 'settings.running' : 'settings.stopped')}</span>
      </div>

      ${state.error ? `<p class="inline-error" role="alert">${escapeHtml(state.error)}</p>` : ''}
      ${status.lastError ? `<p class="inline-error" role="alert">${escapeHtml(status.lastError)}</p>` : ''}

      <section class="mcp-control-panel">
        <div class="mcp-control-copy">
          <span class="mcp-control-icon">${icon('broadcast')}</span>
          <div><h3>${t('settings.gatewayTitle')}</h3><p>${t('settings.gatewayHint')}</p><code>${escapeHtml(status.sseEndpoint)}</code></div>
        </div>
        <label class="mcp-switch">
          <input type="checkbox" data-mcp-toggle ${status.enabled ? 'checked' : ''} />
          <span class="mcp-switch__track"><i></i></span>
          <span>${t(status.enabled ? 'settings.disableGateway' : 'settings.enableGateway')}</span>
        </label>
      </section>

      <div class="mcp-settings-grid">
        <section class="mcp-boundary-card">
          <div class="panel-heading"><h3>${t('settings.statelessTitle')}</h3><span>${t('settings.zeroStorage')}</span></div>
          <div class="mcp-boundary-flow">
            <div><span>01</span>${icon('cable')}<strong>${t('settings.receive')}</strong><small>${t('settings.receiveHint')}</small></div>
            <b>→</b>
            <div><span>02</span>${icon('command')}<strong>${t('settings.forward')}</strong><small>${t('settings.forwardHint')}</small></div>
            <b>→</b>
            <div><span>03</span>${icon('undo')}<strong>${t('settings.discard')}</strong><small>${t('settings.discardHint')}</small></div>
          </div>
          <ul class="mcp-safety-list">
            <li>${icon('lock')}<span><strong>${t('settings.localOnly')}</strong><small>${t('settings.localOnlyHint')}</small></span></li>
            <li>${icon('shield')}<span><strong>${t('settings.appOwnsState')}</strong><small>${t('settings.appOwnsStateHint')}</small></span></li>
            <li>${icon('broadcast')}<span><strong>${t('settings.ephemeralConnections')}</strong><small>${t('settings.ephemeralConnectionsHint')}</small></span></li>
          </ul>
        </section>

        <section class="mcp-config-card">
          <div class="panel-heading"><h3>${t('settings.jsonTitle')}</h3><button type="button" data-copy-mcp-config>${state.mcpCopied ? t('settings.copied') : t('settings.copy')}</button></div>
          <p>${t('settings.jsonHint')}</p>
          <pre><code>${escapeHtml(config)}</code></pre>
          <div class="mcp-endpoints">
            <div><span>${t('settings.sseCompatibility')}</span><code>${escapeHtml(status.sseEndpoint)}</code></div>
            <div><span>${t('settings.modernEndpoint')}</span><code>${escapeHtml(status.endpoint)}</code></div>
          </div>
        </section>
      </div>

      <section class="mcp-capabilities">
        <div class="rules-heading"><div><h3>${t('settings.capabilitiesTitle')}</h3><p>${t('settings.capabilitiesHint')}</p></div><span class="builtin-count">${t('settings.toolCount', { count: status.toolCount })}</span></div>
        <div class="mcp-capability-grid">${toolGroups.map(([id, title, hint]) => `
          <article><span>${id}</span><strong>${title}</strong><p>${hint}</p></article>
        `).join('')}</div>
      </section>

      <div class="mcp-danger-note">${icon('shield')}<div><strong>${t('settings.fullControlTitle')}</strong><p>${t('settings.fullControlHint')}</p></div></div>
    </div>
  `;
}
