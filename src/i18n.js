import i18next from 'i18next';
import zhCN from './locales/zh-CN.json';
import enUS from './locales/en-US.json';

const STORAGE_KEY = 'monolithssh.language';
const supportedLanguages = ['zh-CN', 'en-US'];

function normalizeLanguage(language) {
  return String(language || '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}

function getInitialLanguage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (supportedLanguages.includes(stored)) return stored;
  } catch {
    // Storage can be unavailable in hardened renderer environments.
  }
  return normalizeLanguage(navigator.language);
}

i18next.init({
  lng: getInitialLanguage(),
  fallbackLng: 'en-US',
  supportedLngs: supportedLanguages,
  initImmediate: false,
  interpolation: { escapeValue: false },
  resources: {
    'zh-CN': {
      translation: zhCN.translation
    },
    'en-US': {
      translation: enUS.translation
    }
  }
});

document.documentElement.lang = i18next.language;

export async function setAppLanguage(language) {
  const normalized = normalizeLanguage(language);
  await i18next.changeLanguage(normalized);
  document.documentElement.lang = normalized;
  try {
    localStorage.setItem(STORAGE_KEY, normalized);
  } catch {
    // Language still applies for the current session when storage is unavailable.
  }
}

export default i18next;
