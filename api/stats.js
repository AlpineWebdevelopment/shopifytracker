module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') { res.status(405).end(); return; }

  try {
    // Optional date-range filter: ?from=2025-01-01&to=2025-01-31
    const { from, to } = req.query || {};
    let rangeFilter = '';
    if (from) rangeFilter += `&created_at=gte.${encodeURIComponent(from)}`;
    if (to) {
      // include the full "to" day by bumping to next day
      const toDate = new Date(to);
      toDate.setDate(toDate.getDate() + 1);
      rangeFilter += `&created_at=lt.${encodeURIComponent(toDate.toISOString().slice(0, 10))}`;
    }

    const r = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/events?select=data,created_at&order=created_at.desc&limit=5000${rangeFilter}`,
      {
        headers: {
          'apikey':        process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        },
      }
    );
    const rows = await r.json();
    const events          = rows.map(row => ({ ...row.data, _db_ts: row.created_at }));
    const pageViews       = events.filter(e => e.event === 'page_view');
    const atcEvents       = events.filter(e => e.event === 'add_to_cart');
    const checkoutEvents  = events.filter(e => e.event === 'checkout_started');
    const purchaseEvents  = events.filter(e => e.event === 'purchase');

    const byProduct = {};
    const byDate    = {};
    const byDevice  = {};
    const byBrowser = {};
    const bySource  = {};
    const sessions  = new Set();
    const visitors  = new Set();
    let   atcCount  = atcEvents.length;

    // seed ATC counts per product from dedicated add_to_cart events
    for (const e of atcEvents) {
      const pid = String(e.product_id || 'unknown');
      if (!byProduct[pid]) byProduct[pid] = { title: e.product_title, vendor: e.product_vendor, views: 0, atc: 0, sessions: new Set() };
      byProduct[pid].atc++;
    }

    for (const e of pageViews) {
      const pid = String(e.product_id || 'unknown');
      if (!byProduct[pid]) byProduct[pid] = { title: e.product_title, vendor: e.product_vendor, views: 0, atc: 0, sessions: new Set() };
      byProduct[pid].views++;
      byProduct[pid].sessions.add(e.session_id);

      const day = (e.ts || e._db_ts || '').slice(0, 10);
      byDate[day] = (byDate[day] || 0) + 1;

      if (e.device)  byDevice[e.device]    = (byDevice[e.device]   || 0) + 1;
      if (e.browser) byBrowser[e.browser]  = (byBrowser[e.browser] || 0) + 1;

      const src = e.utm_source || e.referrer_source || 'direct';
      bySource[src] = (bySource[src] || 0) + 1;

      if (e.session_id) sessions.add(e.session_id);
      if (e.visitor_id) visitors.add(e.visitor_id);
    }

    const byProductArr = Object.entries(byProduct).map(([id, v]) => ({
      product_id: id, title: v.title, vendor: v.vendor,
      views: v.views, atc: v.atc, sessions: v.sessions.size,
      atc_rate: v.views ? ((v.atc / v.views) * 100).toFixed(1) + '%' : '0%',
    })).sort((a, b) => b.views - a.views);

    // funnel conversion rates
    const pvCount  = pageViews.length;
    const atcRate  = pvCount  ? ((atcEvents.length  / pvCount)              * 100).toFixed(1) + '%' : '0%';
    const coRate   = atcEvents.length ? ((checkoutEvents.length / atcEvents.length) * 100).toFixed(1) + '%' : '0%';
    const purRate  = checkoutEvents.length ? ((purchaseEvents.length / checkoutEvents.length) * 100).toFixed(1) + '%' : '0%';

    res.status(200).json({
      total_events:       events.length,
      total_pageviews:    pvCount,
      unique_sessions:    sessions.size,
      unique_visitors:    visitors.size,
      add_to_cart:        atcEvents.length,
      checkout_started:   checkoutEvents.length,
      purchases:          purchaseEvents.length,
      funnel: {
        pdp_to_atc:        atcRate,
        atc_to_checkout:   coRate,
        checkout_to_purchase: purRate,
      },
      by_product:         byProductArr,
      by_date:            byDate,
      by_device:          byDevice,
      by_browser:         byBrowser,
      by_source:          bySource,
    });
  } catch (err) {
    console.error('[stats]', err.message);
    res.status(500).json({ error: err.message });
  }
};
