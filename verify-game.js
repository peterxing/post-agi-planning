'use strict';
if (require.main === module) require('./pipeline-lock').guard('verify:game');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const BASE = (process.env.PAP_SITE_URL || process.argv.find(value=>/^https?:\/\//.test(value)) || 'http://127.0.0.1:8787').replace(/\/$/,'');
const ROOT = __dirname;
const selections = new Set(process.argv.slice(2).filter(value=>value.startsWith('--')));
for(const flag of selections)assert(['--unit','--smoke','--campaign','--storage','--refresh','--loss'].includes(flag),`Unknown game test selector: ${flag}`);
const selected = name => selections.size===0 || selections.has('--'+name);
const screenshots = process.env.PAP_GAME_SCREENSHOTS || '';
const read = name => JSON.parse(fs.readFileSync(path.join(ROOT,name),'utf8'));
const snapshot = page => page.evaluate(async()=> (await import('/game-ui.mjs')).getCampaignSnapshot());
async function ready(page) {
  await page.evaluate(async()=>{window.readTestCampaign=(await import('/game-ui.mjs')).getCampaignSnapshot;});
  await page.waitForFunction(()=>Boolean(window.readTestCampaign?.()) || document.getElementById('gameLoadStatus')?.classList.contains('error'));
  const value=await snapshot(page);
  assert(value,await page.locator('#gameLoadStatus').textContent());
  return value;
}

function workPayload(item) {
  const task=item.task;
  if(task.kind==='relay')return{selection:task.goal};
  if(task.kind==='placement')return{selection:0};
  if(task.kind==='survey')return{};
  if(task.kind==='routing')return{routes:[...task.goal]};
  if(task.kind==='interlocks')return{checks:task.labels.map(()=>true)};
  if(task.kind==='frontier')return{selection:0,boundaries:true};
  if(task.kind==='allocation') {
    const units=task.labels.map((_,index)=>task.minimums?.[index]||0);
    let remaining=task.points-units.reduce((a,b)=>a+b,0),index=0;
    while(remaining-->0)units[index++%units.length]++;
    return{units};
  }
  throw new Error('Unknown work fixture type.');
}

function deriveTraces(core) {
  const found={};
  let randomState=812901;
  const random=()=>{randomState^=randomState<<13;randomState^=randomState>>>17;randomState^=randomState<<5;return(randomState>>>0)/4294967296;};
  for(let attempt=0;attempt<6000&&Object.keys(found).length<6;attempt++) {
    let state=core.createCampaign(Object.keys(core.PROFILES)[attempt%4],42);
    for(const item of core.MISSIONS) {
      assert(core.availableMissions(state).some(row=>row.id===item.id),'Main objective is unreachable.');
      state=core.dispatch(state,{type:'visit',region:item.region});
      if(item.task.kind==='survey')for(const region of item.task.regions)state=core.dispatch(state,{type:'visit',region});
      state=core.dispatch(state,{type:'operate',mission:item.id,payload:workPayload(item)});
      const choices=item.choices.filter(choice=>core.previewChoice(state,item.id,choice.id).allowed);
      assert(choices.length,'No affordable path through an objective.');
      state=core.dispatch(state,{type:'choose',mission:item.id,choice:choices[Math.floor(random()*choices.length)].id});
    }
    const ending=core.endingFor(state);
    assert.equal(Object.keys(state.decisions).length,13);
    assert.deepEqual(core.replayActions(state.profile,state.seed,core.checkpointActions(state)),state);
    found[ending.key] ||= {profile:state.profile,decisions:state.decisions,state};
  }
  assert.equal(Object.keys(found).length,6,'Every ending needs a replayable full-campaign path.');
  return found;
}

async function unit(core) {
  const {validateBundle}=await import('./game-data.mjs');
  const inputs={predictions:read('predictions.json'),signals:read('signals.json'),author:read('author.json'),content:read('game-content.json')};
  const bundle=await validateBundle(inputs);
  assert.equal(bundle.rows.length,bundle.content.coverage.forecasts);
  const traces=deriveTraces(core);
  const changed=structuredClone(inputs);
  changed.signals.context.items[Object.keys(changed.signals.embeds)[0]]=Object.values(changed.signals.embeds)[0];
  await assert.rejects(()=>validateBundle(changed),/exactly one/);
  const foreign=structuredClone(inputs);foreign.signals.forecastVersion.sha256='0'.repeat(64);
  await assert.rejects(()=>validateBundle(foreign),/versions differ/);
  const badReference=structuredClone(inputs);
  delete badReference.signals.referencePoints.items[bundle.rows[0].id];
  await assert.rejects(()=>validateBundle(badReference),/reference coverage/i);
  let state=core.dispatch(core.createCampaign(),{type:'visit',region:'commons'});
  assert.throws(()=>core.dispatch(state,{type:'operate',mission:'M00',payload:{selection:0}}),/disconnected/);
  state=core.dispatch(state,{type:'operate',mission:'M00',payload:{selection:2}});
  const open=core.dispatch(state,{type:'choose',mission:'M00',choice:'open'});
  const production=core.dispatch(state,{type:'choose',mission:'M00',choice:'direct'});
  assert.equal(open.resources.access,29);
  assert.notDeepEqual(open.resources,production.resources);
  assert.throws(()=>core.dispatch(open,{type:'choose',mission:'M12',choice:'share'}),/prerequisites/);
  console.log(`Game unit: ${bundle.rows.length} source identities, invalid/mixed channel refusals, ${Object.keys(traces).length} reachable/replayed endings.`);
  return traces;
}

async function enter(page,{mode='3d',profile='balanced',resume=false}={}) {
  await page.goto(BASE+'/game?scoutTheme=light');
  await page.locator('#campaignProfile').selectOption(profile);
  await page.locator(resume?'#resumeGame':mode==='accessible'?'#startAccessible':'#startGame').click();
  await ready(page);
}

async function operate(page,item) {
  const task=item.task;
  if(task.kind==='relay')await page.locator('#stationSelection').selectOption(String(task.goal));
  else if(task.kind==='placement')await page.locator('#stationSelection').selectOption('0');
  else if(task.kind==='routing') {
    for(let index=0;index<task.goal.length;index++) {
      const control=page.locator(`[data-route-switch="${index}"]`);
      if(await control.textContent()!==task.labels[index][task.goal[index]])await control.click();
    }
  } else if(task.kind==='allocation')await page.locator('#balanceStationWork').click();
  else if(task.kind==='interlocks') {
    for(let index=0;index<task.labels.length;index++)await page.locator(`[data-work-check="${index}"]`).check();
  } else if(task.kind==='frontier') {
    await page.locator('#stationSelection').selectOption('0');
    await page.locator('#frontierBoundaries').check();
  }
  await page.locator('#commitStationWork').click();
}

async function playTrace(page,core,trace) {
  for(const item of core.MISSIONS) {
    await page.locator('#gameTravel').click();
    await page.locator(`#gameDialog [data-travel="${item.region}"]`).click();
    const select=page.locator('#gameObjectiveSelect');
    if(await select.isVisible()) {
      await page.locator('#closeGameDialog').click();
      await select.selectOption(item.id);
      await page.locator('#gameInteract').click();
    }
    assert.match(await page.locator('#gameDialog').textContent(),new RegExp(item.title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    await operate(page,item);
    const choice=page.locator(`[data-choice="${trace.decisions[item.id]}"]`);
    await choice.click();
    await choice.click();
    await page.waitForFunction(id=>Boolean(window.readTestCampaign?.()?.state.decisions[id]),item.id);
  }
  const final=await snapshot(page);
  assert.deepEqual(final.state.resources,trace.state.resources,'Browser decisions did not apply the complete allocation/conditional/net effects.');
  assert.equal(final.state.ended,true);
  assert.equal(Object.keys(final.state.decisions).length,13);
  assert.equal(await page.locator('#gameEnding').textContent(),core.endingFor(trace.state).title);
}

async function smoke(browser) {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>requests.push(request.url()));
  await page.goto(BASE+'/');
  await page.waitForTimeout(300);
  assert(!requests.some(url=>/\/(?:game-|three\.)/.test(url)),'The original root loads game/renderer code.');
  requests.length=0;
  await page.goto(BASE+'/game');
  await page.waitForTimeout(200);
  assert(!requests.some(url=>/\/(?:three\.|game-(?:ui|data|world|core))/.test(url)),'The game landing eagerly loaded the campaign or renderer.');
  await page.locator('#startGame').click();
  const initial=await ready(page);
  assert(['WebGPU','WebGL2'].includes(initial.backend.backend),'Genuine 3D did not initialize.');
  await page.locator('#gameCanvas').focus();
  await page.keyboard.down('w');await page.waitForTimeout(200);await page.keyboard.up('w');
  await page.locator('#gameTravel').click();await page.locator('[data-travel="commons"]').click();
  await page.locator('#stationSelection').selectOption('2');await page.locator('#commitStationWork').click();
  await page.locator('[data-choice="open"]').click();await page.locator('[data-choice="open"]').click();
  assert.equal((await snapshot(page)).state.resources.access,29);
  await page.locator('#gameArchive').click();
  assert.equal(await page.locator('[data-chapter]').count(),13);
  await page.locator('[data-chapter="8"]').click();
  assert.match(await page.locator('[data-book-chapter="8"]').textContent(),/three clocks/i);
  await page.locator('#closeGameDialog').click();
  await page.locator('#gameSources').click();
  assert.match(await page.locator('#gameDialog').textContent(),/human-expert minutes/i);
  await page.locator('#closeGameDialog').click();
  await page.locator('#gamePause').click();
  assert.equal((await snapshot(page)).backend.running,false);
  await page.keyboard.press('Escape');
  assert.equal((await snapshot(page)).paused,false);
  if(screenshots){fs.mkdirSync(screenshots,{recursive:true});await page.screenshot({path:path.join(screenshots,'campaign-full-desktop.png')});}
  await page.reload();await page.locator('#resumeGame').click();
  await ready(page);
  await page.waitForFunction(()=>Boolean(window.readTestCampaign?.()?.state.decisions.M00));
  assert.equal((await snapshot(page)).state.resources.access,29);
  await page.locator('#gamePause').click();await page.locator('#exitCampaign').click();
  assert.equal(await page.locator('canvas').count(),0);
  assert.equal(await snapshot(page),null);
  assert.deepEqual(errors,[]);
  await context.close();
  console.log(`Game smoke: lazy entry/root isolation, genuine ${initial.backend.backend}, task/choice, full chapter, source/METR bridge, pause, save/resume and exit.`);
}

async function campaigns(browser,core,traces) {
  for(const [name,width,mode,traceKey] of [
    ['desktop-campaign',1440,'3d','shared'],['mobile-campaign',390,'3d','concentrated'],['narrow-accessible-campaign',320,'accessible','control'],
  ]) {
    const context=await browser.newContext({viewport:{width,height:width<720?844:1000},hasTouch:width<720,isMobile:width<720,reducedMotion:width===320?'reduce':'no-preference'});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await enter(page,{mode,profile:traces[traceKey].profile});
    if(mode==='3d')assert(['WebGPU','WebGL2'].includes((await snapshot(page)).backend.backend),'3D campaign started in fallback.');
    await playTrace(page,core,traces[traceKey]);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false,'Campaign has horizontal overflow.');
    if(screenshots)await page.screenshot({path:path.join(screenshots,`campaign-${name}-ending.png`)});
    assert.deepEqual(errors,[]);
    await context.close();console.log(`${name}: thirteen actual UI objectives and ${traceKey} ending.`);
  }
}

async function storageCases(browser) {
  for(const kind of ['corrupt','denied','quota']) {
    const context=await browser.newContext({viewport:{width:390,height:844}});
    await context.addInitScript(mode=>{
      if(mode==='corrupt')localStorage.setItem('pap-branch-campaign:v1','{invalid');
      if(mode==='denied')Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Blocked','SecurityError');}});
      if(mode==='quota')Storage.prototype.setItem=function(){throw new DOMException('Full','QuotaExceededError');};
    },kind);
    const page=await context.newPage();await enter(page,{mode:'accessible'});
    assert.equal((await snapshot(page)).storageMode,'session');
    assert.match(await page.locator('#gameStorageStatus').textContent(),/Session only/i);
    if(kind==='corrupt')assert.equal(await page.evaluate(()=>localStorage.getItem('pap-branch-campaign:v1')),'{invalid');
    await context.close();
  }
  const context=await browser.newContext(),page=await context.newPage();
  await page.goto(BASE+'/game');
  await page.evaluate(()=>localStorage.setItem('pap-mission-control:v1','original planning sentinel'));
  await page.locator('#startAccessible').click();
  await ready(page);
  await page.locator('#gamePause').click();await page.locator('#resetCampaignSave').click();await page.locator('#confirmCampaignReset').click();
  assert.equal(await page.evaluate(()=>localStorage.getItem('pap-mission-control:v1')),'original planning sentinel');
  await context.close();
  console.log('Game storage: corrupt/denied/quota labels and retention; campaign reset preserves original planning key.');
}

async function refreshCases(browser,core) {
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();await enter(page,{mode:'accessible'});
  await page.clock.install();
  const original=read('signals.json'),newer=structuredClone(original);
  newer.updated=new Date(Date.parse(original.updated)+60000).toISOString();
  await page.route('**/signals.json',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(newer)}));
  await page.locator('#gameSources').click();await page.locator('#checkGameSources').click();
  await page.waitForFunction(()=>window.readTestCampaign().pendingUpdate);
  assert.equal((await snapshot(page)).sourcePublishedAt,original.updated,'An open source inspector was silently replaced.');
  await page.locator('#closeGameDialog').click();
  assert.equal((await snapshot(page)).sourcePublishedAt,newer.updated);
  await page.clock.fastForward(16000);
  await page.unroute('**/signals.json');
  const invalid=structuredClone(newer);invalid.forecastVersion.sha256='0'.repeat(64);
  await page.route('**/signals.json',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(invalid)}));
  await page.locator('#gameSources').click();await page.locator('#checkGameSources').click();
  await page.waitForFunction(()=>document.getElementById('gameUpdateStatus').textContent.includes('Update unavailable'));
  assert.equal((await snapshot(page)).sourcePublishedAt,newer.updated,'Invalid version overwrote the last good bundle.');
  await context.close();

  const {extractCanonical,buildProjection}=require('./game-source');
  const canonical=await extractCanonical(fs.readFileSync(path.join(ROOT,'index.html'),'utf8'),fs.readFileSync(path.join(ROOT,'app.js'),'utf8'));
  const mapping=read('game-map.json');mapping.mappings[0].recordSha256='0'.repeat(64);
  const paused=buildProjection({canonical,predictions:read('predictions.json'),author:read('author.json'),mapping,core});
  const reviewContext=await browser.newContext(),reviewPage=await reviewContext.newPage();
  await reviewPage.route('**/game-content.json',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(paused)}));
  await enter(reviewPage,{mode:'accessible'});
  assert.equal((await snapshot(reviewPage)).readonly,true);
  assert.equal(await reviewPage.locator('canvas').count(),0);
  assert.match(await reviewPage.locator('#gameObjectiveTitle').textContent(),/paused/);
  await reviewContext.close();
  console.log('Game refresh: focus-safe pending update, last-good retention on mismatch, and explicit gameplay-only review pause.');
}

async function lossCases(browser) {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addInitScript(()=>{
    if(typeof GPUAdapter==='undefined')return;
    const request=GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice=async function(...args){const device=await request.apply(this,args);window.nativeGameTestDevice=device;return device;};
  });
  const page=await context.newPage();await enter(page);
  const originalBackend=(await snapshot(page)).backend.backend;
  await page.locator('#gameTravel').click();await page.locator('#gameDialog [data-travel="commons"]').click();
  await page.locator('#stationSelection').selectOption('2');await page.locator('#commitStationWork').click();
  await page.locator('[data-choice="open"]').click();await page.locator('[data-choice="open"]').click();
  if(originalBackend==='WebGPU')await page.evaluate(()=>window.nativeGameTestDevice.destroy());
  else await page.evaluate(()=>document.getElementById('gameCanvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
  await page.waitForFunction(()=>window.readTestCampaign()?.backend.backend==='accessible');
  assert.equal((await snapshot(page)).state.decisions.M00,'open');
  await page.getByRole('button',{name:'Try WebGL2 compatibility',exact:true}).click();
  await page.waitForFunction(()=>window.readTestCampaign()?.backend.backend==='WebGL2');
  assert.equal((await snapshot(page)).state.resources.access,29);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  assert.equal((await snapshot(page)).backend.running,false);
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  assert.equal((await snapshot(page)).paused,true,'Hidden-tab pause silently resumed.');
  await page.locator('#resumePausedGame').click();
  assert.equal((await snapshot(page)).paused,false);
  await context.close();
  const unavailable=await browser.newContext(),fallback=await unavailable.newPage();
  await unavailable.addInitScript(()=>{
    Object.defineProperty(navigator,'gpu',{get:()=>undefined});
    const get=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){return ['webgl','webgl2','webgpu'].includes(type)?null:get.call(this,type,...args);};
  });
  await enter(fallback);
  assert.equal((await snapshot(fallback)).backend.backend,'accessible');
  assert.match(await fallback.locator('#gameFallback').textContent(),/3D unavailable/);
  await unavailable.close();
  console.log(`Game rendering: actual ${originalBackend} loss retains choices, explicit WebGL2 recovery, hidden-tab pause and no-graphics accessible fallback.`);
}

async function main() {
  const core=await import('./game-core.mjs');
  const traces=await unit(core);
  if(selections.size===1 && selections.has('--unit'))return;
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    if(selected('smoke'))await smoke(browser);
    if(selected('campaign'))await campaigns(browser,core,traces);
    if(selected('storage'))await storageCases(browser);
    if(selected('refresh'))await refreshCases(browser,core);
    if(selected('loss'))await lossCases(browser);
  } finally {await browser.close();}
  console.log('RESULT: PASS - selected game behavior checks completed.');
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={workPayload,deriveTraces};
