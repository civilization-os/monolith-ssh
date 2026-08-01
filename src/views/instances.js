import { icon } from '../ui/icons.js';
import i18next from '../i18n.js';

function escapeHtml(value = '') {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function authLabel(method, t) {
  return t(`instances.auth.${method === 'publickey' || method === 'both' ? method : 'password'}`);
}

function usesPassword(method) {
  return method === 'password' || method === 'both';
}

function usesPublicKey(method) {
  return method === 'publickey' || method === 'both';
}

function renderCredentialField(label, value, action, t, extraClass = '') {
  return `<div class="credential-delivery__item ${extraClass}">
    <span>${label}</span>
    <div><code>${escapeHtml(value)}</code><button type="button" data-copy-credential="${action}">${t('instances.copy')}</button></div>
  </div>`;
}

function renderSuccess(creator, t) {
  const instance = creator.created;
  const port = String(instance.address).split(':').at(-1);
  const connectionHost = instance.host === '0.0.0.0' ? 'HOST_IP' : '127.0.0.1';
  const command = usesPublicKey(creator.authMethod)
    ? `ssh -i ${creator.name || 'monolithssh-key'}.pem -p ${port} ${creator.username}@${connectionHost}`
    : `ssh -p ${port} ${creator.username}@${connectionHost}`;

  return `<div class="credential-modal__success">
    <div class="credential-success-mark">${icon('check')}</div>
    <p class="credential-kicker">${t('instances.deliveryComplete')}</p>
    <h3>${t('instances.credentialsReady')}</h3>
    <p>${t('instances.credentialsReadyHint', { name: instance.name })}</p>
    ${instance.host === '0.0.0.0' ? `<p class="network-access-ready">${t('instances.networkAccessReady')}</p>` : ''}

    <div class="credential-delivery">
      ${renderCredentialField(t('instances.connectionCommand'), command, 'command', t)}
      ${renderCredentialField(t('instances.username'), creator.username, 'username', t)}
      ${usesPassword(creator.authMethod) ? renderCredentialField(t('instances.password'), creator.password, 'password', t, 'is-sensitive') : ''}
      ${creator.fingerprint ? renderCredentialField(t('instances.fingerprint'), creator.fingerprint, 'fingerprint', t) : ''}
    </div>

    ${creator.privateKey ? `<div class="private-key-delivery">
      <div><strong>${t('instances.privateKey')}</strong><span>${t('instances.privateKeyWarning')}</span></div>
      <textarea readonly spellcheck="false">${escapeHtml(creator.privateKey)}</textarea>
      <div class="credential-modal__actions">
        <button class="outline-button" type="button" data-copy-credential="privateKey">${t('instances.copyPrivateKey')}</button>
        <button class="outline-button" type="button" data-save-private-key>${t('instances.savePrivateKey')}</button>
      </div>
    </div>` : usesPublicKey(creator.authMethod) ? `<p class="credential-external-note">${t('instances.externalKeyHint')}</p>` : ''}

    ${creator.copied ? `<p class="credential-toast" role="status">${t('instances.copied')}</p>` : ''}
    ${creator.savedPath ? `<p class="credential-toast" role="status">${t('instances.savedTo', { path: creator.savedPath })}</p>` : ''}
    <div class="credential-modal__footer"><button class="credential-primary" type="button" data-finish-instance-creator>${t('instances.done')}</button></div>
  </div>`;
}

function renderCreator(creator, t) {
  if (!creator) return '';
  return `<div class="credential-modal-backdrop" data-close-instance-creator>
    <section class="credential-modal" role="dialog" aria-modal="true" aria-labelledby="credential-modal-title" data-credential-modal>
      <header class="credential-modal__header">
        <div><span>SSH / 01</span><h3 id="credential-modal-title">${t(creator.phase === 'success' ? 'instances.deliveryTitle' : 'instances.createTitle')}</h3></div>
        <button class="icon-button" type="button" data-close-instance-creator aria-label="${t('instances.close')}">×</button>
      </header>
      ${creator.phase === 'success' ? renderSuccess(creator, t) : `<form data-instance-create-form>
        <div class="credential-modal__intro"><p class="credential-kicker">${t('instances.credentialIssue')}</p><p>${t('instances.createSubtitle')}</p></div>
        <div class="credential-form-grid">
          <label><span>${t('instances.instanceType')}</span><select data-instance-field="kind">
            <option value="linux" ${creator.kind === 'linux' ? 'selected' : ''}>${t('instances.virtualLinux')}</option>
            <option value="network" ${creator.kind === 'network' ? 'selected' : ''}>${t('instances.networkDevice')}</option>
          </select></label>
          <label><span>${t('instances.instanceName')}</span><input required maxlength="64" data-instance-field="name" value="${escapeHtml(creator.name)}" placeholder="${t('instances.namePlaceholder')}"></label>
          <label><span>${t('instances.username')}</span><input required maxlength="32" data-instance-field="username" value="${escapeHtml(creator.username)}" autocomplete="username"></label>
          <label><span>${t('instances.port')}</span><input inputmode="numeric" min="1024" max="65535" data-instance-field="port" value="${escapeHtml(creator.port)}" placeholder="${t('instances.autoPort')}"></label>
          <label class="credential-form-field--wide"><span>${t('instances.listenScope')}</span><select data-instance-field="host">
            <option value="127.0.0.1" ${creator.host === '127.0.0.1' ? 'selected' : ''}>${t('instances.localScope')}</option>
            <option value="0.0.0.0" ${creator.host === '0.0.0.0' ? 'selected' : ''}>${t('instances.lanScope')}</option>
          </select></label>
        </div>
        ${creator.host === '0.0.0.0' ? `<div class="network-access-warning" role="note">${icon('lock')}<div><strong>${t('instances.lanWarningTitle')}</strong><p>${t('instances.lanWarning')}</p></div></div>` : ''}

        <fieldset class="auth-selector"><legend>${t('instances.authMethod')}</legend>
          ${['password', 'publickey', 'both'].map((method) => `<label class="${creator.authMethod === method ? 'is-selected' : ''}"><input type="radio" name="authMethod" value="${method}" data-instance-field="authMethod" ${creator.authMethod === method ? 'checked' : ''}><span><strong>${authLabel(method, t)}</strong><small>${t(`instances.authHint.${method}`)}</small></span></label>`).join('')}
        </fieldset>

        <div class="credential-material-grid ${creator.authMethod === 'both' ? 'is-split' : ''}">
          ${usesPassword(creator.authMethod) ? `<section class="credential-material">
            <div class="credential-material__heading"><span>01</span><div><strong>${t('instances.password')}</strong><small>${t('instances.passwordHint')}</small></div></div>
            <label class="credential-secret-field"><input required data-instance-field="password" type="${creator.revealPassword ? 'text' : 'password'}" value="${escapeHtml(creator.password)}" autocomplete="new-password"><button type="button" data-toggle-instance-password>${t(creator.revealPassword ? 'instances.hide' : 'instances.reveal')}</button></label>
            <button class="outline-button" type="button" data-generate-password>${t('instances.generatePassword')}</button>
          </section>` : ''}
          ${usesPublicKey(creator.authMethod) ? `<section class="credential-material">
            <div class="credential-material__heading"><span>${creator.authMethod === 'both' ? '02' : '01'}</span><div><strong>${t('instances.publicKey')}</strong><small>${t('instances.publicKeyHint')}</small></div></div>
            <textarea required data-instance-field="authorizedKey" spellcheck="false" placeholder="${t('instances.publicKeyPlaceholder')}">${escapeHtml(creator.authorizedKey)}</textarea>
            <div class="credential-key-actions"><button class="outline-button" type="button" data-generate-key>${t('instances.generateKeyPair')}</button>${creator.fingerprint ? `<code>${escapeHtml(creator.fingerprint)}</code>` : ''}</div>
          </section>` : ''}
        </div>

        <label class="start-instance-check"><input type="checkbox" data-instance-field="startNow" ${creator.startNow ? 'checked' : ''}><span>${t('instances.startNow')}</span></label>
        <div class="credential-modal__footer">
          <button class="outline-button" type="button" data-close-instance-creator>${t('instances.cancel')}</button>
          <button class="credential-primary" type="submit" ${creator.submitting ? 'disabled' : ''}>${creator.submitting ? t('instances.creating') : t('instances.createInstance')}</button>
        </div>
      </form>`}
    </section>
  </div>`;
}

function renderAccessCopyRow(label, value, action, t, extraClass = '') {
  return `<div class="access-sheet__row ${extraClass}"><span>${label}</span><div><code>${escapeHtml(value)}</code><button type="button" data-copy-access="${action}">${t('instances.copy')}</button></div></div>`;
}

function renderCredentialViewer(viewer, t) {
  if (!viewer) return '';
  const access = viewer.access;
  const body = viewer.loading
    ? `<p class="access-sheet__loading">${t('instances.accessLoading')}</p>`
    : viewer.error
      ? `<p class="inline-error" role="alert">${escapeHtml(viewer.error)}</p>`
      : (() => {
        const connectionHost = access.host === '0.0.0.0' ? 'HOST_IP' : '127.0.0.1';
        const passwordCommand = `ssh -p ${access.port} ${access.username}@${connectionHost}`;
        const keyCommand = `ssh -i ${access.name}.pem -p ${access.port} ${access.username}@${connectionHost}`;
        return `<div class="access-sheet__body">
          <section class="access-sheet__commands">
            <span>${t('instances.connectionCommand')}</span>
            ${usesPassword(access.authMethod) ? renderAccessCopyRow(t('instances.passwordLogin'), passwordCommand, 'password-command', t) : ''}
            ${usesPublicKey(access.authMethod) ? renderAccessCopyRow(t('instances.keyLogin'), keyCommand, 'key-command', t) : ''}
            ${access.host === '0.0.0.0' ? `<p>${t('instances.hostIpHint')}</p>` : ''}
          </section>

          <div class="access-sheet__facts">
            ${renderAccessCopyRow(t('instances.listenAddress'), access.address, 'address', t)}
            ${renderAccessCopyRow(t('instances.username'), access.username, 'username', t)}
            <div class="access-sheet__row"><span>${t('instances.authMethod')}</span><strong>${authLabel(access.authMethod, t)}</strong></div>
          </div>

          ${usesPassword(access.authMethod) ? `<section class="access-secret-card">
            <div class="access-secret-card__heading"><div>${icon('lock')}<div><strong>${t('instances.passwordCredential')}</strong><p>${t('instances.passwordCredentialHint')}</p></div></div><button type="button" data-toggle-access-password>${t(viewer.revealPassword ? 'instances.hide' : 'instances.reveal')}</button></div>
            <div class="access-secret-card__value"><code>${viewer.revealPassword ? escapeHtml(access.password) : '••••••••••••'}</code><button type="button" data-copy-access="password">${t('instances.copy')}</button></div>
          </section>` : ''}

          ${usesPublicKey(access.authMethod) ? `<section class="access-key-section">
            <div class="access-key-section__heading"><div><strong>${t('instances.keyCredential')}</strong><p>${t('instances.keyCredentialHint', { count: access.publicKeys.length })}</p></div><span>${access.privateKeyManaged ? t('instances.privateKeyManaged') : t('instances.privateKeyExternal')}</span></div>
            ${access.publicKeys.map((key, index) => `<details class="access-public-key" ${index === 0 ? 'open' : ''}>
              <summary><span>${escapeHtml(key.algorithm)}</span><code>${escapeHtml(key.fingerprint)}</code></summary>
              <textarea readonly spellcheck="false">${escapeHtml(key.publicKey)}</textarea>
              <div><button class="outline-button" type="button" data-copy-access="public-key:${index}">${t('instances.copyPublicKey')}</button><button class="link-button" type="button" data-copy-access="fingerprint:${index}">${t('instances.copyFingerprint')}</button></div>
            </details>`).join('')}
            ${access.privateKeyManaged ? `<div class="managed-private-key"><div>${icon('shield')}<div><strong>${t('instances.managedPrivateKey')}</strong><p>${t('instances.managedPrivateKeyHint')}</p></div></div><button class="outline-button" type="button" data-export-instance-private-key>${t('instances.exportPrivateKey')}</button></div>` : `<p class="credential-external-note">${t('instances.externalPrivateKeyHint')}</p>`}
          </section>` : ''}

          ${viewer.copied ? `<p class="credential-toast" role="status">${t('instances.copied')}</p>` : ''}
          ${viewer.savedPath ? `<p class="credential-toast" role="status">${t('instances.savedTo', { path: viewer.savedPath })}</p>` : ''}
        </div>`;
      })();

  return `<div class="credential-modal-backdrop" data-close-credential-viewer>
    <section class="credential-modal access-sheet" role="dialog" aria-modal="true" aria-labelledby="access-sheet-title" data-credential-viewer>
      <header class="credential-modal__header">
        <div><span>SSH / ACCESS</span><h3 id="access-sheet-title">${t('instances.accessTitle')}</h3></div>
        <button class="icon-button" type="button" data-close-credential-viewer aria-label="${t('instances.close')}">×</button>
      </header>
      ${body}
      <footer class="credential-modal__footer access-sheet__footer"><button class="credential-primary" type="button" data-close-credential-viewer>${t('instances.done')}</button></footer>
    </section>
  </div>`;
}

function renderPortConflict(instance, state, t) {
  const diagnostic = state.portDiagnostics[instance.id] ?? {};
  const error = instance.lastError ?? {};
  const isEditing = state.portEditorInstanceId === instance.id;
  const isBusy = state.busyInstanceId === instance.id;
  const suggestedPort = diagnostic.suggestedPort ?? error.suggestedPort;
  const owner = diagnostic.owner;
  const ownerText = owner?.processName
    ? t('instances.portConflict.ownerProcess', { process: owner.processName, pid: owner.pid })
    : owner?.pid
      ? t('instances.portConflict.ownerPid', { pid: owner.pid })
      : t('instances.portConflict.ownerUnknown');
  const description = diagnostic.available
    ? t('instances.portConflict.availableNow', { address: instance.address })
    : `${ownerText}${suggestedPort ? ` ${t('instances.portConflict.suggestion', { port: suggestedPort })}` : ''}`;
  const technicalMessage = error.technicalMessage ?? error.message ?? `EADDRINUSE ${instance.address}`;

  return `<section class="instance-conflict-panel ${diagnostic.available ? 'is-available' : ''}" role="alert" aria-label="${t('instances.portConflict.title')}">
    <div class="instance-conflict-panel__mark">${icon(diagnostic.available ? 'check' : 'error')}</div>
    <div class="instance-conflict-panel__content">
      <div class="instance-conflict-panel__heading">
        <div><strong>${t(diagnostic.available ? 'instances.portConflict.availableTitle' : 'instances.portConflict.title')}</strong><code>${escapeHtml(instance.address)}</code></div>
        <span>${t('instances.portConflict.detected')}</span>
      </div>
      <p>${escapeHtml(description)}</p>
      ${isEditing ? `<form class="instance-port-editor" data-instance-port-form data-instance="${instance.id}">
        <label><span>${t('instances.listenScope')}</span><select data-endpoint-host>
          <option value="127.0.0.1" ${state.hostDraft === '127.0.0.1' ? 'selected' : ''}>${t('instances.localScope')}</option>
          <option value="0.0.0.0" ${state.hostDraft === '0.0.0.0' ? 'selected' : ''}>${t('instances.lanScope')}</option>
        </select></label>
        <label><span>${t('instances.portConflict.newPort')}</span><input data-port-editor-input inputmode="numeric" type="number" min="1024" max="65535" required value="${escapeHtml(state.portDraft)}"></label>
        <button class="outline-button" type="submit" ${isBusy ? 'disabled' : ''}>${t('instances.portConflict.saveAndStart')}</button>
        <button class="link-button" type="button" data-port-action="cancel-edit" data-instance="${instance.id}">${t('common.cancel')}</button>
      </form>` : `<div class="instance-conflict-panel__actions">
        ${!diagnostic.available ? `<button class="conflict-primary" type="button" data-port-action="repair" data-instance="${instance.id}" ${isBusy ? 'disabled' : ''}>${t('instances.portConflict.autoRepair')}</button>` : ''}
        <button type="button" data-port-action="retry" data-instance="${instance.id}" ${isBusy ? 'disabled' : ''}>${t('instances.portConflict.retry')}</button>
        <button type="button" data-port-action="edit" data-instance="${instance.id}" ${isBusy ? 'disabled' : ''}>${t('instances.portConflict.editPort')}</button>
      </div>`}
      ${isEditing && state.hostDraft === '0.0.0.0' ? `<div class="network-access-warning is-compact" role="note">${icon('lock')}<div><strong>${t('instances.lanWarningTitle')}</strong><p>${t('instances.lanWarning')}</p></div></div>` : ''}
      <details class="instance-conflict-details">
        <summary>${t('instances.portConflict.technicalDetails')}</summary>
        <pre>${escapeHtml(technicalMessage)}</pre>
      </details>
    </div>
  </section>`;
}

function renderEndpointEditor(instance, state, t) {
  return `<section class="instance-endpoint-panel" aria-label="${t('instances.endpointSettings')}">
    <div class="instance-endpoint-panel__heading"><div>${icon('settings')}<div><strong>${t('instances.endpointSettings')}</strong><p>${t('instances.endpointSettingsHint')}</p></div></div><code>${escapeHtml(instance.address)}</code></div>
    <form class="instance-port-editor" data-instance-port-form data-instance="${instance.id}">
      <label><span>${t('instances.listenScope')}</span><select data-endpoint-host>
        <option value="127.0.0.1" ${state.hostDraft === '127.0.0.1' ? 'selected' : ''}>${t('instances.localScope')}</option>
        <option value="0.0.0.0" ${state.hostDraft === '0.0.0.0' ? 'selected' : ''}>${t('instances.lanScope')}</option>
      </select></label>
      <label><span>${t('instances.port')}</span><input data-port-editor-input inputmode="numeric" type="number" min="1024" max="65535" required value="${escapeHtml(state.portDraft)}"></label>
      <button class="outline-button" type="submit" ${state.busyInstanceId === instance.id ? 'disabled' : ''}>${t('instances.saveAndStart')}</button>
      <button class="link-button" type="button" data-port-action="cancel-edit" data-instance="${instance.id}">${t('common.cancel')}</button>
    </form>
    ${state.hostDraft === '0.0.0.0' ? `<div class="network-access-warning is-compact" role="note">${icon('lock')}<div><strong>${t('instances.lanWarningTitle')}</strong><p>${t('instances.lanWarning')}</p></div></div>` : ''}
  </section>`;
}

export function renderInstances(state) {
  const t = i18next.t.bind(i18next);
  return `
    <div class="page">
      <div class="page-heading">
        <div><h2>${t('instances.title')}</h2><p>${t('instances.subtitle')}</p></div>
        <div class="instance-create-actions">
          <select data-instance-kind aria-label="${t('instances.newType')}"><option value="linux">${t('instances.virtualLinux')}</option><option value="network">${t('instances.networkDevice')}</option></select>
          <button class="link-button" type="button" data-new-instance>${icon('plus')}${t('instances.newInstance')}</button>
        </div>
      </div>

      ${state.error ? `<p class="inline-error" role="alert">${escapeHtml(state.error)}</p>` : ''}

      <section class="data-card" aria-label="${t('instances.tableLabel')}">
        <div class="data-table data-table--instances" role="table">
          <div class="data-table__head" role="row">
            <span>${t('common.name')}</span><span>${t('instances.listenAddress')}</span><span>${t('common.profile')}</span><span>${t('common.status')}</span><span>${t('common.actions')}</span>
          </div>
          ${state.loading ? `<p class="empty-state">${t('instances.starting')}</p>` : state.instances.length ? state.instances.map((instance) => {
            const hasPortConflict = instance.lastError?.code === 'PORT_IN_USE';
            const isBusy = state.busyInstanceId === instance.id;
            const isEditingEndpoint = state.portEditorInstanceId === instance.id;
            return `<div class="data-table__row ${hasPortConflict ? 'has-port-conflict' : ''}" role="row">
              <strong data-label="${t('common.name')}">${escapeHtml(instance.name)}<small>${escapeHtml(instance.username)} · ${authLabel(instance.authMethod, t)}${instance.authorizedKeyCount ? ` · ${t('instances.keyCount', { count: instance.authorizedKeyCount })}` : ''}</small></strong>
              <span class="instance-listen-address" data-label="${t('instances.listenAddress')}"><code>${escapeHtml(instance.address)}</code><small class="${instance.host === '0.0.0.0' ? 'is-lan' : ''}">${t(instance.host === '0.0.0.0' ? 'instances.lanBadge' : 'instances.localBadge')}</small></span>
              <span data-label="${t('common.profile')}">${t(instance.kind === 'network' ? 'instances.networkProfile' : 'instances.linuxProfile')}</span>
              <span data-label="${t('common.status')}" class="instance-status ${instance.running ? 'is-running' : ''} ${hasPortConflict ? 'is-conflict' : ''}"><i></i>${t(hasPortConflict ? 'instances.portConflict.status' : instance.running ? 'common.running' : 'common.stopped')}</span>
              <span class="row-actions" data-label="${t('common.actions')}">
                <button type="button" data-instance-action="access" data-instance="${instance.id}">${t('instances.accessInfo')}</button>
                ${instance.running && instance.embeddedTerminalAvailable !== false ? `<button type="button" data-instance-action="terminal" data-instance="${instance.id}">${t('common.terminal')}</button>` : instance.running ? `<span class="terminal-unavailable" title="${t('instances.terminalUnavailable')}">${t('instances.externalOnly')}</span>` : ''}
                ${hasPortConflict ? `<button type="button" data-port-action="repair" data-instance="${instance.id}" ${isBusy ? 'disabled' : ''}>${t(isBusy ? 'instances.portConflict.repairing' : 'instances.portConflict.repair')}</button>` : `<button type="button" data-instance-action="toggle" data-instance="${instance.id}" ${isBusy ? 'disabled' : ''}>${t(isBusy ? 'instances.portConflict.starting' : instance.running ? 'common.stop' : 'common.start')}</button>`}
                ${!instance.running && !hasPortConflict ? `<button type="button" data-port-action="edit" data-instance="${instance.id}" ${isBusy ? 'disabled' : ''}>${t('instances.listenSettings')}</button>` : ''}
                <button class="is-danger" type="button" data-instance-action="delete" data-instance="${instance.id}" ${isBusy ? 'disabled' : ''}>${t('common.delete')}</button>
              </span>
            </div>${hasPortConflict ? renderPortConflict(instance, state, t) : isEditingEndpoint ? renderEndpointEditor(instance, state, t) : ''}`;
          }).join('') : `<p class="empty-state">${t('instances.noInstances')}</p>`}
        </div>
      </section>

      <div class="connection-note ${state.instances.some((instance) => instance.host === '0.0.0.0') ? 'has-lan-access' : ''}">
        <span>${icon('lock')}</span>
        <div><strong>${t(state.instances.some((instance) => instance.host === '0.0.0.0') ? 'instances.lanAccessEnabled' : 'instances.localOnly')}</strong><p>${t(state.instances.some((instance) => instance.host === '0.0.0.0') ? 'instances.connectFromLan' : 'instances.connectExternally', { command: `<code>ssh -p PORT USER@${state.instances.some((instance) => instance.host === '0.0.0.0') ? 'HOST_IP' : '127.0.0.1'}</code>` })}</p></div>
      </div>
    </div>
    ${renderCreator(state.instanceCreator, t)}
    ${renderCredentialViewer(state.credentialViewer, t)}
  `;
}
