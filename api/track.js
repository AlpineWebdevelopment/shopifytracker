module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    event._server_ts = new Date().toISOString();
    event._ip = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim();

    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/events`, {
      method:  'POST',
      headers: {
        'apikey':        process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify({ data: event }),
    });

    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`Supabase error ${r.status}: ${txt}`);
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[track]', err.message);
    res.status(400).json({ ok: false, error: err.message });
  }
};
