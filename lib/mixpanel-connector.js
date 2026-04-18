async function testConnection(projectId, username, secret) {
  try {
    const credentials = Buffer.from(`${username}:${secret}`).toString('base64');
    const response = await fetch(
      `https://data.mixpanel.com/api/2.0/export/?project_id=${projectId}&from_date=${new Date().toISOString().split('T')[0]}&to_date=${new Date().toISOString().split('T')[0]}`,
      { headers: { 'Authorization': `Basic ${credentials}` } }
    );
    if (response.ok || response.status === 400) return { success: true };
    return { success: false, error: `HTTP ${response.status}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function queryEvents(projectId, username, secret, { fromDate, toDate, eventNames }) {
  try {
    const credentials = Buffer.from(`${username}:${secret}`).toString('base64');
    const params = new URLSearchParams({
      project_id: projectId,
      from_date: fromDate || new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0],
      to_date: toDate || new Date().toISOString().split('T')[0],
    });
    if (eventNames) params.append('event', JSON.stringify(eventNames));
    const response = await fetch(
      `https://data.mixpanel.com/api/2.0/export/?${params}`,
      { headers: { 'Authorization': `Basic ${credentials}` } }
    );
    const text = await response.text();
    const events = text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    return { success: true, data: events };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = { testConnection, queryEvents };
