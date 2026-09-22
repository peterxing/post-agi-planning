'use strict';
if (require.main === module) require('./pipeline-lock').guard('verify:game-content');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {deriveGame,verifyVendor}=require('./build-game');
const {sha,extractCanonical,buildProjection}=require('./game-source');
const {gameCsp,ALLOW_FILES}=require('./server');
const ROOT=__dirname;
const read=name=>fs.readFileSync(path.join(ROOT,name),'utf8');
const json=name=>JSON.parse(read(name));

async function main() {
  const policy=json('game-policy.json'),core=await import('./game-core.mjs');
  const expected=['game.html','game.css','game-entry.js','game-core.mjs','game-data.mjs','game-ui.mjs','game-world.mjs',
    'game-content.json','three.webgpu.min.js','three.core.min.js','THREE-LICENSE.txt',
    
    ];
  assert.deepEqual(policy.publicFiles,expected,'The approved exact game/optional surface changed.');
  assert.deepEqual(policy.baseFiles,expected.slice(0,11),'Base accounting must retain the complete original set.');
  verifyVendor();
  const projected=await deriveGame(),published=json('game-content.json');
  assert.deepEqual(published,projected,'Generated content is not the exact current canonical projection.');
  if(process.argv.includes('--require-ready'))assert.equal(projected.coverage.status,'ready','Initial launch requires complete current adaptation.');
  const {validateBundle}=await import('./game-data.mjs');
  await validateBundle({predictions:json('predictions.json'),signals:json('signals.json'),author:json('author.json'),content:published});
  expected.forEach(name=>assert(ALLOW_FILES.has(name),`Local serving omits ${name}`));
  for(const file of policy.sourceOnlyFiles)assert(!ALLOW_FILES.has(file),`Operator/build source is publicly served: ${file}`);
  const permitted=new Set([...expected,'predictions.json','signals.json','author.json','index.html','app.js','styles.css','LICENSE']);
  for(const file of [...expected,...policy.sourceOnlyFiles].filter(name=>/\.(?:m?js)$/.test(name))) {
    const source=read(file);
    for(const match of source.matchAll(/(?:from\s*|import\s*\()\s*['"](\.\/[^'"]+)['"]/g))
      assert(permitted.has(match[1].slice(2)) || policy.sourceOnlyFiles.includes(match[1].slice(2)),`${file} has an uncurated import ${match[1]}`);
  }
  const config=JSON.parse(fs.readFileSync(path.join(process.env.PAP_SITE_CONFIG_DIR || 'C:\\Users\\peterxing\\pap-site','vercel.json'),'utf8'));
  const csp=gameCsp(read('game.html'));
  for(const route of ['/game','/game.html'])assert.equal(
    config.headers.find(row=>row.source===route)?.headers.find(row=>row.key==='Content-Security-Policy')?.value,csp,
    `Production CSP differs from browser-normalized inline theme hashes: ${route}`);
  for(const file of expected.filter(name=>name.endsWith('.mjs')))
    assert.match(config.headers.find(row=>row.source==='/'+file)?.headers.find(row=>row.key==='Content-Type')?.value||'',/javascript/);


  const canonical=await extractCanonical(read('index.html'),read('app.js')),mapping=json('game-map.json');
  const changed=json('predictions.json');changed.years[0].events[0].prob-=1;
  const gap=buildProjection({canonical,predictions:changed,author:json('author.json'),mapping,core});
  assert.equal(gap.coverage.status,'review-required');
  assert(gap.coverage.pending.some(row=>row.id==='2026-0'&&row.kind==='changed-record'));
  assert(!gap.mappings.some(row=>row.forecastId==='2026-0'),'Changed source reused a stale gameplay mapping.');
  const duplicate=structuredClone(mapping);duplicate.mappings.push(duplicate.mappings[0]);
  assert.throws(()=>buildProjection({canonical,predictions:json('predictions.json'),author:json('author.json'),mapping:duplicate,core}),/Duplicate/);
  const horizons=published.mappings.filter(row=>row.forecastId.startsWith('horizon-'));
  assert(horizons.every(row=>row.mission==='M11'&&row.region==='frontier'),'Undated horizons lack their actual Frontier program binding.');

  if(process.env.PAP_CONTENT_BASELINE) {
    const baseline=process.env.PAP_CONTENT_BASELINE;
    for(const file of ['predictions.json','author.json','signals.json'])
      assert.equal(read(file),fs.readFileSync(path.join(baseline,file),'utf8'),`Protected canonical data changed: ${file}`);
    const original=await extractCanonical(fs.readFileSync(path.join(baseline,'index.html'),'utf8'),fs.readFileSync(path.join(baseline,'app.js'),'utf8'));
    assert.equal(canonical.bookSha256,original.bookSha256,'The complete original book changed.');
    assert.equal(canonical.rawBookSha256,original.rawBookSha256,'The authored book payload changed.');
    assert.equal(canonical.toolsSha256,original.toolsSha256,'Tool assumptions/formulas/input models changed.');
    assert.deepEqual(canonical.book,original.book);
  }
  console.log(`RESULT: PASS - game projection ${published.coverage.status}; ${published.coverage.mapped}/${published.coverage.forecasts} exact mappings, `
    + `${published.coverage.chapters} full chapters, ${published.coverage.sections} original surfaces, canonical layers and strict vendor/import/CSP boundaries.`);
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
