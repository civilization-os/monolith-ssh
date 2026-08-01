import { icon } from '../ui/icons.js';
import i18next from '../i18n.js';

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function renderProfileTabs(active, t) {
  return `<div class="tabs tabs--three" role="tablist">
    <button class="${active === 'rules' ? 'is-active' : ''}" type="button" role="tab" data-profile-section="rules">${t('profiles.commandRules')}</button>
    <button class="${active === 'builtins' ? 'is-active' : ''}" type="button" role="tab" data-profile-section="builtins">${t('profiles.linuxBuiltins')}</button>
    <button class="${active === 'variables' ? 'is-active' : ''}" type="button" role="tab" data-profile-section="variables">${t('profiles.variableManager')}</button>
  </div>`;
}

function renderInteractionStep(step, index, rule, t, variables) {
  const types = [
    ['input', t('profiles.stepTypes.input')],
    ['verify_variable', t('profiles.stepTypes.verifyVariable')],
    ['verify_choice', t('profiles.stepTypes.verifyChoice')],
    [rule.kind === 'network' ? 'set_mode' : 'set_user', t(rule.kind === 'network' ? 'profiles.stepTypes.setMode' : 'profiles.stepTypes.setUser')],
    ['output', t('profiles.stepTypes.output')],
    ['finish', t('profiles.stepTypes.finish')]
  ];
  const networkModes = [
    ['user_exec', t('profiles.modes.userExec')],
    ['privileged_exec', t('profiles.modes.privilegedExec')],
    ['global_config', t('profiles.modes.globalConfig')],
    ['interface_config', t('profiles.modes.interfaceConfig')]
  ];
  let fields = '';
  if (step.type === 'input') fields = `
    <label><span>${t('profiles.inputPrompt')}</span><input data-step-field="prompt" value="${escapeHtml(step.prompt)}" /></label>
    <label><span>${t('profiles.saveInputAs')}</span><input class="mono-input" data-step-field="saveAs" value="${escapeHtml(step.saveAs)}" placeholder="input" /></label>
    <label class="compact-check"><input type="checkbox" data-step-field="secret" ${step.secret ? 'checked' : ''} /><span>${t('profiles.secretInput')}</span></label>`;
  if (step.type === 'verify_variable') fields = `
    <label><span>${t('profiles.inputReference')}</span><input class="mono-input" data-step-field="input" value="${escapeHtml(step.input)}" /></label>
    <label><span>${t('profiles.verificationVariable')}</span><select data-step-field="variable">${variables.map((variable) => `<option value="${escapeHtml(variable.name)}" ${step.variable === variable.name ? 'selected' : ''}>${escapeHtml(variable.name)}</option>`).join('')}</select></label>
    <label class="interaction-step-field--wide"><span>${t('profiles.failureOutput')}</span><textarea data-step-field="failureOutput">${escapeHtml(step.failureOutput)}</textarea></label>`;
  if (step.type === 'verify_choice') fields = `
    <label><span>${t('profiles.inputReference')}</span><input class="mono-input" data-step-field="input" value="${escapeHtml(step.input)}" /></label>
    <label><span>${t('profiles.allowedChoices')}</span><input class="mono-input" data-step-field="choices" value="${escapeHtml((step.choices ?? []).join(', '))}" placeholder="yes, y" /></label>
    <label class="compact-check"><input type="checkbox" data-step-field="caseSensitive" ${step.caseSensitive ? 'checked' : ''} /><span>${t('profiles.caseSensitive')}</span></label>
    <label class="interaction-step-field--wide"><span>${t('profiles.failureOutput')}</span><textarea data-step-field="failureOutput">${escapeHtml(step.failureOutput)}</textarea></label>`;
  if (step.type === 'set_user') fields = `<label><span>${t('profiles.targetUser')}</span><input class="mono-input" data-step-field="target" value="${escapeHtml(step.target)}" /></label>`;
  if (step.type === 'set_mode') fields = `<label><span>${t('profiles.targetMode')}</span><select data-step-field="target">${networkModes.map(([value, label]) => `<option value="${value}" ${step.target === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`;
  if (step.type === 'output') fields = `<label class="interaction-step-field--wide"><span>${t('profiles.output')}</span><textarea data-step-field="text" placeholder="${t('profiles.outputPlaceholder')}">${escapeHtml(step.text)}</textarea></label>`;
  if (step.type === 'finish') fields = `<p class="interaction-finish-hint">${t('profiles.finishHint')}</p>`;
  const previousIsFinish = rule.steps[index - 1]?.type === 'finish';
  const nextIsFinish = rule.steps[index + 1]?.type === 'finish';
  const lockFinish = step.type === 'finish';

  return `<article class="interaction-step" data-step-id="${escapeHtml(step.id)}">
    <div class="interaction-step__rail"><span>${String(index + 1).padStart(2, '0')}</span><i></i></div>
    <div class="interaction-step__body">
      <div class="interaction-step__heading">
        <label><span>${t('profiles.stepType')}</span><select data-step-field="type">${types.map(([value, label]) => `<option value="${value}" ${step.type === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <div class="interaction-step__actions">
          <button type="button" data-move-interaction-step="${escapeHtml(step.id)}" data-direction="up" ${index === 0 || lockFinish || previousIsFinish ? 'disabled' : ''} aria-label="${t('profiles.moveStepUp')}">↑</button>
          <button type="button" data-move-interaction-step="${escapeHtml(step.id)}" data-direction="down" ${index === rule.steps.length - 1 || lockFinish || nextIsFinish ? 'disabled' : ''} aria-label="${t('profiles.moveStepDown')}">↓</button>
          <button class="icon-button is-danger" type="button" data-delete-interaction-step="${escapeHtml(step.id)}" aria-label="${t('profiles.deleteStep')}">${icon('trash')}</button>
        </div>
      </div>
      <div class="interaction-step__fields">${fields}</div>
    </div>
  </article>`;
}

function renderRule(rule, index, t, variables) {
  const networkModes = [
    ['any', t('profiles.modes.any')],
    ['user_exec', t('profiles.modes.userExec')],
    ['privileged_exec', t('profiles.modes.privilegedExec')],
    ['global_config', t('profiles.modes.globalConfig')],
    ['interface_config', t('profiles.modes.interfaceConfig')]
  ];

  return `
    <article class="rule-card command-rule-card" data-rule-id="${escapeHtml(rule.id)}">
      <div class="command-rule-card__heading">
        <div><span class="rule-index">${String(index + 1).padStart(2, '0')}</span><span class="rule-scope-badge">${t(rule.scope === 'instance' ? 'profiles.deviceLevel' : 'profiles.typeLevel')}</span><strong>${escapeHtml(rule.pattern || t('profiles.untitledRule'))}</strong></div>
        <div class="command-rule-card__actions">
          <label class="rule-enabled"><input type="checkbox" data-rule-field="enabled" ${rule.enabled ? 'checked' : ''} /><span>${t('profiles.enabled')}</span></label>
          <button class="icon-button" type="button" aria-label="${t('profiles.deleteRule')}" data-delete-rule="${escapeHtml(rule.id)}">${icon('trash')}</button>
        </div>
      </div>

      <div class="command-rule-grid">
        <label><span>${t('profiles.matchType')}</span><select data-rule-field="matchType"><option value="exact" ${rule.matchType === 'exact' ? 'selected' : ''}>${t('profiles.exactMatch')}</option><option value="command" ${rule.matchType === 'command' ? 'selected' : ''}>${t('profiles.commandMatch')}</option><option value="regex" ${rule.matchType === 'regex' ? 'selected' : ''}>${t('profiles.regexMatch')}</option></select></label>
        <label><span>${t('profiles.commandMode')}</span>${rule.kind === 'network'
          ? `<select data-rule-field="mode">${networkModes.map(([value, label]) => `<option value="${value}" ${rule.mode === value ? 'selected' : ''}>${label}</option>`).join('')}</select>`
          : `<input value="${t('profiles.modes.shell')}" disabled />`}</label>
        <label class="command-rule-pattern"><span>${t('profiles.pattern')}</span><input class="mono-input" data-rule-field="pattern" value="${escapeHtml(rule.pattern)}" placeholder="${t('profiles.patternPlaceholder')}" /></label>
      </div>

      <div class="rule-behavior-switch"><span>${t('profiles.ruleBehavior')}</span><label><input type="radio" name="behavior-${escapeHtml(rule.id)}" data-rule-field="behavior" value="output" ${rule.behavior !== 'interactive' ? 'checked' : ''} />${t('profiles.outputBehavior')}</label><label><input type="radio" name="behavior-${escapeHtml(rule.id)}" data-rule-field="behavior" value="interactive" ${rule.behavior === 'interactive' ? 'checked' : ''} />${t('profiles.interactiveBehavior')}</label></div>

      ${rule.behavior === 'interactive' ? `
        <div class="interaction-builder">
          <div class="interaction-builder__heading"><div><strong>${t('profiles.interactionFlow')}</strong><small>${t('profiles.interactionFlowHint')}</small></div><div><label class="compact-check"><input type="checkbox" data-rule-field="requiresArgument" ${rule.requiresArgument ? 'checked' : ''} /><span>${t('profiles.requireArgument')}</span></label><button type="button" data-add-interaction-step="${escapeHtml(rule.id)}">${icon('plus')}${t('profiles.addStep')}</button></div></div>
          <div class="interaction-step-list">${(rule.steps ?? []).map((step, stepIndex) => renderInteractionStep(step, stepIndex, rule, t, variables)).join('')}</div>
        </div>` : `<label class="command-rule-output"><span>${t('profiles.output')}</span><textarea data-rule-field="output" placeholder="${t('profiles.outputPlaceholder')}">${escapeHtml(rule.output)}</textarea></label>`}
      <p class="rule-variables">${t('profiles.variables')} <code>{{hostname}}</code> <code>{{instance}}</code> <code>{{user}}</code> <code>{{command}}</code> <code>{{arg1}}</code>${variables.slice(0, 4).map((variable) => ` <code>{{${escapeHtml(variable.name)}}}</code>`).join('')}</p>
    </article>
  `;
}

function renderLinuxBuiltins(state, t) {
  const active = state.linuxBuiltins.filter((builtin) => builtin.enabled);
  const removed = state.linuxBuiltins.filter((builtin) => !builtin.enabled);

  return `
    <div class="profile-workspace">
      <aside class="profile-tree">
        ${renderProfileTabs('builtins', t)}

        <div class="profile-kind-list">
          <p class="profile-kind-list__label">${t('profiles.builtinCatalog')}</p>
          <div class="profile-kind-item is-selected builtin-summary-item">
            ${icon('server')}<span><strong>${t('profiles.linuxShell')}</strong><small>${t('profiles.builtinSummary', { active: active.length, total: state.linuxBuiltins.length })}</small></span>
          </div>
          ${removed.length ? `<div class="removed-command-summary"><strong>${t('profiles.removedCount', { count: removed.length })}</strong><p>${removed.map((builtin) => `<code>${escapeHtml(builtin.command)}</code>`).join('')}</p></div>` : ''}
        </div>

        <div class="profile-live-note">${icon('broadcast')}<div><strong>${t('profiles.builtinLiveTitle')}</strong><p>${t('profiles.builtinLiveHint')}</p></div></div>
      </aside>

      <section class="profile-editor">
        <div class="editor-toolbar">
          <div><h2>${t('profiles.linuxBuiltins')}</h2><span class="live-badge"><i></i>${t('profiles.live')}</span></div>
          <div><button class="restore-builtins" type="button" data-restore-builtins ${removed.length ? '' : 'disabled'}>${icon('undo')}${t('profiles.restoreBuiltins')}</button></div>
        </div>

        <div class="editor-content">
          ${state.error ? `<p class="inline-error" role="alert">${escapeHtml(state.error)}</p>` : ''}
          <div class="rules-heading"><div><h3>${t('profiles.activeBuiltins')}</h3><p>${t('profiles.builtinCatalogHint')}</p></div><span class="builtin-count">${t('profiles.activeCount', { count: active.length })}</span></div>

          ${active.length ? `<div class="builtin-command-grid">${active.map((builtin) => `
            <article class="builtin-command-card">
              <div class="builtin-command-card__heading"><code>${escapeHtml(builtin.command)}</code><button class="icon-button is-danger" type="button" data-delete-builtin="${escapeHtml(builtin.id)}" aria-label="${t('profiles.deleteBuiltin', { command: builtin.command })}">${icon('trash')}</button></div>
              <p>${t(`profiles.builtinDescriptions.${builtin.id}`)}</p>
              <code class="builtin-usage">${escapeHtml(builtin.usage)}</code>
            </article>
          `).join('')}</div>` : `<div class="profile-empty">${icon('command')}<h3>${t('profiles.noBuiltins')}</h3><p>${t('profiles.noBuiltinsHint')}</p><button class="outline-button" type="button" data-restore-builtins>${icon('undo')}${t('profiles.restoreBuiltins')}</button></div>`}
        </div>
      </section>
    </div>
  `;
}

function renderVariables(state, t) {
  const selectedInstance = state.instances.find((instance) => instance.id === state.profileInstanceId)
    ?? state.instances.find((instance) => instance.kind === state.profileKind)
    ?? state.instances[0];
  const runtimeValue = t('profiles.runtimeValue');
  const systemVariables = [
    { name: 'hostname', value: selectedInstance?.name ?? runtimeValue, description: t('profiles.systemVariableDescriptions.hostname') },
    { name: 'instance', value: selectedInstance?.name ?? runtimeValue, description: t('profiles.systemVariableDescriptions.instance') },
    { name: 'user', value: selectedInstance?.username ?? runtimeValue, description: t('profiles.systemVariableDescriptions.user') },
    { name: 'command', value: runtimeValue, description: t('profiles.systemVariableDescriptions.command') },
    { name: 'arg1', value: runtimeValue, description: t('profiles.systemVariableDescriptions.arg1') },
    { name: 'input', value: runtimeValue, description: t('profiles.systemVariableDescriptions.input') }
  ];
  const statusText = state.variablesDirty
    ? t('profiles.unsaved')
    : state.variablesApplied ? t('profiles.applied') : t('profiles.live');

  return `
    <div class="profile-workspace">
      <aside class="profile-tree">
        ${renderProfileTabs('variables', t)}
        <div class="profile-kind-list variable-summary-list">
          <p class="profile-kind-list__label">${t('profiles.variableCatalog')}</p>
          <div class="profile-kind-item is-selected builtin-summary-item">${icon('command')}<span><strong>${t('profiles.systemVariables')}</strong><small>${t('profiles.variableCount', { count: systemVariables.length })}</small></span></div>
          <div class="profile-kind-item builtin-summary-item">${icon('folder')}<span><strong>${t('profiles.customVariables')}</strong><small>${t('profiles.variableCount', { count: state.variables.length })}</small></span></div>
        </div>
        <div class="profile-live-note">${icon('broadcast')}<div><strong>${t('profiles.variableLiveTitle')}</strong><p>${t('profiles.variableLiveHint')}</p></div></div>
      </aside>

      <section class="profile-editor">
        <div class="editor-toolbar">
          <div><h2>${t('profiles.variableManager')}</h2><span class="live-badge ${state.variablesDirty ? 'is-dirty' : ''}" data-variable-live-state><i></i>${statusText}</span></div>
          <div><button type="button" data-revert-variables>${icon('undo')}${t('profiles.revert')}</button><button class="save-action" type="button" data-save-variables>${t('profiles.saveAndApply')}</button></div>
        </div>
        <div class="editor-content">
          ${state.error ? `<p class="inline-error" role="alert">${escapeHtml(state.error)}</p>` : ''}
          <section class="variable-section">
            <div class="rules-heading"><div><h3>${t('profiles.systemVariables')}</h3><p>${t('profiles.systemVariablesHint')}</p></div><span class="builtin-count">${t('profiles.readOnly')}</span></div>
            <div class="system-variable-grid">${systemVariables.map((variable) => `
              <article class="system-variable-card"><div><code>{{${variable.name}}}</code><span>${t('profiles.systemBadge')}</span></div><strong>${escapeHtml(variable.value)}</strong><p>${variable.description}</p></article>
            `).join('')}</div>
          </section>

          <div class="section-divider"></div>
          <section class="variable-section">
            <div class="rules-heading"><div><h3>${t('profiles.customVariables')}</h3><p>${t('profiles.customVariablesHint')}</p></div><button class="outline-button" type="button" data-add-variable>${icon('plus')}${t('profiles.addVariable')}</button></div>
            ${state.variables.length ? `<form class="custom-variable-list" data-variable-form autocomplete="off">${state.variables.map((variable) => {
              const revealed = state.revealedVariableIds.has(variable.id);
              return `<article class="custom-variable-card" data-variable-id="${escapeHtml(variable.id)}">
                <div class="custom-variable-card__index">${String(state.variables.indexOf(variable) + 1).padStart(2, '0')}</div>
                <label><span>${t('profiles.variableName')}</span><input class="mono-input" data-variable-field="name" value="${escapeHtml(variable.name)}" placeholder="API_TOKEN" autocomplete="off" /></label>
                <label class="variable-value-field"><span>${t('profiles.variableValue')}</span><input class="mono-input" type="${variable.secret && !revealed ? 'password' : 'text'}" data-variable-field="value" value="${escapeHtml(variable.value)}" autocomplete="new-password" /><button type="button" data-reveal-variable="${escapeHtml(variable.id)}">${revealed ? t('profiles.hide') : t('profiles.reveal')}</button></label>
                <label><span>${t('profiles.variableDescription')}</span><input data-variable-field="description" value="${escapeHtml(variable.description)}" placeholder="${t('profiles.variableDescriptionPlaceholder')}" autocomplete="off" /></label>
                <label class="compact-check variable-secret-check"><input type="checkbox" data-variable-field="secret" ${variable.secret ? 'checked' : ''} /><span>${t('profiles.secretVariable')}</span></label>
                <button class="icon-button is-danger" type="button" data-delete-variable="${escapeHtml(variable.id)}" aria-label="${t('profiles.deleteVariable', { name: variable.name || t('profiles.unnamedVariable') })}">${icon('trash')}</button>
              </article>`;
            }).join('')}</form>` : `<div class="profile-empty">${icon('folder')}<h3>${t('profiles.noVariables')}</h3><p>${t('profiles.noVariablesHint')}</p><button class="outline-button" type="button" data-add-variable>${icon('plus')}${t('profiles.addVariable')}</button></div>`}
          </section>
        </div>
      </section>
    </div>`;
}

export function renderProfiles(state) {
  const t = i18next.t.bind(i18next);
  if (state.profileSection === 'builtins') return renderLinuxBuiltins(state, t);
  if (state.profileSection === 'variables') return renderVariables(state, t);
  const targetInstance = state.instances.find((instance) => instance.id === state.profileInstanceId) ?? null;
  const scope = state.profileScope === 'instance' && targetInstance ? 'instance' : 'type';
  const kind = scope === 'instance' ? targetInstance.kind : state.profileKind;
  const rules = state.commandRules.filter((rule) => rule.scope === scope
    && (scope === 'instance' ? rule.instanceId === targetInstance.id : rule.kind === kind));
  const networkCount = state.commandRules.filter((rule) => rule.scope === 'type' && rule.kind === 'network').length;
  const linuxCount = state.commandRules.filter((rule) => rule.scope === 'type' && rule.kind === 'linux').length;
  const title = scope === 'instance'
    ? t('profiles.deviceRulesFor', { device: targetInstance.name })
    : t('profiles.typeRulesFor', { profile: t(kind === 'network' ? 'profiles.networkDevice' : 'profiles.linuxShell') });
  const rulesHint = t(scope === 'instance' ? 'profiles.deviceRulesHint' : 'profiles.typeRulesHint');
  const statusText = state.profileDirty
    ? t('profiles.unsaved')
    : state.profileApplied ? t('profiles.applied') : t('profiles.live');

  return `
    <div class="profile-workspace">
      <aside class="profile-tree">
        ${renderProfileTabs('rules', t)}

        <div class="profile-kind-list">
          <p class="profile-kind-list__label">${t('profiles.typeLevel')}</p>
          <button class="profile-kind-item ${scope === 'type' && kind === 'network' ? 'is-selected' : ''}" type="button" data-profile-scope="type" data-profile-kind="network">
            ${icon('cable')}<span><strong>${t('profiles.networkDevice')}</strong><small>${t('profiles.customRuleCount', { count: networkCount })}</small></span>
          </button>
          <button class="profile-kind-item ${scope === 'type' && kind === 'linux' ? 'is-selected' : ''}" type="button" data-profile-scope="type" data-profile-kind="linux">
            ${icon('server')}<span><strong>${t('profiles.linuxShell')}</strong><small>${t('profiles.customRuleCount', { count: linuxCount })}</small></span>
          </button>

          <p class="profile-kind-list__label profile-kind-list__label--devices">${t('profiles.deviceLevel')}</p>
          ${state.instances.map((instance) => {
            const count = state.commandRules.filter((rule) => rule.scope === 'instance' && rule.instanceId === instance.id).length;
            return `<button class="profile-kind-item ${scope === 'instance' && targetInstance?.id === instance.id ? 'is-selected' : ''}" type="button" data-profile-scope="instance" data-profile-instance="${escapeHtml(instance.id)}">
              ${icon(instance.kind === 'network' ? 'cable' : 'server')}<span><strong>${escapeHtml(instance.name)}</strong><small>${t('profiles.deviceRuleMeta', { type: t(instance.kind === 'network' ? 'profiles.networkDevice' : 'profiles.linuxShell'), count })}</small></span>
            </button>`;
          }).join('')}
        </div>

        <div class="profile-live-note">${icon('broadcast')}<div><strong>${t('profiles.hotReloadTitle')}</strong><p>${t('profiles.hotReloadHint')}</p></div></div>
      </aside>

      <section class="profile-editor">
        <div class="editor-toolbar">
          <div><h2>${title}</h2><span class="live-badge ${state.profileDirty ? 'is-dirty' : ''}" data-profile-live-state><i></i>${statusText}</span></div>
          <div><button type="button" data-revert-rules>${icon('undo')}${t('profiles.revert')}</button><button class="save-action" type="button" data-save-rules>${t('profiles.saveAndApply')}</button></div>
        </div>

        <div class="editor-content">
          ${state.error ? `<p class="inline-error" role="alert">${escapeHtml(state.error)}</p>` : ''}
          <div class="rules-heading"><div><h3>${t('profiles.interactionRules')}</h3><p>${rulesHint}</p></div><div class="rules-heading__actions">${kind === 'linux' ? `<button type="button" data-add-su-template>${t('profiles.addSuTemplate')}</button>` : ''}<button class="outline-button" type="button" data-add-rule>${icon('plus')}${t('profiles.addCommand')}</button></div></div>

          ${rules.length
            ? rules.map((rule, index) => renderRule(rule, index, t, state.variables)).join('')
            : `<div class="profile-empty">${icon('command')}<h3>${t('profiles.noRules')}</h3><p>${t('profiles.noRulesHint')}</p><button class="outline-button" type="button" data-add-rule>${icon('plus')}${t('profiles.addCommand')}</button></div>`}
        </div>
      </section>
    </div>
  `;
}
