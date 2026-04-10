const { google } = require('googleapis');

function getAuth(credentials) {
  const creds = typeof credentials === 'string' ? JSON.parse(credentials) : credentials;
  const auth = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    'urn:ietf:wg:oauth:2.0:oob'
  );
  auth.setCredentials({
    access_token: creds.access_token,
    refresh_token: creds.refresh_token,
  });
  return auth;
}

function checkImportance(event) {
  if (event.description && event.description.includes('#重要')) return true;
  const executivePatterns = [/@backstage\.co\.jp$/, /ceo|cto|coo|founder|president/i];
  const attendeeEmails = (event.attendees || []).map((a) => a.email || '');
  if (attendeeEmails.some((email) => executivePatterns.some((p) => p.test(email)))) return true;
  return false;
}

async function listTodayEvents(credentials, calendarLabel) {
  try {
    const auth = getAuth(credentials);
    const calendar = google.calendar({ version: 'v3', auth });
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString();
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startOfDay,
      timeMax: endOfDay,
      singleEvents: true,
      orderBy: 'startTime',
    });
    const events = (response.data.items || []).map((event) => ({
      id: event.id,
      title: event.summary || '（タイトルなし）',
      start: event.start?.dateTime || event.start?.date,
      end: event.end?.dateTime || event.end?.date,
      description: event.description || '',
      attendees: (event.attendees || []).map((a) => a.email),
      location: event.location || '',
      calendarLabel: calendarLabel || 'default',
      isImportant: checkImportance(event),
    }));
    return { success: true, events };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function testConnection(credentials) {
  try {
    const auth = getAuth(credentials);
    const calendar = google.calendar({ version: 'v3', auth });
    await calendar.calendarList.list();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = { listTodayEvents, testConnection };
