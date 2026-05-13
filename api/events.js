module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') { res.status(405).end(); return; }

  try {
    const r = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/events?select=data,created_at&order=created_at.desc&limit=200`,
      {
        headers: {
          'apikey':        process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        },
      }
    );
    const rows = await r.json();
    // unwrap: each row is { data: {...}, created_at: '...' }
    const events = rows.map(row => ({ ...row.data, _db_ts: row.created_at }));
    res.status(200).json(events);
  } catch (err) {
    console.error('[events]', err.message);
    res.status(500).json({ error: err.message });
  }
};
