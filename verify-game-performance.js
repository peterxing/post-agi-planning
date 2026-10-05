'use strict';
if (require.main === module) require('./pipeline-lock').guard('verify:game-performance');
const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const ROOT=__dirname;
const BASE=(process.env.PAP_SITE_URL || process.argv.find(value=>/^https?:\/\//.test(value)) || 'http://127.0.0.1:8787').replace(/\/$/,'');
const policy=JSON.parse(fs.readFileSync(path.join(ROOT,'game-policy.json'),'utf8'));
const b=policy.budgets;

/* UNCHANGED-GAME TIMING CARRY-FORWARD (user-approved 4 October 2026): "Don't let a slow speed reading block
   news when the game itself hasn't changed; still block on real game errors and size limits."
   Exactly three readings are timing: landing interactive, start to controllable 3D and frame p95. If one of
   them misses its budget and nothing else failed, the run exits 70 (a named warning, never a pass) only when
   the nine runtime files are byte-identical on disk, as served, in game-performance-baseline.json and in the
   published remote main, and the baseline is a consistent record of a real full pass of exactly those bytes
   in a published release. Everything else still exits 1: functional failures, every byte/transfer/resource
   budget, a changed runtime, unexpected readings, and a missing, corrupt or inconsistent baseline. No budget
   changes here. Only a real full pass of NEW runtime bytes in a release postflight may create or update the
   baseline; a run of unchanged bytes never re-mints it. */
const RUNTIME_FILES=Object.freeze(['game.html','game.css','game-entry.js','game-core.mjs','game-data.mjs',
  'game-ui.mjs','game-world.mjs','three.webgpu.min.js','three.core.min.js']);
const NON_RUNTIME_BASE_FILES=Object.freeze(['game-content.json','THREE-LICENSE.txt']);
const TIMING_BUDGETS=Object.freeze(['interactiveMs','desktopStartMs','mobileStartMs','desktopFrameP95Ms','mobileFrameP95Ms']);
const TIMING=Object.freeze({
  landingInteractiveMs:{label:'landing interactive',budget:()=>'interactiveMs'},
  startupMs:{label:'start to controllable 3D',budget:profile=>profile==='mobile'?'mobileStartMs':'desktopStartMs'},
  frameP95Ms:{label:'frame p95',budget:profile=>profile==='mobile'?'mobileFrameP95Ms':'desktopFrameP95Ms'},
});
const EXIT_CARRY_FORWARD=70;
const PASS_RESULT='RESULT: PASS - complete active base-game assets, real rendering, lifecycle and unchanged performance limits.';
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const ms=value=>`${Math.round(value*10)/10} ms`;
const sameSet=(values,expected)=>JSON.stringify([...values].sort())===JSON.stringify([...expected].sort());

/* A timing reading is recorded, never asserted, so the rest of the run still proves everything else.
   A reading that is not a finite, non-negative number is an unexpected measurement and fails the run. */
function recordTiming(timing,profile,metric,value,budgets=b){
  const budget=budgets[TIMING[metric].budget(profile)];
  if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw new Error(`Unexpected ${profile} ${TIMING[metric].label} measurement: ${value}.`);
  if(value>budget)timing.push({profile,metric,value,budget});
}

function validateBaseline(baseline,{budgets=b,baseFiles=policy.baseFiles,today=new Date().toISOString().slice(0,10)}={}){
  if(!baseline||typeof baseline!=='object'||Array.isArray(baseline))return['the baseline is missing or is not a JSON object'];
  const problems=[];
  if(baseline.schemaVersion!==1||baseline.kind!=='game-performance-baseline')problems.push('schemaVersion/kind is not game-performance-baseline v1');
  if(!sameSet(baseFiles.filter(name=>!NON_RUNTIME_BASE_FILES.includes(name)),RUNTIME_FILES))
    problems.push('the game policy runtime set is no longer the nine carry-forward files; review this rule');
  const release=baseline.release||{};
  if(!/^[0-9a-f]{40}$/.test(release.commit||''))problems.push('release commit is not a full SHA');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(release.date||'')||Number.isNaN(Date.parse(`${release.date}T00:00:00Z`))||release.date>today)
    problems.push('release date is missing, invalid or in the future');
  if(typeof release.stage!=='string'||!release.stage.trim())problems.push('release stage is not recorded');
  const runtime=baseline.runtime&&typeof baseline.runtime==='object'?baseline.runtime:{};
  if(!sameSet(Object.keys(runtime),RUNTIME_FILES))problems.push('runtime must list exactly the nine runtime files');
  else for(const name of RUNTIME_FILES)if(!/^[0-9a-f]{64}$/.test(runtime[name]||''))problems.push(`runtime hash for ${name} is not a SHA-256`);
  const recorded=baseline.budgets&&typeof baseline.budgets==='object'?baseline.budgets:{};
  if(!sameSet(Object.keys(recorded),TIMING_BUDGETS))problems.push('budgets must record exactly the five timing budgets');
  else for(const key of TIMING_BUDGETS)if(recorded[key]!==budgets[key])problems.push(`budget ${key} ${recorded[key]} differs from the policy's ${budgets[key]}`);
  const passes=Array.isArray(baseline.passes)?baseline.passes:[],aliases=new Set();
  if(!passes.length)problems.push('no real pass is recorded');
  for(const pass of passes){
    if(typeof pass?.alias!=='string'||!/^[a-z0-9.-]+$/.test(pass.alias)||aliases.has(pass.alias)){problems.push(`pass alias ${pass?.alias} is invalid or repeated`);continue;}
    aliases.add(pass.alias);
    if(!pass.profiles||!sameSet(Object.keys(pass.profiles),['desktop','mobile'])){problems.push(`${pass.alias} must record exactly desktop and mobile`);continue;}
    for(const profile of ['desktop','mobile'])for(const [metric,rule] of Object.entries(TIMING)){
      const value=pass.profiles[profile]?.[metric],budget=budgets[rule.budget(profile)];
      if(typeof value!=='number'||!Number.isFinite(value)||value<0)problems.push(`${pass.alias} ${profile} ${metric} is not a measured value`);
      else if(value>budget)problems.push(`${pass.alias} ${profile} ${metric} ${value} is over its ${budget} budget, so it records no pass`);
    }
  }
  return problems;
}

/* Every condition must hold, checked against the published mirror read-only. Any doubt refuses. */
function evaluateCarryForward({baseline,disk,served,mirror}){
  const refuse=reason=>({ok:false,reason});
  const changed=RUNTIME_FILES.filter(name=>disk?.[name]!==baseline.runtime[name]);
  if(changed.length)return refuse(`the game runtime changed since the baseline pass (${changed.join(', ')}); changed game code needs a real full pass`);
  const unserved=RUNTIME_FILES.filter(name=>served?.[name]!==disk?.[name]);
  if(unserved.length)return refuse(`the served runtime differs from disk (${unserved.join(', ')})`);
  if(!mirror||mirror.unavailable)return refuse(`the published mirror is unavailable${mirror?.unavailable?` (${mirror.unavailable})`:''}`);
  let remote;
  try{remote=mirror.remoteMain();}catch(error){return refuse(`the published remote main could not be established: ${error.message}`);}
  try{
    const remoteDiff=RUNTIME_FILES.filter(name=>mirror.blob(remote,name)!==disk[name]);
    if(remoteDiff.length)return refuse(`the runtime differs from published remote main ${remote.slice(0,12)} (${remoteDiff.join(', ')})`);
    const commit=baseline.release.commit;
    if(!mirror.isAncestor(commit,remote))return refuse(`baseline release ${commit.slice(0,12)} is not in published remote main ${remote.slice(0,12)}`);
    if(mirror.commitDay(commit)!==baseline.release.date)return refuse(`baseline date ${baseline.release.date} is not the commit date of release ${commit.slice(0,12)}`);
    const releaseDiff=RUNTIME_FILES.filter(name=>mirror.blob(commit,name)!==baseline.runtime[name]);
    if(releaseDiff.length)return refuse(`baseline hashes do not match release ${commit.slice(0,12)} (${releaseDiff.join(', ')})`);
  }catch(error){return refuse(`the baseline could not be checked against the published mirror: ${error.message}`);}
  return {ok:true,remote};
}

function describeTiming(item){return `${item.profile} ${TIMING[item.metric].label} ${ms(item.value)} over its ${ms(item.budget)} budget`;}

/* The single verdict, used by the run and by the controls below. Order matters: a broken baseline or any
   non-timing failure is decided before timing, so the carry-forward can never absorb a real failure. */
function classifyGamePerformance({failures=[],timing=[],baselineProblems=[],baseline,disk,served,mirror}){
  if(baselineProblems.length)return {exit:1,result:'RESULT: FAIL - the game-performance baseline is missing, corrupt or inconsistent; nothing can be carried forward.',
    lines:baselineProblems.map(problem=>`  - baseline: ${problem}`)};
  const overBudget=timing.map(item=>`  - over budget: ${describeTiming(item)}`);
  if(failures.length)return {exit:1,result:`RESULT: FAIL - ${failures[0]}`,
    lines:[...failures.map(failure=>`  - failed: ${failure}`),...overBudget.map(line=>`${line} (not carried forward: another check failed)`)]};
  if(!timing.length)return {exit:0,result:PASS_RESULT,lines:[]};
  const carry=evaluateCarryForward({baseline,disk,served,mirror});
  if(!carry.ok)return {exit:1,result:`RESULT: FAIL - ${timing.length} timing reading(s) over budget, and the unchanged-game carry-forward does not apply: ${carry.reason}.`,lines:overBudget};
  const release=baseline.release;
  return {exit:EXIT_CARRY_FORWARD,
    result:`RESULT: PASSED WITH TIMING CARRY-FORWARD - unchanged game runtime (9/9 files identical on disk, as served, in the baseline and in published remote main ${carry.remote.slice(0,12)}); `
      +`${timing.length} timing reading(s) over budget on this host are carried forward from the ${release.date} baseline pass and are not a timing pass. Every functional, byte, transfer and resource check passed.`,
    lines:timing.map(item=>`  - carry-forward: ${describeTiming(item)}; baseline pass ${release.commit.slice(0,12)} (${release.date}, ${release.stage}): `
      +baseline.passes.map(pass=>`${pass.alias} ${ms(pass.profiles[item.profile][item.metric])}`).join(', '))};
}

/* Executable proof of the rule on every run, against synthetic records and an in-memory mirror. */
function carryForwardControls(){
  const hash=label=>sha256(Buffer.from(label));
  const release='a'.repeat(40),head='b'.repeat(40);
  const runtime=Object.fromEntries(RUNTIME_FILES.map(name=>[name,hash(name)]));
  const profiles=()=>({desktop:{landingInteractiveMs:80,startupMs:900,frameP95Ms:16.9},mobile:{landingInteractiveMs:350,startupMs:4500,frameP95Ms:17}});
  const baseline={schemaVersion:1,kind:'game-performance-baseline',release:{commit:release,date:'2026-09-27',stage:'fixture postflight'},runtime,
    budgets:Object.fromEntries(TIMING_BUDGETS.map(key=>[key,b[key]])),
    passes:[{alias:'peterxing.com',profiles:profiles()},{alias:'post-agi-planning.vercel.app',profiles:profiles()}]};
  const mirror=(overrides={})=>({remoteMain:()=>head,isAncestor:(commit,tip)=>commit===release&&tip===head,
    commitDay:commit=>commit===release?'2026-09-27':'2026-10-01',blob:(commit,name)=>runtime[name],...overrides});
  const slow=[{profile:'mobile',metric:'startupMs',value:9110,budget:b.mobileStartMs}];
  const changedDisk={...runtime,'game-world.mjs':hash('changed')};
  const base={timing:slow,baseline,disk:{...runtime},served:{...runtime},mirror:mirror()};
  const withPass=(edit)=>({...baseline,passes:[{alias:'peterxing.com',profiles:edit(profiles())}]});
  const checks=[
    ['an identical runtime with a timing-only miss warns (70)',{},70],
    ['all checks passing is a pass (0)',{timing:[]},0],
    ['a functional failure is never carried (1)',{failures:['No frames were rendered during the measured window.']},1],
    ['cold transfer over budget is never carried (1)',{failures:[`Complete cold transfer ${b.coldTransferredBytes+1} exceeds allowance.`]},1],
    ['a changed runtime needs a real pass, even once published and served (1)',
      {disk:changedDisk,served:changedDisk,mirror:mirror({blob:(commit,name)=>commit===head?changedDisk[name]:runtime[name]})},1],
    ['served bytes that differ from disk are refused (1)',{served:{...runtime,'game.css':hash('cached')}},1],
    ['a runtime that differs from the published remote main is refused (1)',
      {mirror:mirror({blob:(commit,name)=>commit===head&&name==='game-ui.mjs'?hash('remote'):runtime[name]})},1],
    ['a missing baseline is refused (1)',{baselineProblems:validateBaseline(null)},1],
    ['a corrupt baseline is refused (1)',{baselineProblems:validateBaseline({...baseline,runtime:{...runtime,'game.html':'not-a-hash'}})},1],
    ['a baseline that does not match its release commit is refused (1)',
      {mirror:mirror({blob:(commit,name)=>commit===release&&name==='three.core.min.js'?hash('old'):runtime[name]})},1],
    ['a baseline dated off its release commit is refused (1)',{mirror:mirror({commitDay:()=>'2026-09-28'})},1],
    ['a baseline release outside the published history is refused (1)',{mirror:mirror({isAncestor:()=>false})},1],
    ['an unreachable published remote is refused (1)',{mirror:mirror({remoteMain:()=>{throw new Error('ls-remote failed');}})},1],
    ['a missing published mirror is refused (1)',{mirror:{unavailable:'fixture'}},1],
    ['a baseline recording an over-budget reading is refused (1)',{baselineProblems:validateBaseline(withPass(p=>({...p,mobile:{...p.mobile,startupMs:b.mobileStartMs+1}})))},1],
    ['a baseline with different budgets is refused (1)',{baselineProblems:validateBaseline({...baseline,budgets:{...baseline.budgets,mobileStartMs:b.mobileStartMs*2}})},1],
    ['a future-dated baseline is refused (1)',{baselineProblems:validateBaseline({...baseline,release:{...baseline.release,date:'2999-01-01'}})},1],
  ];
  const failed=[];
  if(validateBaseline(baseline).length)failed.push('the valid fixture baseline was refused');
  for(const [name,edit,expected] of checks){
    const verdict=classifyGamePerformance({...base,...edit});
    if(verdict.exit!==expected)failed.push(`${name}: exit ${verdict.exit}`);
  }
  const warned=classifyGamePerformance(base);
  if(!['9110 ms',`${b.mobileStartMs} ms`,release.slice(0,12),'2026-09-27','peterxing.com 4500 ms','post-agi-planning.vercel.app 4500 ms']
    .every(part=>warned.lines.join(' ').includes(part)))failed.push('the warning does not name the metric, value, budget and baseline pass');
  const readings=[];
  for(const [value,throws] of [[Number.NaN,true],[-1,true],[null,true],[b.mobileStartMs,false],[b.mobileStartMs+1,false]]){
    let threw=false;
    try{recordTiming(readings,'mobile','startupMs',value);}catch{threw=true;}
    if(threw!==throws)failed.push(`a startup reading of ${value} ${throws?'was accepted':'was refused'}`);
  }
  if(readings.length!==1||readings[0].value!==b.mobileStartMs+1)failed.push('only an over-budget reading is recorded as a timing miss');
  return {total:checks.length+4,failed};
}

/* Read-only view of the published mirror. Remote main is read with ls-remote; its blobs are read locally, which is
   exact because Git objects are content-addressed. A remote commit the mirror does not hold refuses. */
function publishedMirror(checkout=process.env.PAP_GAME_MIRROR||process.env.PAP_NEWS_MIRROR||path.resolve(ROOT,'..','pap-github')){
  if(!fs.existsSync(path.join(checkout,'.git')))return {unavailable:`no published mirror checkout at ${checkout}`};
  const readOnly=new Set(['rev-parse','cat-file','merge-base','log','ls-remote']);
  const git=args=>{
    if(!readOnly.has(args[0]))throw new Error(`refusing non-read git ${args[0]}`);
    return execFileSync('git',['-C',checkout,...args],{maxBuffer:1<<28,timeout:60000,windowsHide:true,
      stdio:['ignore','pipe','pipe'],env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});
  };
  return {
    remoteMain(){
      const remote=git(['ls-remote','--exit-code','origin','refs/heads/main']).toString().trim().split(/\s+/)[0];
      if(!/^[0-9a-f]{40}$/.test(remote))throw new Error('ls-remote returned no main commit');
      try{git(['cat-file','-e',`${remote}^{commit}`]);}
      catch{throw new Error(`published remote main ${remote.slice(0,12)} is not in the local mirror; refresh its tracking ref`);}
      return remote;
    },
    isAncestor(commit,tip){try{git(['merge-base','--is-ancestor',commit,tip]);return true;}catch{return false;}},
    commitDay(commit){return new Date(git(['log','-1','--format=%cI',`${commit}^{commit}`]).toString().trim()).toISOString().slice(0,10);},
    blob(commit,name){return sha256(git(['cat-file','blob',`${commit}:${name}`]));},
  };
}

async function servedRuntime(){
  const served={};
  for(const name of RUNTIME_FILES){
    try{
      const response=await fetch(`${BASE}${name==='game.html'?'/game':`/${name}`}`,{cache:'no-store',signal:AbortSignal.timeout(30000)});
      if(response.status!==200||new URL(response.url).origin!==new URL(BASE).origin)throw new Error(`HTTP ${response.status} from ${response.url}`);
      served[name]=sha256(Buffer.from(await response.arrayBuffer()));
    }catch(error){served[name]=`unavailable: ${error.message}`;}
  }
  return served;
}

async function measure(timing,reports) {
  const names=[...policy.baseFiles,...policy.canonicalDataFiles];
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
  try {
    for(const mobile of [false,true]) {
      const profile=mobile?'mobile':'desktop';
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
        window.baseStartupStages=[];
        document.addEventListener('DOMContentLoaded',()=>{
          let previous='';
          new MutationObserver(()=>{
            const text=document.querySelector('.game-brand small')?.textContent;
            if(text&&text!==previous){window.baseStartupStages.push({text,at:performance.now()});previous=text;}
          }).observe(document.body,{childList:true,subtree:true,characterData:true});
        });
      });
      const page=await context.newPage(),session=await context.newCDPSession(page),pageErrors=[];
      page.on('pageerror',error=>pageErrors.push(error.message));
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
      recordTiming(timing,profile,'landingInteractiveMs',landing.interactive);
      assert(landing.transfer<=b.landingTransferredBytes,`Game landing transfer ${landing.transfer} exceeds budget.`);
      assert(!landing.requests.some(url=>/\/(?:three\.|game-(?:world|core|data|ui))/.test(url)),'Renderer/campaign was fetched before Start.');
      const start=Date.now(),monotonicStart=performance.now();
      const browserStart=await page.evaluate(()=>performance.now());
      await page.locator('#startGame').click();
      await page.evaluate(async()=>{window.readGamePerformance=(await import('/game-ui.mjs')).getCampaignSnapshot;});
      await page.waitForFunction(()=>Boolean(window.readGamePerformance?.()?.backend.renderedFrames));
      const startup=Date.now()-start;
      const startupPhases=await page.evaluate(()=>({stages:window.baseStartupStages,
        resources:performance.getEntriesByType('resource').map(r=>({name:r.name,start:r.startTime,end:r.responseEnd,transfer:r.transferSize})),
        metrics:window.readGamePerformance().backend}));
      const startupDiagnostic={profile:mobile?'mobile 4x CPU / 4Mbps / 150ms RTT':'desktop',startup,
        monotonicMs:performance.now()-monotonicStart,browserStart,...startupPhases};
      if(startup>(mobile?b.mobileStartMs:b.desktopStartMs)){
        console.log(JSON.stringify(startupDiagnostic,null,2));
        if(process.env.PAP_GAME_PERFORMANCE_RECEIPT)fs.writeFileSync(process.env.PAP_GAME_PERFORMANCE_RECEIPT+'.startup-failure.json',JSON.stringify(startupDiagnostic,null,2)+'\n');
      }
      recordTiming(timing,profile,'startupMs',startup);
      if(mobile) {
        await session.send('Emulation.setCPUThrottlingRate',{rate:1});
        await session.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
      }
      await page.waitForTimeout(3200);
      let metrics=await page.evaluate(()=>window.readGamePerformance().backend);
      assert(['WebGPU','WebGL2'].includes(metrics.backend),'Fallback cannot satisfy a rendering performance proof.');
      assert(metrics.lost===false&&metrics.disposed===false&&metrics.running===true,'The renderer was lost, disposed or stopped during the measured window.');
      assert(Number.isInteger(metrics.renderedFrames)&&metrics.renderedFrames>startupPhases.metrics.renderedFrames,'No frames were rendered during the measured window.');
      assert(metrics.drawCalls<=(mobile?b.mobileDrawCalls:b.desktopDrawCalls),'Draw-call budget exceeded.');
      assert(metrics.triangles<=(mobile?b.mobileTriangles:b.desktopTriangles),'Triangle budget exceeded.');
      recordTiming(timing,profile,'frameP95Ms',metrics.frameP95);
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
      assert.deepEqual(pageErrors,[],'An unhandled page exception occurred during the measured run.');
      reports.push({profile:mobile?'390px touch / startup 4x CPU, 4Mbps, 150ms RTT; frame samples unthrottled':'1440px desktop',
        landing,startup,startupDiagnostic,metrics,dom,transfer,heap,responseP95,cycleGrowth});
      await context.close();
    }
  } finally {await browser.close();}
  return {declaredBaseAssets:assets,decoded,gzip,maintained};
}

async function run({root=ROOT,measureImpl=measure,servedImpl=servedRuntime,mirrorImpl=publishedMirror,
  log=console.log,receipt=process.env.PAP_GAME_PERFORMANCE_RECEIPT}={}) {
  const controls=carryForwardControls();
  if(controls.failed.length){
    controls.failed.forEach(failure=>log(`  - control failed: ${failure}`));
    const verdict={exit:1,result:'RESULT: FAIL - the unchanged-game timing carry-forward did not behave as specified; no verdict.',lines:[]};
    log(verdict.result);return verdict;
  }
  log(`Carry-forward controls: ${controls.total}/${controls.total} (timing-only miss warns; functional, transfer, changed, served or remote runtime, `
    +'missing, corrupt or inconsistent baseline and unexpected readings refused).');
  let baseline=null;const baselineProblems=[];
  try{baseline=JSON.parse(fs.readFileSync(path.join(root,'game-performance-baseline.json'),'utf8'));}
  catch(error){baselineProblems.push(`it cannot be read: ${String(error.message).split('\n')[0]}`);}
  if(!baselineProblems.length)baselineProblems.push(...validateBaseline(baseline));
  if(baselineProblems.length){
    const verdict=classifyGamePerformance({baselineProblems});
    verdict.lines.forEach(line=>log(line));log(verdict.result);return verdict;
  }
  const timing=[],failures=[],reports=[];let summary={};
  try{summary=await measureImpl(timing,reports);}catch(error){failures.push(String(error?.message||error).split('\n')[0]);}
  const disk=Object.fromEntries(RUNTIME_FILES.map(name=>[name,sha256(fs.readFileSync(path.join(root,name)))]));
  const needsCarry=timing.length>0&&failures.length===0;
  const served=needsCarry?await servedImpl():null,mirror=needsCarry?mirrorImpl():null;
  const verdict=classifyGamePerformance({failures,timing,baselineProblems,baseline,disk,served,mirror});
  const result={...summary,reports,runtime:disk,timing,verdict};
  if(receipt)fs.writeFileSync(receipt,JSON.stringify(result,null,2)+'\n');
  log(JSON.stringify(result,null,2));
  verdict.lines.forEach(line=>log(line));
  log(verdict.result);
  return verdict;
}
async function main() {
  const selectors=process.argv.slice(2).filter(value=>value.startsWith('--'));
  assert(selectors.length===0,'The complete active base-game profile has no optional selector.');
  process.exitCode=(await run()).exit;
}
module.exports={RUNTIME_FILES,recordTiming,validateBaseline,evaluateCarryForward,classifyGamePerformance,carryForwardControls,publishedMirror,run};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
