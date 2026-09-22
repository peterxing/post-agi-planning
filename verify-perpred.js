'use strict';
if(require.main===module)require('./pipeline-lock').guard('verify:predictions');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const predictions=require('./predictions.json'),signals=require('./signals.json');
const {openReaderSite,verifyAccounting,expected}=require('./verify-site');
async function main(){
  const channels=[signals.embeds,signals.context.items,signals.uncited.items];
  const keys=channels.flatMap(channel=>Object.keys(channel));
  assert.equal(keys.length,expected.length);assert.equal(new Set(keys).size,expected.length);
  assert(expected.every(row=>keys.includes(row.id)),'All canonical IDs are accounted for exactly once.');
  for(const [id,record]of Object.entries(signals.embeds)){
    assert.equal(record.kind,'news');assert.equal(record.reviewed,true);assert.equal(record.matchMethod,'reviewed-news');
    assert.equal(record.maps,expected.find(row=>row.id===id).data.t);
    assert(record.mappingRationale&&record.quote&&record.publisher&&record.provenance?.publishedAt);
    assert(['direct','scenario','leading-indicator'].includes(record.evidenceType));
    assert(!/(^|\.)(x|twitter|twimg)\.com$/i.test(new URL(record.url).hostname));
  }
  for(const record of Object.values(signals.context.items)){
    assert(record.publishedAt&&record.publishedAtSource&&record.ageBucket&&Number.isFinite(record.ageDays));
    assert(record.reviewed&&record.mappingRationale&&record.quote);
  }
  for(const record of Object.values(signals.uncited.items))assert(record.reason?.trim()&&record.statement?.trim());
  const horizon=predictions.postSuperintelligence;
  for(const expression of [/aligned superintelligence/i,/not a probability by 2040/i,/mutually exclusive/i])assert.match(horizon.summary,expression);
  for(const row of horizon.items){
    assert(['conditional','speculative'].includes(row.epistemic));
    for(const list of [row.dependencies,row.indicators])assert(list.length>=2&&list.length<=4&&list.every(item=>typeof item==='string'&&item.trim()));
    assert(row.caveat?.trim());assert(Number.isFinite(row.conditionalProb)&&row.conditionalProb>=0&&row.conditionalProb<=100);
    assert(!/\bfrom:\s*peterxing\b|x\.com|twitter\.com/i.test(row.match.search));
  }
  const caveats=horizon.items.map(row=>`${row.t} ${row.caveat}`).join(' ').toLowerCase();
  for(const text of ['endovascular bcis are minimally invasive, not non-invasive','chatbot or digital replica','small orbital clusters are not a dyson swarm','energy-use classification','no empirical confirmation','not an established physical theory'])assert(caveats.includes(text));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({reducedMotion:'reduce'}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await openReaderSite(page,process.env.PAP_SITE_URL||process.argv[2]||'http://127.0.0.1:8787/');
    await verifyAccounting(page);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
  console.log(`RESULT: PASS - ${expected.length} exact authored forecasts, three-channel totality, reviewed NEWS provenance and all dependency-gated horizon conditions are rendered without invented sources.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
