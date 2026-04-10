function detectResourceFromUrl(url) {
  if (!url) return null;

  // Google Sheets
  const sheetsMatch = url.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (sheetsMatch) {
    return { type: 'googleSheets', spreadsheetId: sheetsMatch[1] };
  }

  // Notion
  const notionMatch = url.match(/notion\.so\/.*?([a-f0-9]{32})/);
  if (notionMatch) {
    return { type: 'notion', databaseId: notionMatch[1] };
  }

  // GitHub
  const githubMatch = url.match(/github\.com\/([^/]+)\/([^/\s?#]+)/);
  if (githubMatch) {
    return { type: 'github', owner: githubMatch[1], repo: githubMatch[2].replace('.git', '') };
  }

  return null;
}

function getRequiredCredentials(type, settings) {
  const integrations = settings.integrations || {};
  switch (type) {
    case 'googleSheets':
      return (integrations.googleSheets || []).length > 0
        ? { available: true, accounts: integrations.googleSheets }
        : { available: false, message: 'Google Sheetsのサービスアカウントが必要です。設定画面から追加してください。' };
    case 'notion':
      return (integrations.notion || []).length > 0
        ? { available: true, accounts: integrations.notion }
        : { available: false, message: 'Notion Integration Tokenが必要です。設定画面から追加してください。' };
    case 'github':
      return settings.githubPersonalToken || settings.githubCompanyToken
        ? { available: true }
        : { available: false, message: 'GitHubトークンが必要です。設定画面から追加してください。' };
    case 'ga4':
      return (integrations.googleAnalytics || []).length > 0
        ? { available: true, accounts: integrations.googleAnalytics }
        : { available: false, message: 'GA4のサービスアカウントが必要です。設定画面から追加してください。' };
    case 'mixpanel':
      return (integrations.mixpanel || []).length > 0
        ? { available: true, accounts: integrations.mixpanel }
        : { available: false, message: 'Mixpanelの認証情報が必要です。設定画面から追加してください。' };
    default:
      return { available: false, message: '不明なリソースタイプです。' };
  }
}

module.exports = { detectResourceFromUrl, getRequiredCredentials };
