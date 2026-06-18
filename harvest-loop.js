// Background harvester: poll the syndication profile timeline until the rate-limit clears, then
// cache the full raw HTML to timeline-raw.json and exit. Used to seed the cache when the machine IP
// is being throttled; the main refresh-signals.js harvests inline on its own when egress is healthy.
const https = require('https');
const fs = require('fs');
const path = require('path');
const RAW = path.join(__dirname, 'timeline-raw.json');
const URL = 'https://syndication.twitter.com/srv/timeline-profile/screen-name/peterxing?showReplies=false&lang=en&dnt=true';
const MAX_MIN = 30;
const deadline = Date.now() + MAX_MIN * 60000;

function get(){
  return new Promise((res) => {
    const req = https.get(URL, { headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/json', 'Accept-Language': 'en-US,en;q=0.9'
    } }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res({status:r.statusCode, body:d})); });
    req.on('error', () => res({status:0, body:''}));
    req.setTimeout(20000, () => req.destroy());
  });
}

(async () => {
  let n = 0;
  while (Date.now() < deadline) {
    n++;
    const r = await get();
    if (r.status === 200 && r.body && r.body.length > 5000) {
      const m = r.body.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      let entries = 0;
      if (m) { try { entries = ((((JSON.parse(m[1]).props||{}).pageProps||{}).timeline||{}).entries||[]).length; } catch(e){} }
      if (entries > 0) {
        fs.writeFileSync(RAW, r.body);
        console.log(`[harvest-loop] attempt ${n}: OK ${r.body.length} bytes, ${entries} entries -> timeline-raw.json`);
        process.exit(0);
      }
    }
    console.log(`[harvest-loop] attempt ${n}: status ${r.status} len ${r.body.length} — retrying in 45s`);
    await new Promise(s => setTimeout(s, 45000));
  }
  console.log('[harvest-loop] gave up after ' + MAX_MIN + ' min'); process.exit(1);
})();
