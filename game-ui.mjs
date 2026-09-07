import {
  createCampaign,dispatch,availableMissions,missionFor,regionUnlocked,defaultWork,evaluateWork,previewChoice,
  endingFor,REGIONS,MISSIONS,RESOURCE_LABELS,PROFILES,GameRuleError,
} from './game-core.mjs';
import {
  loadBundle,CampaignStore,GameDataError,safeLink,displayTime,forecastTiming,trajectory,bundleHealth,startPublishedRefresh,BOOK_TAGS,
} from './game-data.mjs';

let activeRuntime = null;
const make = (tag,text,attributes={}) => {
  const node=document.createElement(tag);
  if(text !== null && text !== undefined)node.textContent=String(text);
  for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));
  return node;
};
const paragraph = (text,className='') => make('p',text,className?{class:className}:{});
const button = (text,action,attributes={}) => {
  const node=make('button',text,{type:'button',...attributes});
  node.addEventListener('click',action);
  return node;
};
const anchor = (text,url,channel='reference') => {
  const href=safeLink(url,channel);
  if(!href)return make('span',`${text} (link unavailable)`);
  return make('a',text,{href,...(href.startsWith('/')?{}:{target:'_blank',rel:'noopener noreferrer'})});
};
const announce = text => {document.getElementById('gameAnnouncement').textContent=text;};

function startPrompt(title,text,options,signal) {
  return new Promise(resolve=>{
    const dialog=make('dialog',null,{class:'game-dialog','aria-labelledby':'startPromptTitle'});
    const header=make('div',null,{class:'dialog-head'});
    header.append(make('h2',title,{id:'startPromptTitle'}));
    const body=make('div',null,{class:'dialog-body'});
    body.append(paragraph(text));
    const row=make('div',null,{class:'button-row'});
    let finished=false;
    const close=value=>{
      if(finished)return;finished=true;
      signal?.removeEventListener('abort',cancel);
      dialog.close();dialog.remove();resolve(value);
    };
    const cancel=()=>close('cancel');
    options.forEach(option=>row.append(button(option.label,()=>close(option.value),option.primary?{class:'primary'}:{})));
    body.append(row);dialog.append(header,body);document.body.append(dialog);
    dialog.addEventListener('cancel',event=>{event.preventDefault();cancel();});
    signal?.addEventListener('abort',cancel,{once:true});
    dialog.showModal();
    if(signal?.aborted)cancel();
  });
}

export async function startCampaign(options) {
  if(activeRuntime)throw new GameDataError('Close the current campaign before starting another.');
  const bundle=await loadBundle({signal:options.signal});
  options.signal?.throwIfAborted();
  const store=new CampaignStore();
  let state=createCampaign(options.profile,42),location=null,readonly=bundle.content.coverage.status!=='ready';
  if(!readonly && options.resume) {
    const restored=store.resume(bundle);
    if(['unavailable','incompatible'].includes(restored.kind)) {
      const selection=await startPrompt('Resume is unavailable',restored.message+
        (restored.changedIds?.length?` Changed identities: ${restored.changedIds.join(', ')}.`:''),
        [{label:'Open the current source archive',value:'archive'},{label:'Return',value:'cancel'}],options.signal);
      if(selection!=='archive')return {started:false};
      readonly=true;
    } else {
      if(restored.kind==='rebind') {
        const selection=await startPrompt('Review a publication change',restored.message,
          [{label:'Resume and rebind this game save',value:'resume',primary:true},{label:'Cancel',value:'cancel'}],options.signal);
        if(selection!=='resume')return {started:false};
      }
      state=restored.state;location=restored.location;
    }
  } else if(!readonly && store.saved && !options.resume) {
    const selection=await startPrompt('Start a new campaign?',
      'A new campaign replaces only this game save after successful startup. Your original website planning checklist and watchlist are not changed.',
      [{label:'Start a new campaign',value:'new',primary:true},{label:'Keep the saved campaign',value:'cancel'}],options.signal);
    if(selection!=='new')return {started:false};
  }
  options.signal?.throwIfAborted();
  const runtime=await mountCampaign({...options,bundle,store,state,location,readonly});
  activeRuntime=runtime;
  return {started:true};
}

export function getCampaignSnapshot() {
  return activeRuntime?.snapshot() || null;
}

async function mountCampaign({bundle:initialBundle,store,state:initialState,location:initialLocation,readonly,
  mode,rendererPreference='auto',reducedMotion=false,signal,onExit}) {
  let bundle=initialBundle,state=initialState,world=null,selected=availableMissions(state)[0]?.id||'M12';
  let currentRegion='commons',nearby='',paused=false,disposed=false,initializing=false,graphicsGeneration=0;
  let graphicsController=null,pendingBundle=null,newRevision=null,returnFocus=null,refresh=null;
  let refreshText='',renderMode=readonly?'archive':mode,backendLabel=readonly?'Source archive':'Loading 3D';
  let graphicsError='';
  let savedLocation=initialLocation,archiveTab='book',archiveItem='',confirmedChoice='';
  const drafts=new Map();
  const life=new AbortController();
  const stage=document.getElementById('gameStage'),host=document.getElementById('gameInterface'),sceneHost=document.getElementById('gameSceneHost');
  const landing=document.getElementById('gameLanding');
  stage.hidden=false;landing.hidden=true;host.replaceChildren();host.tabIndex=-1;
  document.querySelector('.game-skip').href='#gameInterface';

  const top=make('header',null,{class:'game-topbar'});
  const brand=make('h1',null,{class:'game-brand'});
  brand.append(make('span','Build the better branch'));
  const badge=make('small','Loading source-bound campaign');brand.append(badge);top.append(brand);
  const objective=make('section',null,{class:'game-objective','aria-labelledby':'gameObjectiveTitle'});
  const objectiveCount=make('div',null,{class:'eyebrow',id:'gameObjectiveCount'});
  const objectiveTitle=make('h2','Your next objective',{id:'gameObjectiveTitle'});
  const objectiveSelect=make('select',null,{id:'gameObjectiveSelect','aria-label':'Choose an available objective'});
  const objectiveNext=make('div',null,{class:'objective-next',id:'gameNextAction'});
  const progress=make('progress',null,{max:MISSIONS.length,value:0,'aria-label':'Campaign objectives completed',id:'gameProgress'});
  objective.append(objectiveCount,objectiveTitle,objectiveNext,objectiveSelect,progress);
  const resources=make('section',null,{class:'game-resources','aria-label':'Fictional coalition systems'});
  const resourceList=make('dl',null,{class:'resource-grid',id:'gameResourceList'});
  resources.append(resourceList,paragraph('Illustrative units, not real-world measurements.','resource-note'));
  const interactBox=make('section',null,{class:'game-nearby'});
  const nearLabel=paragraph('Explore a district path.');
  const interact=button('Interact at station',()=>openStation(nearby),{id:'gameInteract',class:'primary'});
  interactBox.append(nearLabel,interact);
  const storageLabel=make('div',null,{class:'game-storage',id:'gameStorageStatus',role:'status'});
  const update=make('section',null,{class:'game-update',id:'gameUpdateStatus','aria-label':'Published source status'});
  const updateText=paragraph('');
  const applyUpdate=button('Apply source update',()=>applyPending(),{id:'applyGameUpdate'});
  const inspectUpdate=button('Inspect sources',()=>openArchive('sources'));
  update.append(updateText,applyUpdate,inspectUpdate);update.hidden=true;
  const help=make('aside',null,{class:'game-controls-help'});
  help.append(paragraph('WASD / arrows: walk. Drag: orbit. Q/E: turn. Enter: interact. Escape: pause. Travel and station controls also work without precise aiming.'));
  const markers=make('div',null,{class:'world-labels','aria-hidden':'true'});
  const markerNodes=new Map(REGIONS.map(region=>{
    const node=make('span',region.short,{class:'world-label'});node.hidden=true;markers.append(node);return[region.id,node];
  }));
  const dialog=make('dialog',null,{class:'game-dialog','aria-labelledby':'gameDialogTitle',id:'gameDialog'});
  const dialogHead=make('div',null,{class:'dialog-head'});
  const dialogTitle=make('h2','Campaign',{id:'gameDialogTitle',tabindex:-1});
  const dialogBody=make('div',null,{class:'dialog-body'});
  dialogHead.append(dialogTitle,button('Close',()=>closeDialog(),{'aria-label':'Close panel',id:'closeGameDialog'}));
  dialog.append(dialogHead,dialogBody);

  const pauseButton=button('Pause',()=>openPause(),{id:'gamePause'});
  const travelButton=button('Travel',()=>openTravel(),{id:'gameTravel'});
  const archiveButton=button('Archive',()=>openArchive('book'),{id:'gameArchive'});
  const sourceButton=button('Sources',()=>openArchive('sources'),{id:'gameSources'});
  const systemsButton=button('Systems',()=>openSystems(),{id:'gameSystems'});
  const journalButton=button('Journal',()=>openJournal(),{id:'gameJournal'});
  top.append(travelButton,archiveButton,sourceButton,systemsButton,journalButton,pauseButton);
  host.append(top,markers,objective,resources,interactBox,storageLabel,update,help,dialog);

  function syncPause() {world?.setPaused(paused||dialog.open||document.hidden||initializing);}
  function save() {
    if(readonly||disposed||initializing)return;
    if(world)savedLocation=world.getLocation();
    store.save(bundle,state,savedLocation,{reducedMotion,rendererPreference,currentRegion});
    storageLabel.textContent=store.message;
  }
  function openDialog(title,station=false) {
    if(!dialog.open)returnFocus=document.activeElement;
    dialogTitle.textContent=title;dialogBody.replaceChildren();dialogBody.className='dialog-body';
    dialog.dataset.kind=station?'station':'generic';
    dialog.classList.toggle('station-dialog',station);
    if(!dialog.open)dialog.showModal();
    syncPause();save();dialogTitle.focus({preventScroll:true});
  }
  function closeDialog() {
    if(!dialog.open)return;
    if(dialog.dataset.kind==='pause')paused=false;
    dialog.close();confirmedChoice='';
    syncPause();
    const target=returnFocus?.isConnected?returnFocus:archiveButton;
    target.focus({preventScroll:true});
    if(pendingBundle&&!paused)applyPending();
  }
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog();},{signal:life.signal});
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape')return;
    event.preventDefault();
    if(dialog.open)closeDialog();else openPause();
  },{signal:life.signal});

  function renderStatus() {
    badge.textContent=`${backendLabel} / ${readonly?'archive only':PROFILES[state.profile].name}`;
    badge.setAttribute('data-backend',world?.metrics().backend || renderMode);
    storageLabel.textContent=readonly?'Archive only: no game progress is written.':store.message;
    update.hidden=!newRevision&&!pendingBundle&&!refreshText.startsWith('Update unavailable');
    updateText.textContent=newRevision
      ? 'A different forecast or game revision is published. This campaign remains on its older validated snapshot; no choices or probabilities were changed.'
      : pendingBundle ? 'A compatible source update is ready. It will not replace an open decision or source inspector.' : refreshText;
    applyUpdate.hidden=!pendingBundle;
    sourceButton.textContent=newRevision||pendingBundle||refreshText.startsWith('Update unavailable')?'Sources !':'Sources';
    sourceButton.setAttribute('aria-label',update.hidden?'Inspect original published sources':`Inspect sources. ${updateText.textContent}`);
  }
  function renderResources() {
    resourceList.replaceChildren();
    for(const key of ['mandate','power','access','control']) {
      const row=make('div',null,{class:'resource-row'});
      row.append(make('dt',RESOURCE_LABELS[key]),make('dd',state.resources[key],{'data-resource':key}));
      resourceList.append(row);
    }
    resources.hidden=readonly;
  }
  function renderObjective() {
    const available=availableMissions(state),done=Object.keys(state.decisions).length;
    progress.value=done;
    if(readonly) {
      objectiveCount.textContent='Current source archive';
      objectiveTitle.textContent='New campaigns are paused';
      objectiveNext.textContent='Gameplay adaptation needs review. Original content remains available.';
      objectiveSelect.hidden=true;progress.hidden=true;return;
    }
    if(!available.some(item=>item.id===selected))selected=available[0]?.id||'M12';
    const item=missionFor(selected);
    objectiveCount.textContent=`${done} / ${MISSIONS.length} objectives complete`;
    objectiveTitle.textContent=state.ended?endingFor(state).title:`${item.id} / ${item.title}`;
    objectiveNext.textContent=state.ended?'Open the debrief or explore the settlement you built.'
      : state.operations[item.id]?'Next: commit a coalition decision at this station.'
      : `Next: ${state.visited.includes(item.region)?'operate':'reach'} ${REGIONS.find(region=>region.id===item.region).name}.`;
    objectiveSelect.replaceChildren(...available.map(item=>make('option',`${item.id}: ${item.title}`,{value:item.id})));
    objectiveSelect.value=selected;objectiveSelect.hidden=available.length<2;
  }
  function renderNearby() {
    const region=REGIONS.find(item=>item.id===nearby);
    nearLabel.textContent=region?`${region.name}${regionUnlocked(state,region.id)?'':' / operations not yet unlocked'}`:'Walk a district path, or choose Travel.';
    interact.disabled=!region||readonly;
    interact.textContent=region?'Inspect station':'No station nearby';
    interactBox.hidden=readonly;
  }
  function render() {
    renderObjective();renderResources();renderNearby();renderStatus();world?.updateState(state);
    if(renderMode==='accessible'||renderMode==='archive')renderFallback();
  }
  objectiveSelect.addEventListener('change',()=>{
    selected=objectiveSelect.value;renderObjective();
    announce(`Objective selected: ${missionFor(selected).title}.`);
  },{signal:life.signal});

  function commit(action) {
    try {state=dispatch(state,action);}
    catch(error) {
      if(!(error instanceof GameRuleError))throw error;
      announce(error.message);
      const message=paragraph(error.message,'task-evaluation');message.setAttribute('role','alert');dialogBody.prepend(message);
      return false;
    }
    render();save();return true;
  }
  function travel(regionId,open=true) {
    if(readonly)return;
    if(!regionUnlocked(state,regionId)){announce('This district is not unlocked yet. Its source content is still available in the archive.');return;}
    closeDialog();
    currentRegion=regionId;nearby=regionId;
    world?.teleport(regionId);
    if(!commit({type:'visit',region:regionId}))return;
    renderNearby();announce(`Reached ${REGIONS.find(row=>row.id===regionId).name}.`);
    if(open)openStation(regionId);
  }
  function districtCards(parent,readonlyCards=false) {
    const grid=make('div',null,{class:'district-grid'});
    for(const region of REGIONS) {
      const card=make('article',null,{class:'district-card'});
      card.append(make('h3',region.name),paragraph(region.purpose));
      if(readonlyCards)card.append(button('Inspect related forecasts',()=>openArchive('forecasts',region.id)));
      else {
        const go=button(state.visited.includes(region.id)?'Return to station':'Travel to station',()=>travel(region.id),{'data-travel':region.id});
        go.disabled=!regionUnlocked(state,region.id);card.append(go);
        if(go.disabled)card.append(paragraph('Operations unlock through the objective graph. Original content is never locked.','muted'));
      }
      grid.append(card);
    }
    parent.append(grid);
  }
  function openTravel() {
    openDialog('District travel');
    dialogBody.append(paragraph('Direct travel is an equivalent navigation control, not a paid shortcut. You can also walk every connected district path.'));
    districtCards(dialogBody,readonly);
  }
  function renderFallback() {
    if(world)return;
    sceneHost.replaceChildren();
    const area=make('div',null,{class:'fallback-world',id:'gameFallback'});
    area.append(make('h2',readonly?'Source archive / gameplay review required':'Accessible decision and travel mode'),
      paragraph(readonly?'The current canonical book, forecasts and sources remain available. No new campaign can bypass the reviewed mapping requirement.'
        :'The same campaign rules, station work and endings are available without a 3D renderer. Rendering availability does not change your decisions.'));
    if(readonly) {
      area.append(paragraph(bundle.content.coverage.pending.map(row=>`${row.id}: ${row.kind}`).join('; ') || 'This is a read-only source view.'));
      area.append(button('Open the complete archive',()=>openArchive('book'),{class:'primary'}));
    } else {
      if(graphicsError)area.append(paragraph(graphicsError,'status-message'));
      districtCards(area);
    }
    sceneHost.append(area);
  }

  async function startGraphics(preference=rendererPreference,location=savedLocation) {
    if(readonly||disposed)return;
    const generation=++graphicsGeneration;
    graphicsController?.abort('superseded');graphicsController=new AbortController();
    const controller=graphicsController;
    const cancel=()=>controller.abort('cancelled');signal?.addEventListener('abort',cancel,{once:true});
    initializing=true;world?.dispose();world=null;sceneHost.replaceChildren();
    const canvas=make('canvas',null,{class:'game-canvas',tabindex:0,'aria-label':'3D settlement. Walk with WASD or arrows; drag to orbit. Use Travel for equivalent navigation.',id:'gameCanvas'});
    sceneHost.append(canvas);backendLabel='Initializing 3D';renderStatus();
    try {
      const graphics=await import('./game-world.mjs');
      controller.signal.throwIfAborted();
      const created=await graphics.createWorld({canvas,state,reducedMotion,rendererPreference:preference,signal:controller.signal,
        onNear:id=>{nearby=id;renderNearby();},onInteract:id=>openStation(id),
        onMarkers:positions=>positions.forEach(point=>{
          const node=markerNodes.get(point.id);node.hidden=!point.visible;
          node.style.left=`${point.x*100}%`;node.style.top=`${point.y*100}%`;
        }),
        onContextLost:message=>{
          if(disposed)return;
          if(world)savedLocation=world.getLocation();
          world?.dispose();world=null;renderMode='accessible';backendLabel='3D device/context unavailable';
          initializing=false;renderFallback();renderStatus();save();announce(message);
          openDialog('3D rendering stopped; your decisions are retained');
          dialogBody.append(paragraph(message),paragraph('Continue in accessible mode, or make an explicit recovery attempt. No automatic retry loop runs.'));
          const choices=make('div',null,{class:'button-row'});
          choices.append(button('Continue accessible campaign',()=>closeDialog(),{class:'primary'}),
            button('Try WebGL2 compatibility',()=>{closeDialog();void startGraphics('webgl');}),
            button('Try WebGPU again',()=>{closeDialog();void startGraphics('auto');}));
          dialogBody.append(choices);
        },
      });
      if(disposed||generation!==graphicsGeneration||controller.signal.aborted){created.dispose();return;}
      world=created;renderMode='3d';rendererPreference=preference;
      backendLabel=world.metrics().backend;graphicsError='';
      if(location) {
        try {world.restoreLocation(location);}
        catch(error) {
          if(!(error instanceof graphics.GameLocationError))throw error;
          savedLocation=null;
          store.mode='session';store.message=`Session only: saved location is invalid. The old save is retained. ${error.message}`;
          announce(store.message+' Decisions were retained in this session; reset explicitly before replacing the old value.');
        }
      }
      const metrics=world.metrics();
      if(metrics.fallbackReason)announce(metrics.fallbackReason);
    } catch(error) {
      if(disposed||generation!==graphicsGeneration||controller.signal.aborted)return;
      const graphics=await import('./game-world.mjs');
      if(!(error instanceof graphics.GameRendererError))throw error;
      renderMode='accessible';backendLabel='Accessible mode';
      graphicsError=`3D unavailable: ${error.message}`;renderFallback();announce(graphicsError);
    } finally {
      signal?.removeEventListener('abort',cancel);
      if(generation===graphicsGeneration){initializing=false;syncPause();renderStatus();}
    }
  }

  function buildWork(item,container) {
    const committed=state.operations[item.id];
    let draft=drafts.get(item.id) || structuredClone(committed || defaultWork(item.task));
    drafts.set(item.id,draft);
    const box=make('section',null,{class:'station-task'});
    box.append(make('h3',item.task.label),paragraph(item.task.instruction));
    const controls=make('div',null,{class:'task-controls'});
    const evaluation=paragraph('','task-evaluation');evaluation.setAttribute('role','status');
    const confirm=button(committed?'Station work committed':'Commit station work',()=>{
      if(commit({type:'operate',mission:item.id,payload:draft})){
        announce('Station work committed. Review the consequences before choosing a policy.');
        openStation(item.region);
      }
    },{class:'primary',id:'commitStationWork'});
    const refreshWork=()=>{
      const result=evaluateWork(state,item,draft);
      evaluation.textContent=committed?'Station work is already committed. Its allocation is included in the decision previews below.':result.reason;
      confirm.disabled=Boolean(committed)||!result.ok;
      world?.previewOperation(item.region,draft);
    };
    if(['relay','placement','frontier'].includes(item.task.kind)) {
      const label=make('label','Station position',{for:'stationSelection'});
      const select=make('select',null,{id:'stationSelection'});
      item.task.labels.forEach((text,index)=>select.append(make('option',text,{value:index})));
      select.value=draft.selection;select.disabled=Boolean(committed);
      select.addEventListener('change',()=>{draft.selection=Number(select.value);refreshWork();});
      controls.append(label,select);
      if(item.task.kind==='frontier') {
        const row=make('label',null,{class:'check-row'});
        const check=make('input',null,{type:'checkbox',id:'frontierBoundaries'});check.checked=draft.boundaries;check.disabled=Boolean(committed);
        check.addEventListener('change',()=>{draft.boundaries=check.checked;refreshWork();});
        row.append(check,document.createTextNode('Retain aligned-ASI/prerequisite conditions, reversible consent and the distinction between a proposal and proof.'));
        controls.append(row);
      }
    } else if(item.task.kind==='routing') {
      controls.classList.add('route-controls');
      item.task.labels.forEach((labels,index)=>{
        const cell=make('div',null,{class:'route-switch'});
        const turn=button(labels[draft.routes[index]],()=>{
          draft.routes[index]=(draft.routes[index]+1)%labels.length;
          turn.textContent=labels[draft.routes[index]];refreshWork();
        },{'data-route-switch':index});
        turn.disabled=Boolean(committed);
        cell.append(make('span',`Switch ${index+1}`),turn);controls.append(cell);
      });
    } else if(item.task.kind==='allocation') {
      const inputs=[],outputs=[];
      item.task.labels.forEach((label,index)=>{
        const row=make('div',null,{class:'task-control'});
        const id=`work-allocation-${index}`;
        const input=make('input',null,{type:'range',min:0,max:item.task.points,step:1,value:draft.units[index],id,'data-work-allocation':index});
        const output=make('output',draft.units[index],{for:id});
        input.disabled=Boolean(committed);
        input.addEventListener('input',()=>{draft.units[index]=Number(input.value);output.textContent=input.value;refreshWork();});
        row.append(make('label',label,{for:id}),input,output);controls.append(row);inputs.push(input);outputs.push(output);
      });
      const balanced=button('Fill evenly from minimum requirements',()=>{
        draft.units=item.task.labels.map((_,index)=>item.task.minimums?.[index]||0);
        let remaining=item.task.points-draft.units.reduce((a,b)=>a+b,0),index=0;
        while(remaining-->0)draft.units[index++%draft.units.length]++;
        inputs.forEach((input,index)=>{input.value=draft.units[index];outputs[index].textContent=draft.units[index];});
        refreshWork();
      },{id:'balanceStationWork'});
      balanced.disabled=Boolean(committed);controls.append(balanced);
    } else if(item.task.kind==='interlocks') {
      item.task.labels.forEach((label,index)=>{
        const row=make('label',null,{class:'check-row'});
        const input=make('input',null,{type:'checkbox','data-work-check':index});
        input.checked=draft.checks[index];input.disabled=Boolean(committed);
        input.addEventListener('change',()=>{draft.checks[index]=input.checked;refreshWork();});
        row.append(input,document.createTextNode(label));controls.append(row);
      });
    } else if(item.task.kind==='survey') {
      item.task.regions.forEach(id=>{
        const region=REGIONS.find(row=>row.id===id);
        controls.append(paragraph(`${region.name}: ${state.visited.includes(id)?'surveyed':'not yet surveyed'}`),
          button('Travel to '+region.name,()=>travel(id)));
      });
    }
    box.append(controls,evaluation,confirm);container.append(box);refreshWork();
  }

  function effectChips(changes) {
    const holder=make('div',null,{class:'choice-effects'});
    for(const [key,value] of Object.entries(changes))holder.append(make('span',`${RESOURCE_LABELS[key]} ${value>0?'+':''}${value}`));
    return holder;
  }
  function showChoices(item,container,previewOnly=false) {
    const grid=make('div',null,{class:'choice-grid'});
    for(const choice of item.choices) {
      const preview=previewChoice(state,item.id,choice.id);
      const card=make('article',null,{class:'choice-card','data-choice-card':choice.id});
      card.append(make('h4',choice.label),paragraph(choice.detail),paragraph(`${choice.cost} project credits`,'choice-cost'),effectChips(preview.changes));
      if(preview.pressure)card.append(paragraph(preview.pressure.label+'. Its effects are included above.','muted'));
      if(!preview.allowed)card.append(paragraph(preview.reason,'source-boundary'));
      if(!previewOnly) {
        const select=button(confirmedChoice===choice.id?'Confirm this decision':'Review and choose',()=>{
          if(confirmedChoice!==choice.id){confirmedChoice=choice.id;openStation(item.region);return;}
          if(commit({type:'choose',mission:item.id,choice:choice.id})){
            closeDialog();confirmedChoice='';announce('Decision committed. The world, future options and causal journal have changed.');
            if(state.ended)openDebrief();
          }
        },{'data-choice':choice.id,class:confirmedChoice===choice.id?'primary':'quiet'});
        select.disabled=!preview.allowed;
        card.append(select);
        if(confirmedChoice===choice.id)card.append(paragraph('Commit the displayed immediate and delayed effects? This choice is part of this campaign history; replay is available after the debrief.','choice-confirm'));
      }
      grid.append(card);
    }
    container.append(grid);
  }
  function openStation(regionId) {
    if(!regionId||readonly)return;
    currentRegion=regionId;
    if(regionUnlocked(state,regionId)&&!state.visited.includes(regionId))commit({type:'visit',region:regionId});
    const region=REGIONS.find(row=>row.id===regionId);
    const available=availableMissions(state).filter(item=>item.region===regionId);
    const item=available.find(item=>item.id===selected)||available[0];
    if(item)selected=item.id;
    openDialog(region.name,true);
    if(!item) {
      dialogBody.append(paragraph(state.ended?'Your completed settlement is open for exploration.':'There is no available main objective at this station yet. Its source material is always available.'),
        button('Choose another district',()=>openTravel()),
        button('Inspect related forecasts',()=>openArchive('forecasts',regionId)));
      if(state.ended)dialogBody.append(button('Open the debrief',()=>openDebrief(),{class:'primary'}));
      return;
    }
    dialogBody.append(make('div',`${item.id} / ${item.title}`,{class:'eyebrow'}),paragraph(item.brief,'station-brief'));
    if(available.length>1) {
      const selector=make('select',null,{'aria-label':'Station objective'});
      available.forEach(row=>selector.append(make('option',row.title,{value:row.id})));
      selector.value=item.id;
      selector.addEventListener('change',()=>{selected=selector.value;confirmedChoice='';openStation(regionId);});
      dialogBody.append(selector);
    }
    buildWork(item,dialogBody);
    if(state.operations[item.id])showChoices(item,dialogBody);
    dialogBody.append(button('Read the source chapter',()=>openArchive('book',String(item.chapter))),
      button('Inspect the forecasts behind this system',()=>openArchive('forecasts',regionId)),
      paragraph('Campaign fiction. These controls do not change original forecasts, source measurements or your real-world planning records.','source-note'));
    renderObjective();
  }

  function allResourceFacts(parent) {
    const facts=make('dl',null,{class:'source-facts'});
    for(const [key,label] of Object.entries(RESOURCE_LABELS))facts.append(make('dt',label),make('dd',state.resources[key]));
    parent.append(facts);
  }
  function openSystems() {
    openDialog('Coalition systems and assumptions');
    dialogBody.append(paragraph('Separate fictional systems, not one readiness score. A high value in one system does not compensate automatically for a weak control or distribution layer.'));
    allResourceFacts(dialogBody);
    dialogBody.append(paragraph(PROFILES[state.profile].description),paragraph('Strategic time advances only after committed choices. Walking, reading and pausing do not consume resources. No published probability is used as a success roll.','source-boundary'));
    const available=availableMissions(state);
    if(available.length) {
      dialogBody.append(make('h3','Current affordable options'));
      for(const item of available) {
        const names=item.choices.filter(choice=>previewChoice(state,item.id,choice.id).allowed).map(choice=>choice.label);
        dialogBody.append(paragraph(`${item.title}: ${names.join('; ')}.`));
      }
    }
    if(world) {
      const metrics=world.metrics();
      dialogBody.append(make('h3','Actual rendering backend'),paragraph(`${metrics.backend} / Three.js ${metrics.revision}`),
        paragraph(metrics.adapterScope),paragraph(Object.values(metrics.adapter||{}).filter(value=>typeof value==='string'&&value).join(' / ')||'Adapter details not exposed.'),
        paragraph(metrics.fallbackReason||'No fallback was required.'),paragraph('These are rendering diagnostics, not AI capability measurements.','source-note'));
    }
  }
  function appendJournal(parent,entries) {
    const chosen=entries.filter(entry=>entry.type==='choose');
    if(!chosen.length)parent.append(paragraph('No coalition policy has been committed yet.'));
    for(const entry of chosen) {
      const card=make('article',null,{class:'journal-entry'});
      card.append(make('h3',`${entry.mission}: ${entry.label}`),effectChips(entry.changes));
      if(entry.pressure)card.append(paragraph(entry.pressure.label));
      parent.append(card);
    }
  }
  function openJournal() {
    openDialog('Causal decision journal');
    dialogBody.append(paragraph('The history records actual committed game choices and their net effects, including the selected fictional stress profile. It is not a record of real preparation or forecast accuracy.'));
    appendJournal(dialogBody,state.journal);
    if(state.ended)dialogBody.prepend(button('Open the ending debrief',()=>openDebrief(),{class:'primary'}));
  }
  function openDebrief() {
    openDialog('Campaign debrief');
    const ending=endingFor(state);
    dialogBody.append(paragraph('13 / 13 main objectives completed','eyebrow'),make('h3',ending.title,{class:'ending-title',id:'gameEnding'}),
      paragraph(ending.text),paragraph(ending.reason,'source-boundary'),paragraph(ending.agency));
    allResourceFacts(dialogBody);
    dialogBody.append(make('h3','What made this branch'),paragraph('These are inspectable fictional rules. Other choices, constraints and source assumptions can lead to different outcomes; this is not a prediction of what will happen.'));
    appendJournal(dialogBody,state.journal);
    dialogBody.append(paragraph(`Pinned forecast: ${bundle.forecastHash}. Game rules: ${bundle.rulesHash}.`,'source-note'));
    const row=make('div',null,{class:'button-row'});
    row.append(button('Replay with a different profile',()=>requestExit(),{class:'primary',id:'replayGame'}),
      button('Explore this settlement',()=>closeDialog()),button('Read original sources',()=>openArchive('sources')));
    dialogBody.append(row);
  }

  const semanticTags=new Set(BOOK_TAGS);
  function bookNode(value,depth=0) {
    if(typeof value==='string')return document.createTextNode(value);
    if(!value||!semanticTags.has(value.tag)||!Array.isArray(value.children)||depth>32)throw new GameDataError('Unsafe or malformed book projection.');
    const node=make(value.tag);
    if(value.tag==='a'&&value.href) {
      const link=safeLink(value.href,'external');
      if(link){node.href=link;if(!link.startsWith('/')){node.target='_blank';node.rel='noopener noreferrer';}}
    }
    value.children.forEach(child=>node.append(bookNode(child,depth+1)));
    return node;
  }
  function facts(parent,entries) {
    const list=make('dl',null,{class:'source-facts'});
    entries.forEach(([label,value])=>list.append(make('dt',label),make('dd',value ?? 'Not recorded')));
    parent.append(list);
  }
  function sourceBoundary(parent,text) {parent.append(paragraph(text,'source-boundary'));}
  function renderReference(parent,row) {
    const layer=bundle.signals.referencePoints,entries=layer.items[row.id]||[];
    for(const entry of entries) {
      const source=layer.sources[entry.sourceId],health=source.health;
      const card=make('section',null,{class:'source-layer','data-reference-detail':row.id});
      const uses=Object.values(layer.items).flat().filter(item=>item.sourceId===entry.sourceId).length;
      card.append(make('h3',`Reviewed reference: ${entry.relation} / ${entry.direction}`),
        paragraph(`Mapped facet: ${entry.facet}`),paragraph(entry.why),
        anchor(source.title,source.url),paragraph(source.organization),make('blockquote',entry.excerpt,{class:'source-quote'}));
      sourceBoundary(card,`Does not establish: ${entry.doesNotEstablish}`);
      if(entry.metric) {
        const metric=entry.metric;
        card.append(paragraph(`Reported value: ${metric.operator||''}${metric.value}${metric.high===undefined?'':` to ${metric.high}`} ${metric.unit}. Coverage: ${metric.coverage}`));
      }
      facts(card,[
        ['Publication',source.publishedAt?displayTime(source.publishedAt):source.publishedPeriod?`${source.publishedPeriod} (month precision)`:'Not recorded; source date unknown'],
        ['Source quality',source.quality],['Retrieved',displayTime(source.retrievedAt)],['Mapping reviewed',displayTime(entry.reviewedAt)],
        ['Excerpt last verified',displayTime(health.lastVerifiedAt)],['Source last checked',displayTime(health.lastCheckedAt)],
        ['Source health',health.status],['Reuse',`${uses} forecast mappings / ${entry.reuseFamily}`],
      ]);
      if(source.pdfPages)card.append(paragraph(`PDF pages checked: ${source.pdfPages.join(', ')}.`));
      if(source.revisionIndex)card.append(paragraph(`Reviewed policy version: ${source.revisionIndex.version}.`),anchor('Official policy version index',source.revisionIndex.url));
      if(source.dateEvidenceUrl)card.append(anchor('Publication-date provenance page',source.dateEvidenceUrl));
      if(health.status!=='verified'||Date.now()-Date.parse(health.lastCheckedAt)>7*86400000)
        sourceBoundary(card,`Last-good reference retained. ${health.error||'Source check is overdue (over seven days).'}`);
      sourceBoundary(card,'A verified quote or available source is not a whole-forecast verdict. Shared sources are not independent corroboration. Daily checking does not make an older publication new.');
      parent.append(card);
    }
  }
  function renderNews(parent,row) {
    const cited=bundle.signals.embeds[row.id],context=bundle.signals.context.items[row.id],gap=bundle.signals.uncited.items[row.id];
    const item=cited||context,card=make('section',null,{class:'source-layer','data-news-detail':row.id});
    card.append(make('h3',cited?'NEWS / cited in the published window':context?'NEWS / dated context':'NEWS / explicitly uncited'));
    if(item) {
      card.append(anchor(item.headline,item.url),paragraph(item.publisher),make('blockquote',item.quote,{class:'source-quote'}),
        paragraph(item.mappingRationale||'Inspect the original published evidence record for its mapping rationale.'));
      facts(card,[['Article published',displayTime(item.publishedAt||item.articleDate)],
        ['Current article age',`${Math.max(0,Math.floor((Date.now()-Date.parse(item.publishedAt||item.articleDate))/86400000))} days`],
        ['Publication-date provenance',item.publishedAtSource],['Byline',item.author||item.byline||'Not recorded'],
        ['Retrieved',displayTime(item.provenance?.retrievedAt)],['Reviewed',displayTime(item.reviewedAt)],['Last verified',displayTime(item.lastVerifiedAt)]]);
    } else card.append(paragraph(gap.statement),paragraph(`Search recorded ${displayTime(gap.searchedAt)}. Published currency window: ${bundle.signals.uncited.windowDays} days.`));
    sourceBoundary(card,'NEWS accounting is independent of game progress, reviewed references and weekly X activity.');
    parent.append(card);
    const assessment=trajectory(bundle,row.id);
    const measured=make('section',null,{class:'source-layer'});
    measured.append(make('h3',assessment.label),paragraph(assessment.detail));
    for(const observation of assessment.records) {
      measured.append(make('h4',observation.criterion.description),
        paragraph(`${observation.measurement.value} ${observation.measurement.unit}; observed ${displayTime(observation.measurement.observedAt)}.`),
        paragraph(observation.rationale),paragraph(observation.limitations),anchor(observation.source.name,observation.source.url));
    }
    parent.append(measured);
    const supplemental=bundle.signals.xSignals?.items?.[row.id];
    if(supplemental) {
      const activity=make('section',null,{class:'source-layer'});
      activity.append(make('h3','Separate weekly X activity / not evidence'),
        paragraph(`Tier: ${supplemental.tier.toUpperCase()}. ${supplemental.statement||''}`),
        paragraph(supplemental.text||supplemental.title||'A retained activity placement is published for this forecast.'),
        paragraph(`Activity date: ${displayTime(supplemental.created)}.`),
        paragraph(`Weekly artifact built: ${displayTime(bundle.signals.xSignals.summary?.builtAt)}.`));
      const url=supplemental.url||supplemental.publicUrl;
      if(url)activity.append(anchor('Open the original activity',url,'external'));
      sourceBoundary(activity,'TRACKED and NEAREST are distinct supplement tiers; NEAREST is topical proximity, not supporting evidence. No NEWS citation, reference or measurement is inferred. The game does not collect X.');
      parent.append(activity);
    }
  }
  function renderMetr(parent) {
    const layer=bundle.signals.capabilities?.metr,current=layer?.current;
    const card=make('section',null,{class:'source-layer'});
    card.append(make('h3','METR capability instrument / separate from NEWS'));
    sourceBoundary(card,'Human-expert minutes at 50% and 80% task success, with 95% confidence intervals. Software/ML/cyber scope, not an AGI meter, runtime, job-automation claim or whole-forecast verdict. Estimates above 16 hours are unreliable for the current task suite.');
    if(!current){card.append(paragraph('No measurement snapshot is available.'));parent.append(card);return;}
    card.append(paragraph(layer.status==='ok'?'Source check succeeded; this does not mean a new evaluation.':`Last-good measurements retained. ${layer.error||'Source unavailable.'}`));
    facts(card,[['Last check',displayTime(layer.lastCheckedAt)],['Last successful fetch',displayTime(layer.lastSuccessfulFetchAt)],
      ['Benchmark revision',current.benchmark],['Data SHA-256',current.sha256],['Evaluation date',displayTime(current.measuredAt)],['Publication date',displayTime(current.publishedAt)],
      ['HTTP file timestamp',displayTime(current.lastModified)]]);
    const select=make('select',null,{'aria-label':'METR model',id:'gameMetrModel'});
    current.records.forEach(row=>select.append(make('option',row.id,{value:row.id})));
    const detail=make('div');
    const draw=()=>{
      const row=current.records.find(item=>item.id===select.value);detail.replaceChildren();
      facts(detail,[['Model release (not measurement date)',displayTime(row.releaseDate)],
        ['p50',`${row.p50.estimate} min (95% CI ${row.p50.ci_low} to ${row.p50.ci_high})`],
        ['p80',`${row.p80.estimate} min (95% CI ${row.p80.ci_low} to ${row.p80.ci_high})`],
        ['Scaffold/setup',row.scaffolds.join('; ')]]);
    };
    select.addEventListener('change',draw);card.append(select,detail);draw();parent.append(card);
  }
  function renderForecast(parent,row) {
    const mapping=bundle.content.mappings.find(item=>item.forecastId===row.id);
    parent.append(paragraph(`${row.id} / author's forecast unchanged`,'eyebrow'),make('h3',row.data.t),
      paragraph(row.kind==='dated'?`${row.data.prob}% stated probability`:`${row.data.conditionalProb}% conditional plausibility`),
      paragraph(forecastTiming(row,bundle.content.tools)));
    if(row.data.mBasis)parent.append(paragraph(row.data.mBasis));
    if(row.yearSummary)parent.append(paragraph(row.yearSummary,'source-note'));
    if(row.kind==='horizon')sourceBoundary(parent,bundle.predictions.postSuperintelligence.summary);
    if(mapping) {
      const exercise=make('section',null,{class:'source-layer'});
      exercise.append(make('h3',`Game connection: ${mapping.mechanicRole}`),paragraph(mapping.conceptScenario),
        paragraph(`Individual tradeoff: ${mapping.tradeoff}`),paragraph(mapping.simulationScope,'source-boundary'));
      const item=missionFor(mapping.mission);
      exercise.append(paragraph(`Implemented station: ${REGIONS.find(region=>region.id===mapping.region).name}. Objective: ${item.id} / ${item.title}. Task: ${item.task.label}.`));
      const preview=make('details');
      preview.append(make('summary','Inspect the real mission choices and their current fictional effects'));
      showChoices(item,preview,true);exercise.append(preview);
      exercise.append(button('Locate the implemented station',()=>{if(readonly)openTravel();else travel(mapping.region);}));
      const links=make('div',null,{class:'button-row'});
      mapping.chapters.forEach(index=>links.append(button('Read: '+bundle.content.book.find(chapter=>chapter.index===index).title,()=>openArchive('book',String(index)))));
      exercise.append(links);parent.append(exercise);
    } else sourceBoundary(parent,'No reviewed current gameplay mapping exists for this ID. Its original forecast and evidence remain accessible; new campaigns remain paused.');
    const parameters=make('details');
    parameters.append(make('summary','Complete original forecast parameters, prerequisites and caveats'),make('pre',JSON.stringify(row.data,null,2)));
    parent.append(parameters,anchor('Open this forecast on the original website',row.kind==='dated'?`/#event-${row.id}`:`/#${row.id}`,'external'));
    renderReference(parent,row);renderNews(parent,row);
    if(bundle.signals.capabilities?.metr?.context?.id===row.id)renderMetr(parent);
  }
  function renderToolArchive(parent) {
    const tools=bundle.content.tools;
    parent.append(make('h3','Original tools, separate from campaign rules'),
      paragraph('The following are exact source configuration and assumption snapshots. The working originals remain on the main page. Game resources do not replace these values, and gameplay does not write to the original tools.','source-boundary'));
    const navigation=make('div',null,{class:'button-row'});
    navigation.append(anchor('Original scenario simulator','/#scenarioInstrument','external'),anchor('Original portfolio builder','/#portfolioBuilder','external'),anchor('Original planner','/#moonshot','external'));
    parent.append(navigation,make('h3','Six Ds'));
    for(const row of tools.sixDs||[])parent.append(make('h4',row[0]),paragraph(row[1]));
    parent.append(make('h3','Original future panels and strategic moves'));
    for(const future of tools.futures||[]) {
      parent.append(make('h4',`${future.key}: ${future.name}`),paragraph(future.desc),paragraph(future.prob));
      const list=make('ul');future.moves.forEach(move=>list.append(make('li',move)));parent.append(list);
    }
    parent.append(paragraph('The book and tool use distinct authored scenario vocabularies. They are preserved, not silently reconciled.','source-note'),make('h3','Portfolio defaults'));
    facts(parent,(tools.allocBuckets||[]).map(row=>[row.name,`${row.def}% / ${row.sub}`]));
    parent.append(paragraph(`Original example net worth: ${tools.exampleNetWorth}. This is the site's example, not your data or the campaign's currency.`));
    parent.append(make('h3','Original planner questions and scores'));
    for(const question of tools.questions||[]) {
      parent.append(make('h4',question.q));
      const list=make('ul');question.opts.forEach(option=>list.append(make('li',`${option[0]} / ${option[2]} points`)));parent.append(list);
    }
    parent.append(make('h3','Original simulator configuration'),make('pre',JSON.stringify({presets:tools.simulatorPresets,outcomes:tools.simulatorOutcomeLabels},null,2)));
    parent.append(make('h3','Original control limits and starting values'),make('pre',JSON.stringify(tools.controls,null,2)));
    for(const [name,source] of Object.entries(tools.functions||{})) {
      const detail=make('details');detail.append(make('summary',`Exact source assumptions: ${name}`),make('pre',source));parent.append(detail);
    }
  }
  function renderAuthor(parent) {
    const author=bundle.author;
    parent.append(make('h3',author.name),paragraph(author.headline),paragraph('Original author voice and published biography. Campaign narration is separate game fiction.','source-boundary'));
    author.bio.forEach(text=>parent.append(paragraph(text)));
    author.roles.forEach(role=>parent.append(make('h4',role.org),paragraph(role.detail)));
    parent.append(anchor('Original author profile',author.linkedin,'external'),make('h3','Original published talks'));
    for(const talk of author.talks)parent.append(make('h4',talk.title),paragraph(`${talk.venue} / ${talk.year}`),paragraph(talk.blurb),anchor('Open talk',talk.url,'external'));
    parent.append(paragraph(`Author artifact: ${author.updated}. ${author.note||''}`,'source-note'));
  }
  function renderSourceOverview(parent) {
    const data=bundle.signals;
    parent.append(make('h3','Published sources, not live upstream collection'),paragraph(bundleHealth(bundle)));
    if(newRevision)sourceBoundary(parent,'This active campaign uses an explicitly older source snapshot. The newly published revision has not been merged into its state.');
    facts(parent,[['NEWS cited',data.coverage.cited],['NEWS dated context',data.context.count],['NEWS uncited',data.uncited.count],
      ['Forecast total',bundle.rows.length],['Reviewed reference mappings',data.referencePoints.coverage.mapped],
      ['Canonical reference sources',data.referencePoints.coverage.sources],['Bundle published',displayTime(data.updated)],
      ['Source collection',displayTime(data.sourceFetchedAt)],['Forecast SHA-256',bundle.forecastHash]]);
    sourceBoundary(parent,'Every forecast belongs to exactly one NEWS channel. Reference health, NEWS presence, X activity and game progress do not resolve a whole forecast. All unreviewed whole-forecast trajectories remain unassessed.');
    parent.append(paragraph(refreshText||'The browser checks these same-origin published artifacts every five minutes while visible; failures back off. This does not collect upstream sources.'));
    parent.append(button('Check published updates',()=>refresh?.check(),{id:'checkGameSources'}));
    if(pendingBundle)parent.append(button('Close this inspector and apply the compatible update',()=>{closeDialog();applyPending();}));
    parent.append(button('Inspect every forecast and its sources',()=>openArchive('forecasts')));
    renderMetr(parent);
    parent.append(make('h3','Published Reality Signals'));
    for(const item of data.reality||[]) {
      parent.append(make('h4',item.tag||'Observation'),paragraph(item.t));
      if(item.kind==='news'&&item.url)parent.append(anchor('Original published source',item.url));
    }
  }
  function openArchive(tab=archiveTab,item='') {
    archiveTab=tab;archiveItem=item;
    openDialog('Field archive / original content');
    const tabs=make('nav',null,{class:'archive-tabs','aria-label':'Archive sections'});
    for(const [id,label] of [['book','Book'],['forecasts','Forecasts'],['tools','Tools & assumptions'],['sources','Sources'],['author','Author'],['guide','Original site guide']])
      tabs.append(button(label,()=>openArchive(id),{'aria-pressed':id===tab}));
    dialogBody.append(tabs);
    const panel=make('section',null,{class:'archive-reader'});dialogBody.append(panel);
    if(tab==='book') {
      const list=make('div',null,{class:'archive-list'});
      bundle.content.book.forEach(chapter=>list.append(button(chapter.title,()=>openArchive('book',String(chapter.index)),{'data-chapter':chapter.index})));
      panel.append(list);
      const chapter=bundle.content.book.find(row=>String(row.index)===item);
      if(chapter) {
        const reader=make('article',null,{'data-book-chapter':chapter.index});
        chapter.blocks.forEach(block=>reader.append(bookNode(block)));panel.append(reader);
      } else panel.append(paragraph('All thirteen original reading entries are available independently of game progress. Opening a chapter here does not mark it read in your website planning checklist.'));
    } else if(tab==='forecasts') {
      const row=bundle.byId.get(item);
      if(row){panel.append(button('Back to forecast index',()=>openArchive('forecasts')));renderForecast(panel,row);return;}
      const filterRegion=REGIONS.some(region=>region.id===item)?item:'';
      panel.append(paragraph(`${bundle.content.coverage.mapped}/${bundle.rows.length} reviewed current game mappings. Original forecast text and source details are always separate from the fictional exercise.`));
      const search=make('input',null,{type:'search',placeholder:'Search exact forecast text or ID','aria-label':'Search forecasts',class:'archive-search'});
      const list=make('div',null,{class:'archive-list'});
      let limit=20;
      const more=button('Show more forecasts',()=>{limit+=20;draw();});
      const draw=()=>{
        const term=search.value.toLowerCase().trim();
        const matching=bundle.rows.filter(row=>(!term||`${row.id} ${row.data.t}`.toLowerCase().includes(term)) &&
          (!filterRegion||bundle.content.mappings.some(mapping=>mapping.forecastId===row.id&&mapping.region===filterRegion)));
        list.replaceChildren(...matching.slice(0,limit).map(row=>button(`${row.id}: ${row.data.t}`,()=>openArchive('forecasts',row.id),{'data-forecast':row.id})));
        more.hidden=matching.length<=limit;
        if(!matching.length)list.append(paragraph('No matching current forecasts.'));
      };
      search.addEventListener('input',()=>{limit=20;draw();});panel.append(search,list,more);
      if(filterRegion)panel.prepend(button('Show all forecast regions',()=>openArchive('forecasts')));
      draw();
    } else if(tab==='tools')renderToolArchive(panel);
    else if(tab==='sources')renderSourceOverview(panel);
    else if(tab==='author')renderAuthor(panel);
    else {
      panel.append(paragraph('Original static page text and controls are an archive bridge, not current source-health or evidence counters. Use the Sources panel for current published status.','source-boundary'));
      for(const section of bundle.content.guide) {
        const detail=make('details');detail.append(make('summary',section.title),paragraph(section.text),anchor('Open the original page',section.sourceHref||`/#${section.id}`,'external'));panel.append(detail);
      }
    }
  }

  function applyPending() {
    if(!pendingBundle||dialog.open)return;
    bundle=pendingBundle;pendingBundle=null;renderStatus();save();
    announce('Compatible published source update applied. Game decisions and authored probabilities were not changed.');
  }
  function openPause() {
    paused=true;openDialog('Campaign paused');
    dialog.dataset.kind='pause';
    dialogBody.classList.add('pause-card');
    dialogBody.append(paragraph('Nothing in the strategic model advances while you read or pause. Your current decisions are retained.'));
    const row=make('div',null,{class:'button-row'});
    row.append(button('Resume',()=>{paused=false;dialogBody.classList.remove('pause-card');closeDialog();},{class:'primary',id:'resumePausedGame'}),
      button('Save and return to briefing',()=>requestExit(),{id:'exitCampaign'}));
    dialogBody.append(row);
    const reduced=make('label',null,{class:'check-row'});
    const check=make('input',null,{type:'checkbox',id:'gameReducedMotion'});check.checked=reducedMotion;
    check.addEventListener('change',()=>{reducedMotion=check.checked;world?.setReducedMotion(reducedMotion);save();});
    reduced.append(check,document.createTextNode('Reduced motion and discrete travel'));dialogBody.append(reduced);
    dialogBody.append(button('Change light/dark theme',()=>{
      document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';world?.themeChanged();
    },{id:'gameTheme'}));
    if(!readonly) {
      dialogBody.append(button('Use accessible decision mode',()=>{
        if(world)savedLocation=world.getLocation();world?.dispose();world=null;
        renderMode='accessible';backendLabel='Accessible mode';paused=false;closeDialog();render();
      }),button('Use WebGPU first',()=>{paused=false;closeDialog();void startGraphics('auto');}),
      button('Use WebGL2 compatibility',()=>{paused=false;closeDialog();void startGraphics('webgl');}));
    }
    dialogBody.append(button('Reset only this campaign save',()=>openReset(),{id:'resetCampaignSave'}),
      paragraph(store.message,'status-message'),anchor('Return to the original book','/#book','external'));
  }
  function openReset() {
    openDialog('Reset this campaign save?');
    dialogBody.append(paragraph('This clears only pap-branch-campaign:v1. It does not clear the website mission-control record, watchlist or authored content. Current game progress will be discarded only if you confirm.'));
    const row=make('div',null,{class:'button-row'});
    row.append(button('Cancel',()=>openPause()),button('Confirm campaign-only reset',()=>{
      store.reset();state=createCampaign(state.profile,42);savedLocation=null;drafts.clear();selected='M00';
      paused=false;closeDialog();world?.updateState(state);world?.teleport('commons');render();announce(store.message);
    },{id:'confirmCampaignReset',class:'primary'}));
    dialogBody.append(row);
  }
  function requestExit() {
    save();
    if(store.mode==='session'&&!readonly) {
      openDialog('Leave this session-only campaign?');
      dialogBody.append(paragraph('This browser could not persist your current progress. Leaving may lose these session-only choices; earlier local data may still remain.'));
      const row=make('div',null,{class:'button-row'});
      row.append(button('Keep playing',()=>{paused=false;closeDialog();}),button('Leave without a new local save',()=>exit(),{class:'primary'}));dialogBody.append(row);
    } else exit();
  }
  function exit() {
    if(disposed)return;
    save();disposed=true;graphicsGeneration++;graphicsController?.abort('exit');refresh?.stop();
    world?.dispose();world=null;life.abort();dialog.close();sceneHost.replaceChildren();host.replaceChildren();
    stage.hidden=true;landing.hidden=false;activeRuntime=null;
    document.querySelector('.game-skip').href='#gameMain';
    onExit?.(readonly?'Source archive closed. No game progress was written.':store.message+' Rendering and requests stopped.');
  }

  const touch=make('div',null,{class:'touch-controls'});
  const pad=make('div',null,{class:'move-pad',role:'group','aria-label':'Touch movement pad'});
  pad.append(make('span','Move',{class:'move-pad-label'}));
  let touchPointer=null;
  const move=event=>{
    if(touchPointer!==event.pointerId)return;
    const rect=pad.getBoundingClientRect();
    world?.setMoveInput((event.clientX-rect.left-rect.width/2)/(rect.width/2),(event.clientY-rect.top-rect.height/2)/(rect.height/2));
  };
  pad.addEventListener('pointerdown',event=>{touchPointer=event.pointerId;pad.setPointerCapture(event.pointerId);move(event);},{signal:life.signal});
  pad.addEventListener('pointermove',move,{signal:life.signal});
  for(const type of ['pointerup','pointercancel'])pad.addEventListener(type,()=>{touchPointer=null;world?.setMoveInput(0,0);},{signal:life.signal});
  const cameras=make('div',null,{class:'camera-buttons'});
  cameras.append(button('Left',()=>world?.nudgeCamera(.25),{'aria-label':'Turn camera left'}),button('Right',()=>world?.nudgeCamera(-.25),{'aria-label':'Turn camera right'}));
  touch.append(pad,cameras);host.append(touch);
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){paused=true;save();world?.setPaused(true);announce('Campaign paused because this tab was hidden. Resume explicitly when ready.');}
    else {renderStatus();if(!dialog.open)openPause();}
  },{signal:life.signal});
  window.addEventListener('pagehide',()=>exit(),{signal:life.signal,once:true});

  render();
  if(!readonly&&mode==='3d')await startGraphics(rendererPreference,initialLocation);
  else {backendLabel=readonly?'Archive only':'Accessible mode';renderFallback();}
  if(disposed)throw new GameDataError('Campaign closed during startup.');
  if(signal?.aborted){exit();throw new GameDataError('Campaign startup cancelled.');}
  initializing=false;render();save();syncPause();
  refresh=startPublishedRefresh({
    getBundle:()=>bundle,
    onBundle:(next,sameIdentity)=>{
      if(!sameIdentity){newRevision=next;renderStatus();return;}
      if(dialog.open||paused){pendingBundle=next;renderStatus();}
      else {bundle=next;renderStatus();save();}
    },
    onStatus:status=>{refreshText=status.message;renderStatus();},
  });
  if(readonly)openArchive('sources');
  else if(state.ended)openDebrief();
  else announce(`Campaign started. ${backendLabel}. ${missionFor(selected).title}.`);
  return {snapshot:()=>({state:structuredClone(state),readonly,backend:world?.metrics()||{backend:renderMode},
    sourceVersion:bundle.forecastHash,sourcePublishedAt:bundle.signals.updated,coverage:structuredClone(bundle.content.coverage),storageMode:store.mode,paused,disposed,
    newRevision:Boolean(newRevision),pendingUpdate:Boolean(pendingBundle)}),exit};
}
