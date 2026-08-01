import { icon } from '../ui/icons.js';
import i18next from '../i18n.js';

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function buildBars(events) {
  const buckets = Array.from({ length: 12 }, () => 0);
  const now = Date.now();
  for (const event of events) {
    const ageHours = Math.floor((now - new Date(event.timestamp).getTime()) / 3600000);
    if (ageHours >= 0 && ageHours < 12) buckets[11 - ageHours] += 1;
  }
  const maximum = Math.max(...buckets, 1);
  return buckets.map((count) => ({ count, height: count ? Math.max(12, Math.round((count / maximum) * 94)) : 4 }));
}

export function renderDashboard(state) {
  const t = i18next.t.bind(i18next);
  const activeCount = state.instances.filter((instance) => instance.running).length;
  const metrics = [
    { label: t('dashboard.activeInstances'), value: String(activeCount), note: t('dashboard.configured', { total: state.instances.length }), icon: 'server' },
    { label: t('dashboard.networkDevices'), value: String(state.instances.filter((instance) => instance.kind === 'network').length), note: t('dashboard.virtualCli'), icon: 'cable' },
    { label: t('dashboard.auditEvents'), value: String(state.auditEvents.length), note: t('dashboard.localEventStore'), icon: 'shield' }
  ];
  const bars = buildBars(state.auditEvents);
  const maximum = Math.max(...bars.map((bar) => bar.count), 1);
  const logRows = state.auditEvents.slice(0, 5);

  return `
    <div class="page page--dashboard">
      <div class="page-heading page-heading--compact">
        <h2>${t('dashboard.overview')}</h2>
        <span class="meta-text">${t('dashboard.lastUpdated')}</span>
      </div>

      <section class="metric-grid" aria-label="${t('dashboard.systemMetrics')}">
        ${metrics.map((metric) => `
          <article class="metric-card">
            <div class="metric-card__label"><span>${metric.label}</span>${icon(metric.icon)}</div>
            <div class="metric-card__value"><strong>${metric.value}</strong><span>${metric.note}</span></div>
          </article>
        `).join('')}
      </section>

      <div class="dashboard-grid">
        <section class="panel chart-panel">
          <div class="panel-heading">
            <h3>${t('dashboard.connectionRequests')}</h3>
            <span>${t('dashboard.last24Hours')}</span>
          </div>
          <div class="chart">
            <div class="chart__scale"><span>${maximum}</span><span>${Math.ceil(maximum * 0.75)}</span><span>${Math.ceil(maximum * 0.5)}</span><span>${Math.ceil(maximum * 0.25)}</span><span>0</span></div>
            <div class="chart__visual">
              <svg class="chart__plot" viewBox="0 0 120 100" preserveAspectRatio="none" role="img" aria-label="${t('dashboard.chartLabel')}">
                ${bars.map((bar, index) => `<rect class="chart__bar ${bar.count === maximum && bar.count > 0 ? 'is-peak' : ''}" x="${index * 10 + 1}" y="${100 - bar.height}" width="8" height="${bar.height}"><title>${t('dashboard.eventCount', { count: bar.count })}</title></rect>`).join('')}
              </svg>
              <div class="chart__labels"><span>${t('dashboard.hoursAgo12')}</span><span>${t('dashboard.hours9')}</span><span>${t('dashboard.hours6')}</span><span>${t('dashboard.hours3')}</span><span>${t('dashboard.now')}</span></div>
            </div>
          </div>
        </section>

        <section class="panel activity-panel">
          <div class="panel-heading panel-heading--mono">
            <span class="window-dots"><i></i><i></i><i></i></span>
            <h3>activity_feed.log</h3>
            ${icon('broadcast')}
          </div>
          <div class="activity-log">
            ${logRows.length ? logRows.map((event) => `<p><time>${new Date(event.timestamp).toLocaleTimeString(i18next.language, { hour12: false })}</time><span>${escapeHtml(event.source === 'local' ? t('common.local') : event.source)}</span><b>→</b><span>${escapeHtml(event.instanceName)}</span></p>`).join('') : `<p><time>—</time><span>${t('dashboard.noActivity')}</span></p>`}
            <p class="activity-log__cursor"><time>${t('dashboard.live')}</time><i></i></p>
          </div>
          <label class="terminal-filter"><span>&gt;</span><input aria-label="${t('dashboard.filterActivity')}" placeholder="${t('dashboard.filterPlaceholder')}" /></label>
        </section>
      </div>
    </div>
  `;
}
