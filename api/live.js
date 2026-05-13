module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') { res.status(405).end(); return; }

  try {
    const now   = new Date();
    const ago5  = new Date(now - 5  * 60 * 1000).toISOString();
    const ago10 = new Date(now - 10 * 60 * 1000).toISOString();
    const ago30 = new Date(now - 30 * 60 * 1000).toISOString();

    // fetch last 30 min of events — enough for all windows
    const r = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/events?select=data,created_at&created_at=gte.${ago30}&order=created_at.desc`,
      {
        headers: {
          'apikey':        process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        },
      }
    );
    const rows   = await r.json();
    const events = rows.map(row => ({ ...row.data, _db_ts: row.created_at }));

    // helpers
    function since(events, iso) {
      return events.filter(e => (e._db_ts || e.ts || '') >= iso);
    }

    const last5  = since(events, ago5);
    const last10 = since(events, ago10);

    // visitors in last 5 min = unique visitor_ids from any event
    const visitors5 = new Set(last5.map(e => e.visitor_id).filter(Boolean));

    // active sessions last 5 min
    const sessions5 = new Set(last5.map(e => e.session_id).filter(Boolean));

    // ATC last 10 min
    const atc10 = last10.filter(e => e.event === 'add_to_cart');

    // checkouts last 10 min
    const co10 = last10.filter(e => e.event === 'checkout_started');

    // page views last 10 min
    const pv10 = last10.filter(e => e.event === 'page_view');

    // recent visitor list (last 30 min, deduplicated by session)
    const seenSess = new Set();
    const recentVisitors = events
      .filter(e => e.event === 'page_view' && e.session_id && !seenSess.has(e.session_id) && seenSess.add(e.session_id))
      .slice(0, 20)
      .map(e => ({
        session_id:    e.session_id,
        device:        e.device,
        browser:       e.browser,
        referrer_source: e.referrer_source,
        landing_url:   e.landing_url,
        product_title: e.product_title,
        ts:            e._db_ts || e.ts,
      }));

    res.status(200).json({
      visitors_last_5m:   visitors5.size,
      sessions_last_5m:   sessions5.size,
      pageviews_last_10m: pv10.length,
      atc_last_10m:       atc10.length,
      checkouts_last_10m: co10.length,
      recent_visitors:    recentVisitors,
    });
  } catch (err) {
    console.error('[live]', err.message);
    res.status(500).json({ error: err.message });
  }
};
