/**
 * ============================================================
 *  SHOPIFY PDP TRACKER — Collector Server
 *  severinnhq/shopifytracker
 *
 *  Run:  node server.js
 *  Stores all events in data/events.json (appended, one JSON
 *  object per line — NDJSON format).
 * ============================================================
 */

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

// ─── Config ─────────────────────────────────────────────────────────────────
const PORT      = 3333;
const DATA_DIR  = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'events.json');

// Domains allowed to POST (add your Shopify store domain here)
// '*' = accept from any origin (fine for local / first setup)
const ALLOWED_ORIGINS = ['*'];
// ─────────────────────────────────────────────────────────────────────────────

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Helpers ──────────────────────────────────────────────────────────────────
function originAllowed(origin) {
  if (ALLOWED_ORIGINS.includes('*')) return true;
  return ALLOWED_ORIGINS.some(o => origin && origin.includes(o));
}

function setCORSHeaders(res, origin) {
  const allow = originAllowed(origin) ? (origin || '*') : 'null';
  res.setHeader('Access-Control-Allow-Origin',  allow);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 50000) reject(new Error('payload too large')); });
    req.on('end',  () => resolve(body));
    req.on('error', reject);
  });
}

function appendEvent(obj) {
  const line = JSON.stringify(obj) + '\n';
  fs.appendFileSync(DATA_FILE, line, 'utf8');
}

function loadEvents() {
  if (!fs.existsSync(DATA_FILE)) return [];
  const raw = fs.readFileSync(DATA_FILE, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}
// ─────────────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const origin  = req.headers['origin'] || '';
  const parsedUrl = url.parse(req.url);

  setCORSHeaders(res, origin);

  // ── Preflight ──
  if (req.method === 'OPTIONS') {
    res.writeHead(204); res.end(); return;
  }

  // ── POST /track — receive event ──
  if (req.method === 'POST' && parsedUrl.pathname === '/track') {
    try {
      const body = await readBody(req);
      const event = JSON.parse(body);

      // Enrich with server-side data
      event._server_ts  = new Date().toISOString();
      event._ip         = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

      appendEvent(event);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      console.error('[tracker] bad payload:', err.message);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  // ── GET /events — return events as JSON (for dashboard) ──
  if (req.method === 'GET' && parsedUrl.pathname === '/events') {
    const events = loadEvents();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(events));
    return;
  }

  // ── GET /stats — aggregated stats endpoint ──
  if (req.method === 'GET' && parsedUrl.pathname === '/stats') {
    const events    = loadEvents();
    const pageViews = events.filter(e => e.event === 'page_view');

    const byProduct = {};
    const byDate    = {};
    const byDevice  = { desktop: 0, mobile: 0, tablet: 0 };
    const byBrowser = {};
    const bySource  = {};
    const byCountry = {};
    const sessions  = new Set();
    const visitors  = new Set();
    let   atcCount  = 0;

    for (const e of pageViews) {
      // product rollup
      const pid = String(e.product_id || 'unknown');
      if (!byProduct[pid]) byProduct[pid] = { title: e.product_title, views: 0, atc: 0, sessions: new Set() };
      byProduct[pid].views++;
      if (e.added_to_cart) { byProduct[pid].atc++; atcCount++; }
      byProduct[pid].sessions.add(e.session_id);

      // date rollup
      const day = (e.ts || e._server_ts || '').slice(0, 10);
      byDate[day] = (byDate[day] || 0) + 1;

      // device
      if (e.device) byDevice[e.device] = (byDevice[e.device] || 0) + 1;

      // browser
      if (e.browser) byBrowser[e.browser] = (byBrowser[e.browser] || 0) + 1;

      // source
      const src = e.utm_source || e.referrer_source || 'direct';
      bySource[src] = (bySource[src] || 0) + 1;

      // sessions + visitors
      if (e.session_id) sessions.add(e.session_id);
      if (e.visitor_id) visitors.add(e.visitor_id);
    }

    // Serialise sets
    const productArr = Object.entries(byProduct).map(([id, v]) => ({
      product_id: id, title: v.title, views: v.views,
      atc: v.atc, sessions: v.sessions.size,
      atc_rate: v.views ? ((v.atc / v.views) * 100).toFixed(1) + '%' : '0%'
    })).sort((a, b) => b.views - a.views);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      total_events:   events.length,
      total_pageviews: pageViews.length,
      unique_sessions: sessions.size,
      unique_visitors: visitors.size,
      add_to_cart:    atcCount,
      by_product:     productArr,
      by_date:        byDate,
      by_device:      byDevice,
      by_browser:     byBrowser,
      by_source:      bySource
    }));
    return;
  }

  // ── GET / — serve dashboard ──
  if (req.method === 'GET' && (parsedUrl.pathname === '/' || parsedUrl.pathname === '/dashboard')) {
    const dashPath = path.join(__dirname, 'dashboard.html');
    if (fs.existsSync(dashPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(dashPath, 'utf8'));
    } else {
      res.writeHead(404); res.end('dashboard.html not found');
    }
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ✅  Shopify PDP Tracker running');
  console.log(`  📡  Collector  → http://localhost:${PORT}/track`);
  console.log(`  📊  Dashboard  → http://localhost:${PORT}/`);
  console.log(`  📁  Data file  → ${DATA_FILE}`);
  console.log('');
});
