module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const pwd = process.env.DASHBOARD_PASSWORD;

  // No password set → open access
  if (!pwd) return res.status(200).json({ required: false });

  if (req.method === 'GET') {
    return res.status(200).json({ required: true });
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    return res.status(200).json({ ok: body.password === pwd });
  }

  res.status(405).end();
};
