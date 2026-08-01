import { icon } from '../ui/icons.js';
import i18next from '../i18n.js';

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function formatTimestamp(timestamp) {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleString(i18next.language, { hour12: false });
}

function formatSource(source) {
  return source === 'local' ? i18next.t('common.local') : source;
}

function formatCredentials(credentials) {
  if (credentials === 'system') return i18next.t('common.system');
  const [username, method] = String(credentials ?? '').split(' / ');
  if (!method) return credentials;
  const methodLabel = method === 'password'
    ? i18next.t('common.password')
    : method === 'publickey' ? i18next.t('common.publicKey') : method;
  return `${username} / ${methodLabel}`;
}

function formatAction(event) {
  if (event.type === 'instance.create') {
    const kind = event.action.includes('network') ? i18next.t('instances.networkDevice') : i18next.t('instances.virtualLinux');
    return i18next.t('audit.actions.instanceCreated', { kind });
  }
  if (event.type === 'auth') return i18next.t(event.ok ? 'audit.actions.loginAccepted' : 'audit.actions.loginRejected');
  if (event.type === 'instance.start') {
    return i18next.t('audit.actions.instanceListening', { address: event.action.replace(/^Listening on /, '') });
  }
  if (event.type === 'instance.stop') return i18next.t('audit.actions.instanceStopped');
  if (event.type === 'instance.delete') return i18next.t('audit.actions.instanceDeleted');
  if (event.type === 'instance.endpoint') {
    const match = event.action.match(/from (\S+) to (\S+)$/);
    return match ? i18next.t('audit.actions.instanceEndpointChanged', { from: match[1], to: match[2] }) : event.action;
  }
  if (event.type === 'instance.credentials') {
    const match = event.action.match(/authentication: ([^,]+), user (.+)$/);
    return match ? i18next.t('audit.actions.instanceCredentialsUpdated', { method: match[1], user: match[2] }) : event.action;
  }
  if (event.type === 'rules.update') {
    const count = Number(event.action.match(/\d+/)?.[0] ?? 0);
    return i18next.t('audit.actions.rulesUpdated', { count });
  }
  if (event.type === 'builtins.delete') {
    return i18next.t('audit.actions.builtinDeleted', { command: event.action.split(': ').at(-1) });
  }
  if (event.type === 'builtins.restore') {
    const count = Number(event.action.match(/\d+/)?.[0] ?? 0);
    return i18next.t('audit.actions.builtinsRestored', { count });
  }
  if (event.type === 'variables.update') {
    const count = Number(event.action.match(/\d+/)?.[0] ?? 0);
    return i18next.t('audit.actions.variablesUpdated', { count });
  }
  return event.action;
}

export function renderAudit(state) {
  const t = i18next.t.bind(i18next);
  const query = state.auditQuery.toLowerCase();
  const filtered = state.auditEvents.filter((event) => {
    const matchesQuery = Object.values(event).join(' ').toLowerCase().includes(query);
    const matchesFilter = state.auditFilter === 'all' || (state.auditFilter === 'success' ? event.ok : !event.ok);
    return matchesQuery && matchesFilter;
  });

  return `
    <div class="page">
      <div class="audit-toolbar">
        <label class="search-field">${icon('search')}<input data-audit-search value="${escapeHtml(state.auditQuery)}" placeholder="${t('audit.searchPlaceholder')}" /></label>
        <select data-audit-filter aria-label="${t('audit.filterLabel')}">
          <option value="all" ${state.auditFilter === 'all' ? 'selected' : ''}>${t('audit.allEvents')}</option>
          <option value="success" ${state.auditFilter === 'success' ? 'selected' : ''}>${t('audit.success')}</option>
          <option value="failed" ${state.auditFilter === 'failed' ? 'selected' : ''}>${t('audit.failed')}</option>
        </select>
        <span class="audit-export">${t('audit.localStore')}</span>
      </div>

      <section class="data-card" aria-label="${t('audit.tableLabel')}">
        <div class="data-table data-table--audit" role="table">
          <div class="data-table__head" role="row"><span>${t('common.status')}</span><span>${t('common.timestamp')}</span><span>${t('common.source')}</span><span>${t('common.credentials')}</span><span>${t('common.action')}</span></div>
          ${filtered.length ? filtered.map((event) => `
            <div class="data-table__row" role="row">
              <span class="audit-result ${event.ok ? 'is-success' : 'is-failed'}" data-label="${t('common.status')}" aria-label="${t(event.ok ? 'common.success' : 'common.failed')}">${icon(event.ok ? 'check' : 'error')}<span>${t(event.ok ? 'common.success' : 'common.failed')}</span></span>
              <code data-label="${t('common.timestamp')}">${escapeHtml(formatTimestamp(event.timestamp))}</code>
              <code data-label="${t('common.source')}">${escapeHtml(formatSource(event.source))}</code>
              <code data-label="${t('common.credentials')}">${escapeHtml(formatCredentials(event.credentials))}</code>
              <span class="audit-action" data-label="${t('common.action')}"><strong>${escapeHtml(event.instanceName)}</strong><small>${escapeHtml(formatAction(event))}</small></span>
            </div>
          `).join('') : `<p class="empty-state">${t(state.loading ? 'audit.loading' : 'audit.noMatch')}</p>`}
        </div>
      </section>

      <div class="pagination"><span>${t('audit.showing', { filtered: filtered.length, total: state.auditEvents.length })}</span></div>
    </div>
  `;
}
