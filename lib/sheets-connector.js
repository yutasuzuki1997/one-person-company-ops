'use strict';

const { google } = require('googleapis');

function getAuth(credentials) {
  const creds = typeof credentials === 'string' ? JSON.parse(credentials) : credentials;
  if (!creds || !creds.client_email) throw new Error('サービスアカウントJSONが不正です');
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function testConnection(credentials) {
  try {
    const auth = getAuth(credentials);
    const client = await auth.getClient();
    const email = client.email || (typeof credentials === 'object' ? credentials.client_email : '');
    return { success: true, ok: true, email };
  } catch (e) {
    return { success: false, ok: false, error: e.message };
  }
}

async function listSheets(credentials, spreadsheetId) {
  try {
    const auth = getAuth(credentials);
    const sheets = google.sheets({ version: 'v4', auth });
    const resp = await sheets.spreadsheets.get({ spreadsheetId });
    const result = (resp.data.sheets || []).map((s) => ({
      id: s.properties.sheetId,
      title: s.properties.title,
    }));
    return { success: true, sheets: result };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function readRange(credentials, spreadsheetId, range) {
  try {
    const auth = getAuth(credentials);
    const sheets = google.sheets({ version: 'v4', auth });
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    return { success: true, data: resp.data.values || [] };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function writeRange(credentials, spreadsheetId, range, values) {
  try {
    const auth = getAuth(credentials);
    const sheets = google.sheets({ version: 'v4', auth });
    const vals = typeof values === 'string' ? JSON.parse(values) : values;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: vals },
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function appendRows(credentials, spreadsheetId, range, values) {
  try {
    const auth = getAuth(credentials);
    const sheets = google.sheets({ version: 'v4', auth });
    const vals = typeof values === 'string' ? JSON.parse(values) : values;
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: vals },
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = {
  testConnection,
  listSheets,
  readRange,
  writeRange,
  appendRows,
};
