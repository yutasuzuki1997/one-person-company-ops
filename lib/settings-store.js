const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  providerMode: 'anthropic_api', // 'anthropic_api' | 'tmux'
  anthropicApiKey: '',
  model: 'claude-sonnet-4-6',
};

const MODEL_OPTIONS = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
];

function parseSettingsRaw(raw) {
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    anthropicApiKey: typeof raw.anthropicApiKey === 'string' ? raw.anthropicApiKey : '',
  };
}

function loadSettings(dataDir) {
  const file = path.join(dataDir, 'app-settings.json');
  if (!fs.existsSync(file)) {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    return parseSettingsRaw(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(dataDir, s) {
  const file = path.join(dataDir, 'app-settings.json');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        providerMode: s.providerMode,
        anthropicApiKey: s.anthropicApiKey || '',
        model: s.model || DEFAULT_SETTINGS.model,
      },
      null,
      2
    )
  );
}

/** 会社ごとの設定（DATA_DIR/companies/{id}/company-settings.json） */
function loadCompanySettings(companyDir) {
  const file = path.join(companyDir, 'company-settings.json');
  if (!fs.existsSync(file)) {
    const legacy = path.join(companyDir, '..', '..', 'app-settings.json');
    if (fs.existsSync(legacy)) {
      try {
        return parseSettingsRaw(JSON.parse(fs.readFileSync(legacy, 'utf8')));
      } catch {
        /* fallthrough */
      }
    }
    return { ...DEFAULT_SETTINGS };
  }
  try {
    return parseSettingsRaw(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveCompanySettings(companyDir, s) {
  fs.mkdirSync(companyDir, { recursive: true });
  fs.writeFileSync(
    path.join(companyDir, 'company-settings.json'),
    JSON.stringify(
      {
        providerMode: s.providerMode,
        anthropicApiKey: s.anthropicApiKey || '',
        model: s.model || DEFAULT_SETTINGS.model,
      },
      null,
      2
    )
  );
}

function publicSettings(s) {
  return {
    providerMode: s.providerMode,
    model: s.model,
    hasApiKey: !!(s.anthropicApiKey && s.anthropicApiKey.trim()),
    modelOptions: MODEL_OPTIONS,
  };
}

module.exports = {
  loadSettings,
  saveSettings,
  loadCompanySettings,
  saveCompanySettings,
  publicSettings,
  DEFAULT_SETTINGS,
  MODEL_OPTIONS,
};
