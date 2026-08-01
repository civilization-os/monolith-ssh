let activeSelect = null;
let listenersReady = false;

function selectedOption(select) {
  return select.options[select.selectedIndex] ?? select.options[0] ?? null;
}

function closeSelect(component, restoreFocus = false) {
  if (!component) return;
  component.root.classList.remove('is-open', 'is-upward');
  component.trigger.setAttribute('aria-expanded', 'false');
  component.menu.hidden = true;
  component.menu.classList.remove('is-portal', 'is-upward');
  component.menu.style.removeProperty('top');
  component.menu.style.removeProperty('bottom');
  component.menu.style.removeProperty('left');
  component.menu.style.removeProperty('min-width');
  if (component.root.isConnected) component.root.append(component.menu);
  else component.menu.remove();
  if (restoreFocus && component.trigger.isConnected) component.trigger.focus();
  if (activeSelect === component) activeSelect = null;
}

function positionMenu(component) {
  const rect = component.trigger.getBoundingClientRect();
  const menu = component.menu;
  menu.style.left = `${rect.left}px`;
  menu.style.top = `${rect.bottom}px`;
  menu.style.minWidth = `${rect.width}px`;
  menu.hidden = false;

  const measured = menu.getBoundingClientRect();
  const opensUpward = window.innerHeight - rect.bottom < measured.height && rect.top > measured.height;
  component.root.classList.toggle('is-upward', opensUpward);
  menu.classList.toggle('is-upward', opensUpward);
  if (opensUpward) menu.style.top = `${rect.top - measured.height}px`;

  const positioned = menu.getBoundingClientRect();
  if (positioned.right > window.innerWidth) {
    menu.style.left = `${Math.max(0, window.innerWidth - positioned.width)}px`;
  }
}

function openSelect(component) {
  if (activeSelect && activeSelect !== component) closeSelect(activeSelect);
  const selected = component.menu.querySelector('[aria-selected="true"]');
  component.root.classList.add('is-open');
  component.trigger.setAttribute('aria-expanded', 'true');
  component.menu.classList.add('is-portal');
  document.body.append(component.menu);
  positionMenu(component);
  activeSelect = component;
  requestAnimationFrame(() => selected?.focus({ preventScroll: true }));
}

function syncSelect(component) {
  const option = selectedOption(component.select);
  component.value.textContent = option?.textContent ?? '';
  component.trigger.disabled = component.select.disabled;
  for (const item of component.menu.querySelectorAll('[role="option"]')) {
    const isSelected = item.dataset.value === component.select.value;
    item.setAttribute('aria-selected', String(isSelected));
    item.classList.toggle('is-selected', isSelected);
  }
}

function selectValue(component, value) {
  if (component.select.value === value) {
    closeSelect(component, true);
    return;
  }
  component.select.value = value;
  syncSelect(component);
  closeSelect(component, true);
  component.select.dispatchEvent(new Event('change', { bubbles: true }));
}

function moveOption(component, direction) {
  const items = [...component.menu.querySelectorAll('[role="option"]:not([disabled])')];
  if (!items.length) return;
  const current = items.indexOf(document.activeElement);
  const fallback = items.findIndex((item) => item.getAttribute('aria-selected') === 'true');
  const origin = current >= 0 ? current : Math.max(fallback, 0);
  const next = Math.min(items.length - 1, Math.max(0, origin + direction));
  items[next].focus({ preventScroll: true });
}

function installGlobalListeners() {
  if (listenersReady) return;
  listenersReady = true;
  document.addEventListener('pointerdown', (event) => {
    if (activeSelect && !activeSelect.root.contains(event.target) && !activeSelect.menu.contains(event.target)) closeSelect(activeSelect);
  });
  window.addEventListener('blur', () => closeSelect(activeSelect));
  window.addEventListener('resize', () => closeSelect(activeSelect));
  document.addEventListener('scroll', (event) => {
    if (!activeSelect || activeSelect.menu.contains(event.target)) return;
    requestAnimationFrame(() => {
      if (activeSelect?.root.isConnected) positionMenu(activeSelect);
    });
  }, true);
}

function enhanceSelect(select, index) {
  if (select.dataset.customSelectReady === 'true') return;
  const parentLabel = select.closest('label');
  select.dataset.customSelectReady = 'true';
  select.classList.add('custom-select__native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');

  const root = document.createElement('div');
  root.className = 'custom-select';
  const menuId = `custom-select-${index}-${crypto.randomUUID()}`;
  select.before(root);
  root.append(select);

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'custom-select__trigger';
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', menuId);
  trigger.setAttribute('aria-label', select.getAttribute('aria-label') || parentLabel?.querySelector(':scope > span')?.textContent || 'Select');
  trigger.innerHTML = '<span class="custom-select__value"></span><i class="custom-select__chevron" aria-hidden="true"></i>';

  const menu = document.createElement('div');
  menu.id = menuId;
  menu.className = 'custom-select__menu';
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;
  for (const option of select.options) {
    const item = document.createElement('button');
    item.type = 'button';
    item.tabIndex = -1;
    item.className = 'custom-select__option';
    item.setAttribute('role', 'option');
    item.dataset.value = option.value;
    item.disabled = option.disabled;
    item.innerHTML = '<i aria-hidden="true"></i><span></span>';
    item.querySelector('span').textContent = option.textContent;
    menu.append(item);
  }

  root.append(trigger, menu);
  const component = { root, select, trigger, menu, value: trigger.querySelector('.custom-select__value') };
  root._customSelect = component;
  syncSelect(component);

  trigger.addEventListener('click', () => component.root.classList.contains('is-open') ? closeSelect(component) : openSelect(component));
  parentLabel?.addEventListener('click', (event) => {
    if (root.contains(event.target)) return;
    event.preventDefault();
    trigger.click();
  });
  menu.addEventListener('click', (event) => {
    const item = event.target.closest('[role="option"]');
    if (item && !item.disabled) selectValue(component, item.dataset.value);
  });
  const handleKeydown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSelect(component, true);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!root.classList.contains('is-open')) openSelect(component);
      else moveOption(component, event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const items = [...menu.querySelectorAll('[role="option"]:not([disabled])')];
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus({ preventScroll: true });
    }
  };
  root.addEventListener('keydown', handleKeydown);
  menu.addEventListener('keydown', handleKeydown);
  select.addEventListener('change', () => syncSelect(component));
}

export function enhanceCustomSelects(root = document) {
  installGlobalListeners();
  if (activeSelect && !activeSelect.root.isConnected) activeSelect = null;
  document.querySelectorAll('body > .custom-select__menu').forEach((menu) => {
    if (menu !== activeSelect?.menu) menu.remove();
  });
  root.querySelectorAll('select').forEach(enhanceSelect);
}
