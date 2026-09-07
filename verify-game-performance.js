'use strict';
if (require.main === module) require('./pipeline-lock').guard('verify:game-performance');
const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const ROOT=__dirname;
const BASE=(process.env.PAP_SITE_URL || process.argv.find(value=>/^https?:\/\//.test(value)) || 'http://127.0.0.1:8787').replace(/\/$/,'');
const policy=JSON.parse(fs.readFileSync(path.join(ROOT,'game-policy.json'),'utf8'));
const b=policy.budgets;

async function main() {
  const names=[...policy.publicFiles,...policy.canonicalDataFiles];
  const assets=names.map(name=>{
    const bytes=fs.readFileSync(path.join(ROOT,name));
    if(policy.byteCeilings[name])assert(bytes.length<=policy.byteCeilings[name],`${name} exceeds its per-file budget.`);
    return{name,decoded:bytes.length,gzip6:zlib.gzipSync(bytes,{level:6}).length};
  });
  const decoded=assets.reduce((sum,row)=>sum+row.decoded,0),gzip=assets.reduce((sum,row)=>sum+row.gzip6,0);
  const maintained=assets.filter(row=>policy.maintainedFiles.includes(row.name)).reduce((sum,row)=>sum+row.decoded,0);
  assert(decoded<=b.wholeDeclaredDecodedBytes,'Whole declared game/data set exceeds decoded allowance.');
  assert(gzip<=b.wholeDeclaredGzip6Bytes,'Whole declared game/data set exceeds gzip6 allowance.');
  assert(maintained<=b.maintainedAggregateBytes,'Maintained game source exceeds its unminified aggregate allowance.');
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const reports=[];
  try {
    for(const mobile of [false,true]) {
      const width=mobile?390:1440,height=mobile?844:1000;
      const context=await browser.newContext({viewport:{width,height},hasTouch:mobile,isMobile:mobile});
      await context.addInitScript(()=>{
        const raf=requestAnimationFrame.bind(window),caf=cancelAnimationFrame.bind(window),pending=new Set();
        window.requestAnimationFrame=callback=>{
          let id=raf(time=>{pending.delete(id);callback(time);});pending.add(id);return id;
        };
        window.cancelAnimationFrame=id=>{pending.delete(id);caf(id);};
        window.pendingGameFrames=()=>pending.size;
        const originalFetch=window.fetch.bind(window);
        let requests=0;
        window.fetch=(...args)=>{requests++;return originalFetch(...args).finally(()=>requests--);};
        window.pendingGameRequests=()=>requests;
      });
      const page=await context.newPage(),session=await context.newCDPSession(page);
      if(mobile) {
        await session.send('Emulation.setCPUThrottlingRate',{rate:4});
        await session.send('Network.enable');
        await session.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:500000,uploadThroughput:500000});
      }
      await page.goto(BASE+'/game?scoutTheme=light');
      const landing=await page.evaluate(()=>{
        const n=performance.getEntriesByType('navigation')[0],r=performance.getEntriesByType('resource');
        return{interactive:n.domInteractive,transfer:n.transferSize+r.reduce((a,v)=>a+v.transferSize,0),requests:r.map(row=>row.name)};
      });
      assert(landing.interactive<=b.interactiveMs,`Game landing interactive ${landing.interactive} exceeds budget.`);
      assert(landing.transfer<=b.landingTransferredBytes,`Game landing transfer ${landing.transfer} exceeds budget.`);
      assert(!landing.requests.some(url=>/\/(?:three\.|game-(?:world|core|data|ui))/.test(url)),'Renderer/campaign was fetched before Start.');
      const start=Date.now();
      await page.locator('#startGame').click();
      await page.evaluate(async()=>{window.readGamePerformance=(await import('/game-ui.mjs')).getCampaignSnapshot;});
      await page.waitForFunction(()=>Boolean(window.readGamePerformance?.()?.backend.renderedFrames));
      const startup=Date.now()-start;
      assert(startup<=(mobile?b.mobileStartMs:b.desktopStartMs),`Start to controllable 3D ${startup} ms exceeds ${mobile?'mobile':'desktop'} budget.`);
      if(mobile) {
        await session.send('Emulation.setCPUThrottlingRate',{rate:1});
        await session.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
      }
      await page.waitForTimeout(3200);
      let metrics=await page.evaluate(()=>window.readGamePerformance().backend);
      assert(['WebGPU','WebGL2'].includes(metrics.backend),'Fallback cannot satisfy a rendering performance proof.');
      assert(metrics.drawCalls<=(mobile?b.mobileDrawCalls:b.desktopDrawCalls),'Draw-call budget exceeded.');
      assert(metrics.triangles<=(mobile?b.mobileTriangles:b.desktopTriangles),'Triangle budget exceeded.');
      assert(metrics.frameP95<=(mobile?b.mobileFrameP95Ms:b.desktopFrameP95Ms),`Frame p95 ${metrics.frameP95} exceeds budget.`);
      assert(metrics.pixels<=(mobile?b.mobileRenderPixels:b.desktopRenderPixels),'Render-pixel budget exceeded.');
      assert(metrics.geometries<=b.geometries&&metrics.materials<=b.materials&&metrics.textures<=b.textures,'Owned GPU resource counts exceed budget.');
      await page.locator('#gameArchive').click();await page.locator('[data-chapter="8"]').click();
      const dom=await page.evaluate(()=>({nodes:document.querySelectorAll('*').length,
        rules:[...document.styleSheets].reduce((sum,sheet)=>sum+sheet.cssRules.length,0),
        overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth}));
      assert(dom.nodes<=b.domNodes&&dom.rules<=b.cssRules&&!dom.overflow,'Open archive exceeds DOM/CSS/overflow allowance.');
      await page.locator('#closeGameDialog').click();
      await page.locator('#gameSources').click();
      await page.getByRole('button',{name:'Inspect every forecast and its sources'}).click();
      await page.locator('[data-forecast]').first().click();
      assert(await page.locator('[data-reference-detail]').count()>0,'The first real reference inspector was not mounted.');
      assert(await page.evaluate(()=>document.querySelectorAll('*').length)<=b.domNodes,'Reference inspector exceeds DOM allowance.');
      await page.locator('#closeGameDialog').click();
      await page.locator('#gameTravel').click();await page.locator('#gameDialog [data-travel="commons"]').click();
      const responseTimes=await page.evaluate(()=>{
        const input=document.getElementById('stationSelection'),times=[];
        for(let i=0;i<20;i++){
          const started=performance.now();input.value=String(i%3);input.dispatchEvent(new Event('change',{bubbles:true}));
          times.push(performance.now()-started);
        }
        return times.sort((a,b)=>a-b);
      });
      const responseP95=responseTimes[Math.floor((responseTimes.length-1)*.95)];
      assert(responseP95<=b.decisionResponseP95Ms,'Decision input-to-DOM response exceeds budget.');
      await page.locator('#closeGameDialog').click();
      const transfer=await page.evaluate(()=>{
        const n=performance.getEntriesByType('navigation')[0];
        return n.transferSize+performance.getEntriesByType('resource').reduce((sum,row)=>sum+row.transferSize,0);
      });
      assert(transfer<=b.coldTransferredBytes,`Complete cold transfer ${transfer} exceeds allowance.`);
      await session.send('HeapProfiler.collectGarbage');
      const heap=(await session.send('Runtime.getHeapUsage')).usedSize;
      assert(heap<=b.jsHeapBytes,'Game JavaScript heap exceeds allowance.');
      await page.locator('#gamePause').click();await page.locator('#exitCampaign').click();
      assert.equal(await page.locator('canvas').count(),0);
      assert.equal(await page.evaluate(()=>window.readGamePerformance()),null);
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(()=>window.pendingGameFrames()),0,'Animation callbacks remain after exit.');
      assert.equal(await page.evaluate(()=>window.pendingGameRequests()),0,'Game fetches remain after exit.');
      let cycleGrowth=null;
      if(!mobile) {
        await session.send('HeapProfiler.collectGarbage');
        const initialHeap=(await session.send('Runtime.getHeapUsage')).usedSize;
        for(let cycle=0;cycle<10;cycle++){
          await page.locator('#resumeGame').click();
          await page.waitForFunction(()=>Boolean(window.readGamePerformance?.()?.backend.renderedFrames));
          await page.locator('#gamePause').click();await page.locator('#exitCampaign').click();
          assert.equal(await page.locator('canvas').count(),0);
        }
        await page.waitForTimeout(100);await session.send('HeapProfiler.collectGarbage');
        cycleGrowth=(await session.send('Runtime.getHeapUsage')).usedSize-initialHeap;
        assert(cycleGrowth<=b.tenCycleHeapGrowthBytes,`Ten-cycle retained heap grew by ${cycleGrowth} bytes.`);
        assert.equal(await page.evaluate(()=>window.pendingGameFrames()),0);
        assert.equal(await page.evaluate(()=>window.pendingGameRequests()),0);
      }
      reports.push({profile:mobile?'390px touch / startup 4x CPU, 4Mbps, 150ms RTT; frame samples unthrottled':'1440px desktop',
        landing,startup,metrics,dom,transfer,heap,responseP95,cycleGrowth});
      await context.close();
    }
  } finally {await browser.close();}
  console.log(JSON.stringify({declaredAssets:assets,decoded,gzip,maintained,reports},null,2));
  console.log('RESULT: PASS - whole declared assets and measured cold entry/render/archive/resource outcomes fit unchanged game limits.');
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
