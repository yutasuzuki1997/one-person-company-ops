#!/usr/bin/env node
'use strict';

/**
 * 各連携先のトークン設定状況と接続テストを実行する
 * Usage: node scripts/check-integrations.js
 */

const fs = require('fs');
const path = require('path');

async function main() {
  const settingsPath = path.join(__dirname, '..', 'app-settings.json');
  const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const integrations = s.integrations || {};

  console.log('=== OneCompanyOps Integration Check ===\n');

  // Notion
  const notion = require('../lib/notion-connector');
  const notionAccounts = integrations.notion || [];
  const notionToken = s.notionToken || notionAccounts[0]?.token;
  console.log('🧭 Notion');
  if (!notionToken) {
    console.log('  ✗ 未設定 — app-settings.json に notionToken か integrations.notion[].token を入れてください');
  } else {
    const r = await notion.testConnection(notionToken);
    console.log(r.success ? `  ✓ OK — user: ${r.user}` : `  ✗ 接続エラー: ${r.error}`);
  }

  // Google Sheets
  const sheets = require('../lib/sheets-connector');
  const sheetsAccounts = integrations.googleSheets || [];
  const sheetsCred = s.googleCredentials || sheetsAccounts[0]?.credentials;
  console.log('\n📊 Google Sheets');
  if (!sheetsCred) {
    console.log('  ✗ 未設定 — integrations.googleSheets[].credentials にサービスアカウントJSONを入れてください');
  } else {
    const r = await sheets.testConnection(sheetsCred);
    console.log(r.success ? `  ✓ OK — ${r.email}` : `  ✗ 接続エラー: ${r.error}`);
  }

  // Google Calendar
  const calendar = require('../lib/calendar-connector');
  const calendarAccounts = integrations.googleCalendar || [];
  console.log('\n📅 Google Calendar');
  if (calendarAccounts.length === 0) {
    console.log('  ✗ 未設定 — integrations.googleCalendar[] に OAuth creds を入れてください');
  } else {
    for (const acc of calendarAccounts) {
      if (!acc.credentials) { console.log(`  ✗ ${acc.label}: credentials 欠落`); continue; }
      const r = await calendar.testConnection(acc.credentials);
      console.log(r.success ? `  ✓ ${acc.label}: OK` : `  ✗ ${acc.label}: ${r.error}`);
    }
  }

  console.log('\n=== Summary ===');
  console.log('未設定の項目は Dashboard > Settings から GUI で設定することも推奨');
}

main().catch((e) => { console.error('[check] fatal:', e.message); process.exit(1); });
