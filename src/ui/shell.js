import { icon } from './icons.js';
import i18next from '../i18n.js';
import appIconUrl from '../../assets/icon-256.png';

const navigation = [
  { route: 'dashboard', label: () => i18next.t('nav.dashboard'), icon: 'dashboard', index: '01' },
  { route: 'instances', label: () => i18next.t('nav.instances'), icon: 'terminal', index: '02' },
  { route: 'terminal', label: () => i18next.t('nav.terminal'), icon: 'command', index: '03' },
  { route: 'profiles', label: () => i18next.t('nav.profiles'), icon: 'profile', index: '04' },
  { route: 'audit', label: () => i18next.t('nav.audit'), icon: 'audit', index: '05' }
];

export function renderShell() {
  const currentLanguage = i18next.language;
  return `
    <header class="window-titlebar">
      <div class="window-titlebar__identity">
        <img src="${appIconUrl}" alt="">
        <strong>MONOLITH<span>/SSH</span></strong>
        <i aria-hidden="true"></i>
        <span>${i18next.t('shell.windowSubtitle')}</span>
      </div>
      <span class="window-titlebar__mode"><i></i>CORE / ${i18next.t('common.local')}</span>
    </header>
    <div class="app-shell">
      <aside class="sidebar">
        <div class="sidebar__brand">
          <div class="brand-mark">${icon('logo')}</div>
          <div><div class="brand-title"><span>MONOLITH</span><b>SSH</b></div><span class="brand-version" data-app-version>v0.3.0-desktop</span></div>
        </div>

        <span class="sidebar__label">CONTROL DECK</span>
        <nav class="primary-nav" aria-label="${i18next.t('shell.primaryNavigation')}">
          ${navigation.map((item) => `
            <button class="nav-item" type="button" data-route="${item.route}" aria-label="${item.label()}" title="${item.label()}">
              <span class="nav-item__icon">${icon(item.icon)}</span><span class="nav-item__label">${item.label()}</span><small>${item.index}</small>
            </button>
          `).join('')}
        </nav>

        <div class="user-card">
          <span class="user-avatar">A</span>
          <span><strong>${i18next.t('common.admin')}</strong><small><i></i>${i18next.t('common.online')}</small></span>
        </div>
      </aside>

      <section class="app-main">
        <header class="topbar">
          <div class="topbar__title"><span>LOCAL WORKSPACE</span><h1 id="page-title">${i18next.t('nav.dashboard')}</h1></div>
          <div class="topbar__actions">
            <span class="system-status"><i></i><span>${i18next.t('shell.systemOnline')}</span></span>
            <label class="language-picker">
              <span>${i18next.t('shell.language')}</span>
              <select data-locale aria-label="${i18next.t('shell.language')}">
                <option value="zh-CN" ${currentLanguage === 'zh-CN' ? 'selected' : ''}>中文</option>
                <option value="en-US" ${currentLanguage === 'en-US' ? 'selected' : ''}>English</option>
              </select>
            </label>
            <button class="icon-button" type="button" aria-label="${i18next.t('shell.notifications')}">${icon('bell')}</button>
            <button class="icon-button" type="button" data-route="settings" aria-label="${i18next.t('shell.settings')}">${icon('settings')}</button>
          </div>
        </header>
        <main class="page-root" id="page-root"></main>
      </section>
    </div>
  `;
}
