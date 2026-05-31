module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') { res.status(405).end(); return; }

  try {
    const { from, to, internal, page: pageFilter } = req.query || {};

    // Date range filter
    let rangeFilter = '';
    if (from) rangeFilter += `&created_at=gte.${encodeURIComponent(from)}`;
    if (to) {
      const toDate = new Date(to);
      toDate.setDate(toDate.getDate() + 1);
      rangeFilter += `&created_at=lt.${encodeURIComponent(toDate.toISOString().slice(0, 10))}`;
    }

    const r = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/events?select=data,created_at&order=created_at.desc&limit=5000${rangeFilter}`,
      { headers: { 'apikey': process.env.SUPABASE_ANON_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}` } }
    );
    const rows = await r.json();
    const includeInternal = internal === '1';
    const allEvents = rows.map(row => ({ ...row.data, _db_ts: row.created_at })).filter(e => includeInternal || !e._internal);

    // ── by_url: always computed from ALL events (so the pages panel always shows full list) ──
    const urlMap = {};
    const allPageViews = allEvents.filter(e => e.event === 'page_view');
    const allExits     = allEvents.filter(e => e.event === 'page_exit');

    for (const e of allPageViews) {
      const u = e.landing_url || 'unknown';
      if (!urlMap[u]) urlMap[u] = { views: 0, sessions: new Set(), tos: [], scroll: [] };
      urlMap[u].views++;
      if (e.session_id) urlMap[u].sessions.add(e.session_id);
    }
    for (const e of allExits) {
      const u = e.landing_url || 'unknown';
      if (!urlMap[u]) urlMap[u] = { views: 0, sessions: new Set(), tos: [], scroll: [] };
      if (e.time_on_page_s != null) urlMap[u].tos.push(Number(e.time_on_page_s));
      if (e.scroll_depth   != null) urlMap[u].scroll.push(Number(e.scroll_depth));
    }

    const avgArr = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

    const byUrl = Object.entries(urlMap).map(([url, v]) => {
      let domain = '';
      try { domain = new URL(url).hostname.replace('www.', ''); } catch (_) {}
      let path = url;
      try { const u = new URL(url); path = u.pathname + (u.search || ''); } catch (_) {}
      return {
        url,
        domain,
        path,
        views:      v.views,
        sessions:   v.sessions.size,
        avg_time_s: avgArr(v.tos),
        avg_scroll: avgArr(v.scroll),
      };
    }).sort((a, b) => b.views - a.views);

    // ── Apply page filter for all main stats ──
    const events = pageFilter
      ? allEvents.filter(e => e.landing_url && e.landing_url === pageFilter)
      : allEvents;

    const pageViews      = events.filter(e => e.event === 'page_view');
    const atcEvents      = events.filter(e => e.event === 'add_to_cart');
    const checkoutEvents = events.filter(e => e.event === 'checkout_started');
    const purchaseEvents = events.filter(e => e.event === 'purchase');
    const exitEvents     = events.filter(e => e.event === 'page_exit');

    const byProduct = {};
    const byDate    = {};
    const byDevice  = {};
    const byBrowser = {};
    const bySource  = {};
    const sessions  = new Set();
    const visitors  = new Set();

    for (const e of atcEvents) {
      const pid = String(e.product_id || 'unknown');
      if (!byProduct[pid]) byProduct[pid] = { title: e.product_title, vendor: e.product_vendor, views: 0, atc: 0, sessions: new Set(), tos: [], scroll: [] };
      byProduct[pid].atc++;
    }

    for (const e of pageViews) {
      const pid = String(e.product_id || 'unknown');
      if (!byProduct[pid]) byProduct[pid] = { title: e.product_title, vendor: e.product_vendor, views: 0, atc: 0, sessions: new Set(), tos: [], scroll: [] };
      byProduct[pid].views++;
      byProduct[pid].sessions.add(e.session_id);

      const day = (e.ts || e._db_ts || '').slice(0, 10);
      byDate[day] = (byDate[day] || 0) + 1;

      if (e.device)  byDevice[e.device]   = (byDevice[e.device]   || 0) + 1;
      if (e.browser) byBrowser[e.browser] = (byBrowser[e.browser] || 0) + 1;

      const src = e.utm_source || e.referrer_source || 'direct';
      bySource[src] = (bySource[src] || 0) + 1;

      if (e.session_id) sessions.add(e.session_id);
      if (e.visitor_id) visitors.add(e.visitor_id);
    }

    for (const e of exitEvents) {
      const pid = String(e.product_id || 'unknown');
      if (!byProduct[pid]) byProduct[pid] = { title: e.product_title, vendor: e.product_vendor, views: 0, atc: 0, sessions: new Set(), tos: [], scroll: [] };
      if (e.time_on_page_s != null) byProduct[pid].tos.push(Number(e.time_on_page_s));
      if (e.scroll_depth   != null) byProduct[pid].scroll.push(Number(e.scroll_depth));
    }

    const scrollBuckets = { s0: 0, s25: 0, s50: 0, s75: 0 };
    for (const pid of Object.keys(byProduct)) {
      for (const d of byProduct[pid].scroll) {
        if      (d < 25) scrollBuckets.s0++;
        else if (d < 50) scrollBuckets.s25++;
        else if (d < 75) scrollBuckets.s50++;
        else             scrollBuckets.s75++;
      }
    }

    const byProductArr = Object.entries(byProduct).map(([id, v]) => {
      const sb = { s0: 0, s25: 0, s50: 0, s75: 0 };
      for (const d of v.scroll) {
        if      (d < 25) sb.s0++;
        else if (d < 50) sb.s25++;
        else if (d < 75) sb.s50++;
        else             sb.s75++;
      }
      return {
        product_id: id, title: v.title, vendor: v.vendor,
        views: v.views, atc: v.atc, sessions: v.sessions.size,
        atc_rate:    v.views ? ((v.atc / v.views) * 100).toFixed(1) + '%' : '0%',
        avg_time_s:  avgArr(v.tos),
        avg_scroll:  avgArr(v.scroll),
        scroll_exits: v.scroll.length,
        scroll_buckets: sb,
      };
    }).sort((a, b) => b.views - a.views);

    const pvCount = pageViews.length;
    const atcRate = pvCount            ? ((atcEvents.length      / pvCount)              * 100).toFixed(1) + '%' : '0%';
    const coRate  = atcEvents.length   ? ((checkoutEvents.length / atcEvents.length)     * 100).toFixed(1) + '%' : '0%';
    const purRate = checkoutEvents.length ? ((purchaseEvents.length / checkoutEvents.length) * 100).toFixed(1) + '%' : '0%';

    const visitorSessions = {};
    for (const e of pageViews) {
      if (!e.visitor_id || !e.session_id) continue;
      if (!visitorSessions[e.visitor_id]) visitorSessions[e.visitor_id] = new Set();
      visitorSessions[e.visitor_id].add(e.session_id);
    }
    let newVisitors = 0, returningVisitors = 0;
    for (const sess of Object.values(visitorSessions)) {
      if (sess.size > 1) returningVisitors++;
      else newVisitors++;
    }

    const atcSessions      = new Set(atcEvents.map(e => e.session_id).filter(Boolean));
    const checkoutSessions = new Set(checkoutEvents.map(e => e.session_id).filter(Boolean));
    let abandonedCart = 0;
    for (const s of atcSessions) { if (!checkoutSessions.has(s)) abandonedCart++; }

    res.status(200).json({
      total_events:       events.length,
      total_pageviews:    pvCount,
      unique_sessions:    sessions.size,
      unique_visitors:    visitors.size,
      new_visitors:       newVisitors,
      returning_visitors: returningVisitors,
      add_to_cart:        atcEvents.length,
      checkout_started:   checkoutEvents.length,
      purchases:          purchaseEvents.length,
      abandoned_cart:     abandonedCart,
      funnel: { pdp_to_atc: atcRate, atc_to_checkout: coRate, checkout_to_purchase: purRate },
      scroll_buckets: scrollBuckets,
      by_product: byProductArr,
      by_date:    byDate,
      by_device:  byDevice,
      by_browser: byBrowser,
      by_source:  bySource,
      by_url:     byUrl,
    });
  } catch (err) {
    console.error('[stats]', err.message);
    res.status(500).json({ error: err.message });
  }
};
