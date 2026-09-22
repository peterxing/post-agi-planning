'use strict';
if(require.main===module)require('./pipeline-lock').guard('verify:ui');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {openReaderSite}=require('./verify-site');
const predictions=require('./predictions.json'),signals=require('./signals.json');
const BASE=process.env.PAP_SITE_URL||process.argv[2]||'http://127.0.0.1:8787/';
const profiles=[
  {name:'desktop-light',theme:'light',width:1440,height:1000},
  {name:'desktop-dark',theme:'dark',width:1440,height:1000},
  {name:'tablet',theme:'dark',width:820,height:1180},
  {name:'mobile',theme:'light',width:390,height:844},
  {name:'narrow',theme:'dark',width:320,height:900},
  {name:'zoom-layout',theme:'light',width:640,height:900},
  {name:'reduced-motion',theme:'dark',width:1280,height:900,reduced:true},
];
async function openExplore(page){
  await page.evaluate(()=>openExplore('#mission-control'));
  await page.waitForFunction(()=>document.querySelectorAll('.alloc-row').length===6&&publishedSignals);
}
async function main(){
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    for(const profile of profiles){
      const context=await browser.newContext({viewport:{width:profile.width,height:profile.height},
        reducedMotion:profile.reduced?'reduce':'no-preference',hasTouch:profile.width<700,isMobile:profile.width<700});
      try{
        const page=await context.newPage(),errors=[],requests=[];
        page.on('pageerror',error=>errors.push(error.message));
        page.on('request',request=>requests.push(new URL(request.url()).pathname));
        await openReaderSite(page,BASE,profile.theme);
        assert.equal(await page.locator('.primary-nav a').count(),4);
        assert.equal(await page.locator('#yearContent').getAttribute('data-year'),'2026');
        assert(await page.locator('#yearRail [aria-current="date"]').count());
        assert.equal(await page.locator('.alloc-row').count(),0,'Explore is not initialized at reader entry.');
        assert(!requests.some(name=>/\/(?:game|three\.)/.test(name)));
        await page.locator('[data-year-step="1"]').click();
        assert.equal(await page.locator('#yearContent').getAttribute('data-year'),'2027');
        await page.locator('#newsReset').click();
        const firstArticle=await page.locator('#yearContent .story').first().getAttribute('id');
        await page.locator('#yearContent .story > details > summary').first().click();
        await page.waitForSelector('#yearContent .connection');
        const target=await page.locator('#yearContent .connection h6 a').first().getAttribute('href');
        await page.locator('#yearContent .connection h6 a').first().click();
        await page.waitForFunction(hash=>document.getElementById(hash.slice(1))?.open,target);
        await page.goBack();
        await page.waitForFunction(id=>document.querySelector('#yearContent .story')?.id===id,firstArticle);
        assert(await page.locator('#yearContent .story > details').first().getAttribute('open')!==null);
        await openExplore(page);
        const baseline=await page.locator('#sim-card-agi').textContent();
        const anchor=predictions.years.flatMap(year=>year.events).find(row=>row.simAnchor==='agi').prob;
        assert.equal(baseline,`${anchor}%`);
        await page.locator('#simCapability').evaluate(node=>{node.value='20';});
        await page.locator('#simCapability').dispatchEvent('input');
        const expected=Math.round(Math.max(5,Math.min(95,anchor+11)));
        await page.waitForFunction(value=>document.getElementById('sim-card-agi').textContent===value,`${expected}%`);
        assert.equal(await page.locator('#sim-branch-default').getAttribute('data-probability'),
          String(Math.round(Math.max(5,Math.min(95,predictions.years.flatMap(y=>y.events).find(r=>r.simAnchor==='default').prob+9)))));
        await page.locator('[data-sim-preset="baseline"]').click();
        await page.waitForFunction(value=>document.getElementById('sim-card-agi').textContent===value,baseline);
        await page.locator('#netWorthInput').fill('250,000');await page.locator('#netWorthInput').dispatchEvent('input');
        assert.equal(await page.locator('.alloc-row [data-dollar]').first().textContent(),'$50,000');
        await page.locator('.alloc-num').first().fill('100');await page.locator('.alloc-num').first().dispatchEvent('input');
        assert.equal(await page.locator('#allocTotal').textContent(),'180%');
        await page.locator('#allocNormalize').click();assert.equal(await page.locator('#allocTotal').textContent(),'100%');
        await page.locator('#allocReset').click();
        assert.equal(await page.locator('#netWorthInput').inputValue(),'100,000');
        await page.locator('#atlasSearch').fill('orbital');await page.locator('#atlasSearch').dispatchEvent('input');
        assert.match(await page.locator('#catalogueResults').textContent(),/orbital/i);
        await page.locator('#filterReset').click();
        assert.equal(await page.locator('.catalogue-result').count(),12);
        await page.locator('#branchFilter').selectOption('managed');
        const managed=predictions.years.flatMap(y=>y.events).filter(row=>/^managed branch:/i.test(row.t));
        assert((await page.locator('#filterResultCount').textContent()).startsWith(`${managed.length} dated`));
        await page.locator('#filterReset').click();
        const before=await page.evaluate(()=>document.querySelectorAll('*').length);
        for(let cycle=0;cycle<5;cycle++){
          await page.locator('#exploreDisclosure').evaluate(node=>node.open=false);await page.waitForTimeout(40);
          await page.locator('#exploreDisclosure').evaluate(node=>node.open=true);await page.waitForTimeout(40);
        }
        assert.equal(await page.locator('.alloc-row').count(),6);
        assert(await page.evaluate(()=>document.querySelectorAll('*').length)<=before+15);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${profile.name} overflow`);
        if(profile.reduced){
          const moving=await page.evaluate(()=>[...document.querySelectorAll('*')].filter(node=>{
            const style=getComputedStyle(node);return style.animationName!=='none'&&style.animationDuration!=='0s';
          }).map(node=>node.className));
          assert.deepEqual(moving,[],'Reduced motion disables every mounted animation, including Explore.');
        }
        await page.locator('#chapterPreview a').first().click();
        assert.equal(await page.locator('#rdBody .reader-canonical').textContent(),await page.locator('#bookSource > article').first().textContent());
        await page.locator('#rdNext').click();assert.equal(await page.locator('#rdProgress').textContent(),'2 / 13');
        await page.locator('#rdPrev').click();await page.locator('#rdBody [data-read-chapter]').click();
        await page.locator('#closeReader').click();
        assert(await page.evaluate(()=>JSON.parse(localStorage.getItem('pap-mission-control:v1')).quests.includes('chapter-v1')));
        if(process.env.PAP_UI_ARTIFACT_DIR){
          fs.mkdirSync(process.env.PAP_UI_ARTIFACT_DIR,{recursive:true});
          await page.locator('#timeline').scrollIntoViewIfNeeded();
          await page.screenshot({path:path.join(process.env.PAP_UI_ARTIFACT_DIR,`reader-${profile.name}.png`)});
        }
        assert.deepEqual(errors,[]);
        console.log(`[${profile.name}] Reported/Forecast navigation, original simulator/portfolio, filters, reader, idempotent Explore, no early game and geometry PASS`);
      }finally{await context.close();}
    }
    const context=await browser.newContext({reducedMotion:'reduce'});
    try{
      const page=await context.newPage();
      await openReaderSite(page,BASE);
      await page.evaluate(()=>localStorage.setItem('pap-mission-control:v1','unreadable-user-sentinel'));
      await page.reload();await page.evaluate(()=>openExplore('#mission-control'));
      await page.waitForFunction(()=>document.getElementById('missionStorage').textContent.includes('Nothing has been overwritten'));
      assert.equal(await page.evaluate(()=>localStorage.getItem('pap-mission-control:v1')),'unreadable-user-sentinel');
      await page.locator('#missionReset').click();await page.locator('#cancelMissionReset').click();
      assert.equal(await page.evaluate(()=>localStorage.getItem('pap-mission-control:v1')),'unreadable-user-sentinel');
      await page.locator('#missionReset').click();await page.locator('#confirmMissionReset').click();
      assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('pap-mission-control:v1')).quests),[]);
      await page.waitForFunction(()=>publishedSignals);
      const altered=structuredClone(signals);altered.forecastVersion.sha256='0'.repeat(64);
      const before=await page.evaluate(()=>publishedSignals.updated);
      await page.route('**/signals.json',route=>route.fulfill({json:altered}));
      await page.evaluate(()=>loadRecord());
      assert.match(await page.locator('#recordStatus').textContent(),/Last good record retained/);
      assert.equal(await page.evaluate(()=>publishedSignals.updated),before);
    }finally{await context.close();}
  }finally{await browser.close();}
  console.log('RESULT: PASS - approved reader navigation and all original tool calculations/actions/storage semantics across seven profiles, reduced motion, repeat mounts and invalid-update preservation.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
