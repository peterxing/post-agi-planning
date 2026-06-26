// verify-id.js — confirm a tweet id is still live and pull current text/date/likes.
// Uses the public syndication tweet-result endpoint (works without auth/rate-limit locally).
//   node verify-id.js <tweetId>
const https = require('https');

function token(id){
  try { return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, ''); }
  catch(e){ return String(Math.floor(Number(id) / 1e15) * Math.PI); }
}
function get(url){
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, body: d }));
    });
    req.on('error', rej);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
  });
}
(async () => {
  const id = process.argv[2];
  if (!id) { console.error('usage: node verify-id.js <tweetId>'); process.exit(2); }
  const url = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${token(id)}`;
  try {
    const r = await get(url);
    if (r.status !== 200) { console.log(JSON.stringify({ id, ok: false, status: r.status })); process.exit(1); }
    const j = JSON.parse(r.body);
    console.log(JSON.stringify({
      id, ok: true,
      user: j.user && j.user.screen_name,
      created_at: j.created_at,
      likes: j.favorite_count,
      text: (j.text || '').replace(/\s+/g, ' ').slice(0, 180)
    }));
  } catch (e) {
    console.log(JSON.stringify({ id, ok: false, error: String(e) }));
    process.exit(1);
  }
})();
