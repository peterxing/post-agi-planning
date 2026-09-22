'use strict';
if (require.main === module) require('./pipeline-lock').guard('verify');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const predictions = require('./predictions.json');
const signals = require('./signals.json');
const expected = [
  ...predictions.years.flatMap(year => year.events.map((data,index) => ({id:`${year.year}-${index}`,data,year:year.year}))),
  ...predictions.postSuperintelligence.items.map(data => ({id:`horizon-${data.id}`,data,year:null})),
];
function requireCount(value, name){
  assert(Number.isInteger(value) && value >= 0, `Missing or unusable ${name}; no empty expectation is inferred.`);
  return value;
}
const counts = {
  cited:requireCount(signals.coverage?.cited,'coverage.cited'),
  context:requireCount(signals.context?.count,'context.count'),
  uncited:requireCount(signals.uncited?.count,'uncited.count'),
};
assert.equal(counts.cited + counts.context + counts.uncited, expected.length);
async function openReaderSite(page, base, theme='light', hash='#timeline'){
  const url = new URL(base);
  url.searchParams.set('scoutTheme', theme);
  url.hash = hash;
  await page.goto(url.href, {waitUntil:'load'});
  await page.waitForFunction(() => document.getElementById('yearContent')?.dataset.loaded === 'true'
    || document.getElementById('recordStatus')?.dataset.state === 'error');
  assert.equal(await page.locator('#yearContent').getAttribute('data-loaded'),'true',await page.locator('#recordStatus').textContent());
}
async function inspectForecast(page, row){
  const hash = row.year === null ? `#${row.id}` : `#event-${row.id}`;
  await page.evaluate(value => { history.pushState(null,'',value); revealHash(); }, hash);
  const id = hash.slice(1);
  await page.waitForFunction(value => document.getElementById(value)?.querySelector('.forecast-facts'), id);
  await page.locator(`#${id} > .forecast-facts > .forecast-dossier > summary`).click();
  await page.waitForFunction(value => document.querySelector(`[data-forecast-dossier="${value}"]`), row.id);
  return page.locator(`[data-forecast-dossier="${row.id}"]`);
}
async function verifyAccounting(page){
  const seen={cited:0,context:0,uncited:0}, visited=new Set();
  for(const row of expected){
    const dossier=await inspectForecast(page,row);
    const detailsId=row.year===null?row.id:`event-${row.id}`;
    assert.equal(await page.locator(`#${detailsId} > summary`).textContent(),row.data.t);
    const source=signals.embeds[row.id]||signals.context.items[row.id];
    const channel=signals.embeds[row.id]?'cited':signals.context.items[row.id]?'context':'uncited';
    const news=dossier.locator(`[data-news-forecast="${row.id}"]`);
    assert.equal(await news.count(),1,'Exactly one NEWS channel per forecast');
    assert.equal(await news.getAttribute('data-news-channel'),channel);
    seen[channel]++;visited.add(row.id);
    const text=await news.textContent();
    if(source){
      assert(text.includes(source.mappingRationale),`Exact reviewed NEWS rationale: ${row.id}`);
      assert(text.includes(source.quote||source.text),`Exact reviewed NEWS quote: ${row.id}`);
      assert(text.includes('Published')&&text.includes('not'),`Publication/limits: ${row.id}`);
      const href=await news.locator('a[target="_blank"]').first().getAttribute('href');
      assert.equal(new URL(href).href,new URL(source.url).href);
      assert(!/(^|\.)(x|twitter|twimg)\.com$/i.test(new URL(href).hostname));
      if(channel==='context')assert.match(text,/Dated background/);
    }else assert(text.includes(signals.uncited.items[row.id].statement),`Explicit searched gap ${row.id}`);
    const fact=await page.locator(`#${detailsId} > .forecast-facts`).textContent();
    assert(fact.includes(String(row.year===null?row.data.conditionalProb:row.data.prob)));
    if(row.year===null){
      for(const dependency of [...row.data.dependencies,...row.data.indicators])assert(fact.includes(dependency));
      assert(fact.includes(row.data.caveat));
    }else assert(fact.includes(row.data.mBasis));
    assert.equal(await dossier.locator('.dossier-section > h5').count(),5,'NEWS/reference/assessment/METR/X remain separate');
    assert(!await page.locator('.tl-signal-search').count(),'No discovery search substitutes for evidence');
  }
  assert.deepEqual(seen,counts);assert.equal(visited.size,expected.length);
  return {seen,forecasts:visited.size};
}
async function main(){
  const base=process.env.PAP_SITE_URL||process.argv[2]||'http://127.0.0.1:8787/';
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    for(const theme of ['dark','light']){
      const context=await browser.newContext({reducedMotion:'reduce'});
      try{
        const page=await context.newPage(),errors=[];
        page.on('pageerror',error=>errors.push(error.message));
        await openReaderSite(page,base,theme);
        const result=await verifyAccounting(page);
        assert.deepEqual(errors,[]);
        assert.equal(await page.locator('script[src="app.js"]').count(),1);
        assert.equal(await page.locator('link[href="styles.css"]').count(),1);
        console.log(JSON.stringify({theme,...result,errors}));
      }finally{await context.close();}
    }
  }finally{await browser.close();}
  console.log('RESULT: PASS - every forecast has its exact cited/context/uncited rendered NEWS state, preserved probability/timing/horizon limits and distinct source channels in both themes.');
}
module.exports={openReaderSite,inspectForecast,verifyAccounting,expected,counts};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
