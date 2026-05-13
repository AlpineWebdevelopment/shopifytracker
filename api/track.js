const fs = require('fs');

const FILE = '/tmp/events.json';

function setCORS(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function loadEvents() {
  try {
    if (!fs.existsSync(FILE)) return [];
    const raw = fs.readFileSync(FILE, 'utf8').trim();
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveEvents(events) {
  fs.writeFileSync(FILE, JSON.stringify(events), 'utf8');
}

module.exports = function handler(req, res) {
  setCORS(req, res);

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    event._server_ts = new Date().toISOString();
    event._ip = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim();

    const events = loadEvents();
    events.unshift(event);
    if (events.length > 500) events.length = 500;
    saveEvents(events);

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[track]', err.message);
    res.status(400).json({ ok: false, error: err.message });
  }
};
