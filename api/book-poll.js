const scenarioKeys = ['rapid', 'abundance', 'gentle', 'long', 'xrisk'];
const exposureKeys = ['income', 'liquidity', 'energy', 'community', 'ai_fluency'];

function store() {
  if (!globalThis.__bookPollResponses) {
    globalThis.__bookPollResponses = new Map();
  }
  return globalThis.__bookPollResponses;
}

function clamp(value, min = 0, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(min, Math.min(max, n));
}

function cleanReaderId(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9:_-]/g, '')
    .slice(0, 96) || `anon-${Math.random().toString(36).slice(2)}`;
}

function normalizeResponse(body) {
  const row = {
    reader_id: cleanReaderId(body.reader_id),
    updated_at: new Date().toISOString(),
  };

  for (const key of scenarioKeys) row[key] = clamp(body[key]);
  row.long_horizon = clamp(body.long_horizon ?? body.long);
  for (const key of exposureKeys) row[key] = clamp(body[key]);

  return row;
}

function aggregate(rows) {
  const count = rows.length;
  const sums = { rapid: 0, abundance: 0, gentle: 0, long: 0, xrisk: 0 };

  for (const row of rows) {
    sums.rapid += Number(row.rapid || 0);
    sums.abundance += Number(row.abundance || 0);
    sums.gentle += Number(row.gentle || 0);
    sums.long += Number(row.long_horizon || row.long || 0);
    sums.xrisk += Number(row.xrisk || 0);
  }

  const average = {};
  for (const key of scenarioKeys) {
    average[key] = count ? sums[key] / count : 0;
  }

  return { count, average };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const responses = store();

  if (req.method === 'POST') {
    const row = normalizeResponse(req.body || {});
    responses.set(row.reader_id, row);
    res.status(200).json({ ok: true, source: 'vercel-memory', ...aggregate([...responses.values()]) });
    return;
  }

  if (req.method === 'GET') {
    res.status(200).json({ ok: true, source: 'vercel-memory', ...aggregate([...responses.values()]) });
    return;
  }

  res.status(405).json({ ok: false, error: 'method-not-allowed' });
}
