'use strict';

const { google } = require('googleapis');

function getAuth(credentials) {
  const creds = typeof credentials === 'string' ? JSON.parse(credentials) : credentials;
  if (!creds || !creds.client_email) throw new Error('サービスアカウントJSONが不正です');
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
  });
}

async function testConnection(credentials, propertyId) {
  try {
    const auth = getAuth(credentials);
    const analyticsData = google.analyticsdata({ version: 'v1beta', auth });
    await analyticsData.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate: 'today', endDate: 'today' }],
        metrics: [{ name: 'activeUsers' }],
        limit: 1,
      },
    });
    return { success: true, ok: true };
  } catch (e) {
    return { success: false, ok: false, error: e.message };
  }
}

async function runReport(credentials, propertyId, { dateRange, metrics, dimensions }) {
  try {
    const auth = getAuth(credentials);
    const analyticsData = google.analyticsdata({ version: 'v1beta', auth });
    const requestBody = {
      dateRanges: [dateRange || { startDate: '7daysAgo', endDate: 'today' }],
      metrics: (typeof metrics === 'string' ? JSON.parse(metrics) : metrics) || [{ name: 'sessions' }],
    };
    if (dimensions) {
      requestBody.dimensions = typeof dimensions === 'string' ? JSON.parse(dimensions) : dimensions;
    }
    const resp = await analyticsData.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody,
    });
    const rows = (resp.data.rows || []).map((r) => ({
      dimensions: (r.dimensionValues || []).map((d) => d.value),
      metrics: (r.metricValues || []).map((m) => m.value),
    }));
    return {
      success: true,
      data: {
        rows,
        rowCount: resp.data.rowCount || 0,
        dimensionHeaders: (resp.data.dimensionHeaders || []).map((h) => h.name),
        metricHeaders: (resp.data.metricHeaders || []).map((h) => h.name),
      },
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function getRealtimeData(credentials, propertyId) {
  try {
    const auth = getAuth(credentials);
    const analyticsData = google.analyticsdata({ version: 'v1beta', auth });
    const resp = await analyticsData.properties.runRealtimeReport({
      property: `properties/${propertyId}`,
      requestBody: {
        metrics: [{ name: 'activeUsers' }],
        dimensions: [{ name: 'unifiedScreenName' }],
      },
    });
    const rows = (resp.data.rows || []).map((r) => ({
      dimensions: (r.dimensionValues || []).map((d) => d.value),
      metrics: (r.metricValues || []).map((m) => m.value),
    }));
    return { success: true, data: { rows, rowCount: resp.data.rowCount || 0 } };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = {
  testConnection,
  runReport,
  getRealtimeData,
};
