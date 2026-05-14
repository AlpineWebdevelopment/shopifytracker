module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') { res.status(405).end(); return; }

  try {
    const now    = new Date();
    const ago2s  = new Date(now - 2  *      1000).toISOString();
    const ago5   = new Date(now - 5  * 60 * 1000).toISOString();
    const ago10  = new Date(now - 10 * 60 * 1000).toISOString();
    const ago30  = new Date(now - 30 * 60 * 1000).toISOString();

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
    const includeInternal = req.query.internal === '1';
    const events = rows.map(row => ({ ...row.data, _db_ts: row.created_at })).filter(e => includeInternal || !e._internal);

    function since(list, iso) {
      return list.filter(e => (e._db_ts || e.ts || '') >= iso);
    }

    const live  = since(events, ago2s);
    const last5 = since(events, ago5);
    const last10 = since(events, ago10);

    // live (last 2s)
    const visitorsLive   = new Set(live.map(e => e.visitor_id).filter(Boolean));
    const atcLive        = live.filter(e => e.event === 'add_to_cart');
    const checkoutsLive  = live.filter(e => e.event === 'checkout_started');

    // windows
    const visitors5m     = new Set(last5.map(e => e.visitor_id).filter(Boolean));
    const atc10m         = last10.filter(e => e.event === 'add_to_cart');
    const checkouts10m   = last10.filter(e => e.event === 'checkout_started');

    // recent visitor list (last 30 min, deduplicated by session)
    const seenSess = new Set();
    const recentVisitors = events
      .filter(e => e.event === 'page_view' && e.session_id && !seenSess.has(e.session_id) && seenSess.add(e.session_id))
      .slice(0, 20)
      .map(e => ({
        session_id:      e.session_id,
        device:          e.device,
        browser:         e.browser,
        referrer_source: e.referrer_source,
        landing_url:     e.landing_url,
        product_title:   e.product_title,
        ts:              e._db_ts || e.ts,
        country:         e.country      || '',
        country_code:    e.country_code || '',
        city:            e.city         || '',
        region:          e.region       || '',
        flag:            e.flag         || '🌐',
        _internal:       e._internal    || false,
      }));

    res.status(200).json({
      visitors_live:      visitorsLive.size,
      visitors_last_5m:   visitors5m.size,
      atc_live:           atcLive.length,
      atc_last_10m:       atc10m.length,
      checkouts_live:     checkoutsLive.length,
      checkouts_last_10m: checkouts10m.length,
      recent_visitors:    recentVisitors,
    });
  } catch (err) {
    console.error('[live]', err.message);
    res.status(500).json({ error: err.message });
  }
};
