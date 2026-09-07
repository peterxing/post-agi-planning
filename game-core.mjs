export const GAME_VERSION = 1;
export const RULES_VERSION = 'coalition-1';

export const REGIONS = [
  { id:'commons', name:'Arrival Commons', short:'Commons', x:0, z:0, chapter:2, form:'commons', purpose:'Start with people, not a prediction.' },
  { id:'foundry', name:'Capability Foundry', short:'Foundry', x:-44, z:-37, chapter:3, form:'foundry', purpose:'Capability is one part of a production chain.' },
  { id:'power', name:'Power Causeway', short:'Power', x:39, z:-38, chapter:5, form:'power', purpose:'Power, cooling and physical capacity constrain deployment.' },
  { id:'work', name:'Work Quarter', short:'Work', x:-48, z:31, chapter:6, form:'work', purpose:'A faster machine does not build a transition for its workers.' },
  { id:'civic', name:'Civic Forum', short:'Forum', x:41, z:28, chapter:8, form:'civic', purpose:'Coordination and control change what scaling means.' },
  { id:'distribution', name:'Distribution Estuary', short:'Distribution', x:-9, z:64, chapter:10, form:'distribution', purpose:'Production and access are different achievements.' },
  { id:'frontier', name:'Frontier Observatory', short:'Frontier', x:10, z:-81, chapter:11, form:'frontier', purpose:'An undated possibility is not a demonstrated outcome.' },
];

export const CONNECTIONS = [
  ['commons','foundry'], ['commons','power'], ['commons','work'], ['commons','civic'],
  ['work','distribution'], ['civic','distribution'], ['foundry','frontier'], ['power','frontier'],
];

export const RESOURCE_LABELS = {
  mandate:'Project credits', power:'Available power', compute:'Usable capability',
  resilience:'Social resilience', access:'Shared access', control:'Control assurance',
  trust:'Public trust', strain:'Transition strain', output:'Useful output',
};

export const PROFILES = {
  balanced:{ name:'Uneven transition', description:'A mixed, fictional transition. Capability, institutions and physical capacity advance at different rates.', initial:{} },
  accelerated:{ name:'Accelerated pressure', description:'Faster capability growth puts more pressure on control and the transition floor. Not a forecast probability.', initial:{ compute:10, strain:10, control:-5 } },
  managed:{ name:'Managed coordination', description:'More coordination capacity, with slower early output. A fictional stress profile, not an authored branch probability.', initial:{ control:10, trust:5, output:-5 } },
  bottleneck:{ name:'Physical bottlenecks', description:'Power and deployment capacity are constrained. Resilience and patient sequencing matter.', initial:{ power:-10, compute:-5, resilience:5 } },
};

const option = (id, label, detail, cost, delta, flag = '') => ({ id,label,detail,cost,delta,flag });
const mission = (id, title, chapter, region, depends, brief, task, choices) =>
  ({ id,title,chapter,region,depends,brief,task,choices });

export const MISSIONS = [
  mission('M00','Light the way',0,'commons',[],
    'You are the coalition navigator. Walk to the rose relay, or use accessible travel. Rotate its connection to power the public wayfinder.',
    { kind:'relay', label:'Wayfinder relay', instruction:'Turn the relay toward the Commons, then commit the connection.', labels:['Unused spur','Foundry feed','Commons wayfinder'], goal:2 },
    [
      option('open','Make the map public','Everyone receives the navigation signal; private compute grows more slowly.',0,{ access:4, trust:3, compute:-1 },'public-map'),
      option('reserve','Reserve a backup channel','A redundant channel strengthens continuity, but reaches fewer people immediately.',0,{ resilience:5, power:2, access:-1 },'backup-map'),
      option('direct','Prioritize the production route','More capacity reaches the foundry before the public network.',0,{ compute:5, output:3, trust:-2 },'production-map'),
    ]),
  mission('M01','Read the transition',1,'foundry',['M00'],
    'The workshop can demonstrate a capability while homes still lack useful services. Survey both places before choosing the first response.',
    { kind:'survey', label:'Two viewpoints', instruction:'Visit Arrival Commons and Capability Foundry. The travel list is an equivalent way to reach either station.', regions:['commons','foundry'] },
    [
      option('floor','Respond to households first','Fund a transition floor before extending production.',2,{ resilience:10, access:5, output:-2 }),
      option('build','Fund the demonstrated capability','Capability and output grow, with additional transition strain.',3,{ compute:12, output:7, strain:8, control:-3 },'early-scale'),
      option('listen','Keep a listening reserve','Preserve resources and coordination; no immediate production expansion.',0,{ trust:6, resilience:3, output:-2 }),
    ]),
  mission('M02','Set the coalition charter',2,'commons',['M01'],
    'Scarcity and access are lived experiences. Place the first service node, then decide who has a claim on the capacity the coalition builds.',
    { kind:'placement', label:'First service node', instruction:'Choose a real site in the district for the new node.', labels:['Homes','Public workshop','Community garden'] },
    [
      option('commons','A public claim on new capacity','Open infrastructure distributes benefits, but costs project credits now.',3,{ access:12, trust:7, output:2 },'commons-charter'),
      option('ownership','A builder-owned charter','Concentrated ownership brings early capital and output; access narrows.',1,{ compute:7, output:10, access:-8, trust:-3 },'private-charter'),
      option('cooperative','A cooperative charter','Share stewardship and reinforce the social floor, with slower build-out.',2,{ access:8, resilience:6, control:4, output:-2 },'cooperative-charter'),
      option('provisional','Keep the charter provisional','An affordable way forward, but uncertainty costs trust.',0,{ resilience:3, trust:-3 }),
    ]),
  mission('M03','Connect the abundance engine',3,'foundry',['M02'],
    'A compute hall is not an abundance engine on its own. Connect power to research and research to fabrication; watch the foundry respond.',
    { kind:'routing', label:'Production chain', instruction:'Connect Grid -> Compute -> Fabricator. Each switch changes a physical segment.', labels:[['Unused spur','Grid'],['Storage','Compute'],['Cooling bypass','Fabricator']], goal:[1,1,1] },
    [
      option('redundant','Build a redundant engine','Useful capacity with reserves and monitored operation.',4,{ power:8, compute:8, output:9, control:6, resilience:3 },'redundant-engine'),
      option('maximum','Push maximum throughput','A brighter foundry, but a thinner power and control margin.',2,{ compute:16, output:16, power:-8, control:-9, strain:7 },'high-throughput'),
      option('incremental','Connect one careful production cell','A smaller free step keeps the campaign moving without pretending scale is free.',0,{ compute:4, output:4, control:3 },'small-engine'),
    ]),
  mission('M04','Secure the human floor',4,'commons',['M02'],
    'The human stack has several layers. Allocate six service units among shelter, livelihood and community before deciding the coalition commitment.',
    { kind:'allocation', label:'Human floor', instruction:'Allocate all six units; shelter needs at least two and community at least one.', labels:['Shelter','Livelihood','Community'], points:6, minimums:[2,0,1] },
    [
      option('universal','Guarantee the floor','A stronger common floor uses resources that cannot also buy peak capacity.',3,{ resilience:12, access:7, trust:5, output:-3 },'secure-floor'),
      option('targeted','Target the most exposed households','Less expensive resilience with more limited access.',1,{ resilience:8, access:3, trust:2 }),
      option('defer','Retain a small emergency reserve','Keep the project budget, accepting additional exposure.',0,{ resilience:2, strain:5, trust:-3 }),
    ]),
  mission('M05','Route the grid',5,'power',['M03','M04'],
    'The power route splits between compute, production and homes. You cannot feed every circuit at maximum load.',
    { kind:'allocation', label:'Power splitter', instruction:'Route eight units. Compute and homes each require at least one. The split changes the district network.', labels:['Compute','Production','Homes'], points:8, minimums:[1,0,1] },
    [
      option('capacity','Expand power and cooling','More physical capacity, at a substantial upfront cost.',4,{ power:20, compute:4, output:6, control:2 },'expanded-grid'),
      option('priority','Prioritize industrial demand','Increase output on the existing grid, with less household access and reserve.',1,{ output:13, compute:8, power:-6, access:-7, strain:5 },'industrial-grid'),
      option('reserves','Keep reserve capacity','Less output now, stronger continuity and an affordable route onward.',0,{ power:7, resilience:6, output:-4 },'reserve-grid'),
    ]),
  mission('M06','Rebuild the work quarter',6,'work',['M03','M04','M05'],
    'Automation moves goods through this quarter. Route the freight through a transition workshop instead of bypassing the people affected.',
    { kind:'routing', label:'Transition freight', instruction:'Connect Factory -> Learning workshop -> Community depot.', labels:[['Idle siding','Factory'],['Bypass','Learning workshop'],['Private store','Community depot']], goal:[1,1,1] },
    [
      option('transition','Pair deployment with worker adaptation','Production arrives with skills, services and lower transition strain.',3,{ output:7, resilience:10, access:5, strain:-12, trust:5 },'worker-transition'),
      option('automate','Automate before institutions catch up','Fast output and usable capability; people absorb the transition cost.',1,{ output:16, compute:10, strain:17, resilience:-7, trust:-6 },'rapid-automation'),
      option('craft','Keep a mixed workshop economy','A smaller capability gain with durable skills and less disruption.',0,{ output:3, resilience:8, strain:-4, compute:2 },'mixed-work'),
    ]),
  mission('M07','Hedge the commons',7,'civic',['M04','M05','M06'],
    'A portfolio protects against more than one future. Allocate twelve fictional preparation units across at least three different channels.',
    { kind:'allocation', label:'Coalition preparation portfolio', instruction:'Use all twelve units across at least three channels. These are not money or personal financial recommendations.', labels:['Buffer','Productive tools','Re-skilling','Community','Safety','Enhancement choice'], points:12, breadth:3 },
    [
      option('diverse','Maintain a broad hedge','Pay for optionality rather than maximizing a single destination.',2,{ resilience:9, control:5, trust:4, output:-2 },'broad-hedge'),
      option('upside','Back the production upside','Commit strongly to output while accepting concentrated exposure.',1,{ output:13, compute:8, resilience:-6, control:-4 },'upside-hedge'),
      option('patient','Keep the remaining credits uncommitted','Preserve a modest floor and the ability to respond later.',0,{ resilience:5, power:2 }),
    ]),
  mission('M08','Authorize the next scale step',8,'civic',['M03','M05','M06','M07'],
    'Capability, deployment and impact are three different clocks. Engage the inspection channels before deciding how to scale.',
    { kind:'interlocks', label:'Three-clock inspection', instruction:'Connect the capability, deployment and impact inspection channels. This is a fictional control system, not a real capability evaluation.', labels:['Capability observed','Deployment constrained','Impact monitored'] },
    [
      option('managed','Retain the control interlock','Coordinate and monitor expansion, giving up near-term output.',3,{ control:18, trust:7, resilience:4, output:-5, strain:-5 },'managed-scale'),
      option('unchecked','Release the interlock for rapid scaling','More output and capability with substantially weaker control assurance.',1,{ compute:18, output:18, control:-22, strain:12, trust:-5 },'unchecked'),
      option('pause','Pause the next frontier step','Keep a cautious, affordable path while physical and social systems catch up.',0,{ control:10, resilience:6, output:-8, strain:-4 },'deliberate-pause'),
    ]),
  mission('M09','Become a node',9,'work',['M06','M07','M08'],
    'Personal adaptation is more than collecting a score. Connect a practice workshop and a community hub; the four phases are actions, not a waiting timer.',
    { kind:'interlocks', label:'Personal-adaptation connection', instruction:'Commit the four parts of this fictional community project. This does not record real-life readiness or mark the website planner complete.', labels:['Name a survival floor','Practice orchestration','Access productive tools','Connect a community'] },
    [
      option('mentor','Build a shared learning node','Convert the coalition network into distributed capability and resilience.',2,{ resilience:10, trust:8, access:6, strain:-7 },'learning-node'),
      option('specialize','Build a specialist production studio','A stronger productive asset, with less broad participation.',1,{ compute:7, output:10, access:-3, resilience:2 },'specialist-node'),
      option('simple','Keep the project small and human-shaped','Protect relationships and agency without an additional spending requirement.',0,{ resilience:7, trust:6, strain:-3 },'human-shaped'),
    ]),
  mission('M10','Open the distribution channels',10,'distribution',['M07','M08','M09'],
    'Output does not distribute itself. Route nine service units between homes, open tools and the shared clinic; compare the communities before committing.',
    { kind:'allocation', label:'Distribution splitter', instruction:'Allocate all nine units. The actual split changes which communities receive services.', labels:['Homes','Open tools','Shared clinic'], points:9 },
    [
      option('universal','Guarantee broad access','A public distribution layer reaches more people, at a real opportunity cost.',4,{ access:22, trust:10, resilience:5, output:-5 },'public-distribution'),
      option('market','Keep access tied to ownership','Output compounds where ownership is concentrated; public access narrows.',1,{ output:16, compute:5, access:-18, trust:-7 },'concentrated-distribution'),
      option('cooperative','Connect a modest cooperative network','An affordable, smaller distribution gain rather than a universal guarantee.',0,{ access:7, resilience:5, trust:4, output:1 },'cooperative-distribution'),
    ]),
  mission('M11','Set frontier boundaries',11,'frontier',['M08','M09','M10'],
    'Enhancement and the long horizon are conditional possibilities. Select an exploratory emphasis without turning consent, a theory or a precursor into proof.',
    { kind:'frontier', label:'Conditional research charter', instruction:'Choose a hypothetical research emphasis, then explicitly retain its prerequisite, consent and evidence boundaries.', labels:['Embodied agency','Outward exploration','Inward/theoretical questions','No enhancement commitment'] },
    [
      option('rights','Fund consent and independent oversight','Protect choice and widen access; this does not demonstrate any horizon outcome.',2,{ control:9, trust:7, access:6, output:-2 },'agency-protected'),
      option('exclusive','Fund an exclusive frontier program','Concentrate hypothetical capacity, with reduced access and weaker consent safeguards.',2,{ compute:12, output:5, access:-9, control:-8, trust:-4 },'exclusive-frontier'),
      option('observe','Retain the evidence boundary and observe','An explicit no-enhancement commitment remains a valid, affordable choice.',0,{ control:6, resilience:4, trust:3 },'frontier-observer'),
    ]),
  mission('M12','Build the better branch',12,'civic',['M00','M01','M02','M03','M04','M05','M06','M07','M08','M09','M10','M11'],
    'The settlement now reflects your decisions. Review the causal journal and choose the final charter; the ending explains a fictional system, not the real future.',
    { kind:'interlocks', label:'Final ratification', instruction:'Retain these boundaries before ratifying the coalition charter.', labels:['Resources and ending are fictional','Authored probabilities are unchanged','Source availability is not forecast success'] },
    [
      option('share','Ratify a shared and governed charter','Favor broad access and monitored operation over another output surge.',2,{ access:12, control:8, trust:5, output:-3 },'final-shared'),
      option('surge','Ratify another production surge','Push output while accepting more strain and weaker assurance.',1,{ compute:12, output:15, control:-13, strain:10, access:-5 },'final-surge'),
      option('consolidate','Ratify a resilient consolidation','Preserve a workable floor even when the optimistic build-out remains incomplete.',0,{ resilience:12, control:5, power:5, strain:-6 },'final-resilient'),
    ]),
];

export class GameRuleError extends Error {
  constructor(message) { super(message); this.name = 'GameRuleError'; }
}
const requireRule = (condition, message) => { if (!condition) throw new GameRuleError(message); };
const bounded = (value, maximum = 100) => Math.max(0, Math.min(maximum, value));
const clone = value => structuredClone(value);
const initialResources = { mandate:30, power:35, compute:25, resilience:35, access:25, control:40, trust:45, strain:20, output:20 };

export function createCampaign(profile = 'balanced', seed = 42) {
  requireRule(Object.hasOwn(PROFILES, profile), 'Unknown stress profile.');
  requireRule(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff, 'Invalid scenery seed.');
  const resources = { ...initialResources };
  Object.entries(PROFILES[profile].initial).forEach(([key, delta]) => { resources[key] = bounded(resources[key] + delta); });
  return {
    version:GAME_VERSION, rules:RULES_VERSION, profile, seed, resources,
    visited:[], operations:{}, decisions:{}, flags:[], journal:[], ended:false,
  };
}

export function availableMissions(state) {
  return MISSIONS.filter(item => !state.decisions[item.id] && item.depends.every(id => Boolean(state.decisions[id])));
}

export function missionFor(id) {
  const result = MISSIONS.find(item => item.id === id);
  requireRule(result, 'Unknown campaign objective.');
  return result;
}

export function regionUnlocked(state, region) {
  requireRule(REGIONS.some(item => item.id === region), 'Unknown district.');
  if (region === 'commons' || region === 'foundry') return true;
  return MISSIONS.some(item => item.region === region &&
    (Boolean(state.decisions[item.id]) || item.depends.every(id => Boolean(state.decisions[id]))));
}

export function defaultWork(task) {
  if (task.kind === 'relay' || task.kind === 'placement') return { selection:0 };
  if (task.kind === 'routing') return { routes:task.labels.map(() => 0) };
  if (task.kind === 'allocation') return { units:task.labels.map(() => 0) };
  if (task.kind === 'interlocks') return { checks:task.labels.map(() => false) };
  if (task.kind === 'frontier') return { selection:0, boundaries:false };
  return {};
}

export function evaluateWork(state, item, payload) {
  const task = item.task;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok:false, reason:'The station configuration is missing.' };
  if (task.kind === 'survey') {
    const missing = task.regions.filter(id => !state.visited.includes(id));
    return { ok:missing.length === 0, reason:missing.length ? `Survey ${missing.map(id => REGIONS.find(r => r.id === id).name).join(' and ')} first.` : 'Both viewpoints surveyed.' };
  }
  if (['relay','placement','frontier'].includes(task.kind)) {
    if (!Number.isInteger(payload.selection) || payload.selection < 0 || payload.selection >= task.labels.length)
      return { ok:false, reason:'Choose a valid station position.' };
    if (task.kind === 'relay' && payload.selection !== task.goal)
      return { ok:false, reason:'The public wayfinder is still disconnected. Rotate the relay toward the Commons.' };
    if (task.kind === 'frontier' && payload.boundaries !== true)
      return { ok:false, reason:'Retain the prerequisite, consent and evidence boundaries before proceeding.' };
    return { ok:true, reason:task.kind === 'relay' ? 'The Commons wayfinder is powered.' : `${task.labels[payload.selection]} selected.` };
  }
  if (task.kind === 'routing') {
    if (!Array.isArray(payload.routes) || payload.routes.length !== task.goal.length ||
      !payload.routes.every((value, index) => Number.isInteger(value) && value >= 0 && value < task.labels[index].length))
      return { ok:false, reason:'Each switch needs a valid route.' };
    const ok = payload.routes.every((value, index) => value === task.goal[index]);
    return { ok, reason:ok ? 'The complete route is connected.' : 'The route still has a disconnected segment. Follow the labeled physical chain.' };
  }
  if (task.kind === 'interlocks') {
    const ok = Array.isArray(payload.checks) && payload.checks.length === task.labels.length && payload.checks.every(value => value === true);
    return { ok, reason:ok ? 'All inspection channels are engaged.' : 'Engage each named inspection channel.' };
  }
  if (task.kind === 'allocation') {
    if (!Array.isArray(payload.units) || payload.units.length !== task.labels.length ||
      !payload.units.every(value => Number.isInteger(value) && value >= 0 && value <= task.points))
      return { ok:false, reason:'Use bounded whole service units.' };
    const total = payload.units.reduce((sum, value) => sum + value, 0);
    if (total !== task.points) return { ok:false, reason:`Allocate exactly ${task.points} units; currently ${total}.` };
    if (task.minimums?.some((minimum, index) => payload.units[index] < minimum))
      return { ok:false, reason:`Minimum service requirements: ${task.minimums.map((value, index) => `${task.labels[index]} ${value}`).join(', ')}.` };
    if (task.breadth && payload.units.filter(Boolean).length < task.breadth)
      return { ok:false, reason:`Keep at least ${task.breadth} preparation channels funded.` };
    return { ok:true, reason:'Allocation ready. The split will affect the committed outcome.' };
  }
  return { ok:false, reason:'Unsupported station task; no progress was recorded.' };
}

function applyDeltas(resources, deltas) {
  for (const [key, delta] of Object.entries(deltas)) {
    requireRule(Object.hasOwn(RESOURCE_LABELS, key) && Number.isFinite(delta), 'Invalid campaign resource change.');
    resources[key] = bounded(resources[key] + delta, key === 'mandate' ? 1000 : 100);
  }
}

function workEffects(item, operation) {
  const units = operation.units;
  if (item.id === 'M04') return { resilience:units[0] * 2, output:units[1], trust:units[2] * 2 };
  if (item.id === 'M05') return { compute:units[0], output:units[1] * 2, access:units[2], power:-Math.max(0, units[0] + units[1] - 4) };
  if (item.id === 'M07') return { resilience:units[0] * 2 + units[2], compute:units[1], trust:units[3], access:units[3], control:units[4] * 2 };
  if (item.id === 'M10') return { access:Math.min(...units) * 4, resilience:units[0], compute:units[1], trust:units[2] };
  if (item.id === 'M11') return [
    {access:3,trust:2,control:2},
    {power:-4,compute:5,output:2},
    {compute:2,control:4,output:-2},
    {resilience:4,trust:3},
  ][operation.selection];
  if (item.id === 'M02') return [{ access:3 },{ output:3 },{ trust:3 }][operation.selection];
  return {};
}

function pressureFor(state, id) {
  if (!['M03','M06','M09'].includes(id)) return null;
  const changes = {
    balanced:{ strain:3 },
    accelerated:{ strain:8, power:-3, control:-2 },
    managed:{ control:3, output:-2 },
    bottleneck:{ power:-6, compute:-3, resilience:2 },
  };
  return { label:`${PROFILES[state.profile].name}: scheduled fictional transition pressure`, delta:changes[state.profile] };
}

export function previewChoice(state, missionId, choiceId) {
  const item = missionFor(missionId), selected = item.choices.find(value => value.id === choiceId);
  requireRule(selected, 'Unknown coalition decision.');
  const resources = { ...state.resources };
  resources.mandate -= selected.cost;
  applyDeltas(resources, selected.delta);
  const operation = state.operations[missionId];
  if (operation) applyDeltas(resources, workEffects(item, operation));
  const pressure = pressureFor(state, missionId);
  if (pressure) applyDeltas(resources, pressure.delta);
  return {
    allowed:state.resources.mandate >= selected.cost,
    reason:state.resources.mandate < selected.cost ? `Needs ${selected.cost} project credits; ${state.resources.mandate} remain. A no-cost route is available.` : '',
    resources, pressure, selected,
    changes:Object.fromEntries(Object.keys(resources).map(key => [key, resources[key] - state.resources[key]]).filter(([,value]) => value !== 0)),
  };
}

export function dispatch(state, action) {
  requireRule(state?.version === GAME_VERSION && state.rules === RULES_VERSION, 'Campaign rules do not match.');
  requireRule(action && typeof action === 'object', 'Missing campaign action.');
  requireRule(!state.ended, 'This campaign has ended. Explore the debrief or start a new campaign.');
  const next = clone(state);
  let entry;
  if (action.type === 'visit') {
    requireRule(regionUnlocked(state, action.region), 'This district is not yet unlocked.');
    if (state.visited.includes(action.region)) return state;
    next.visited.push(action.region);
    entry = { type:'visit', region:action.region, label:`Surveyed ${REGIONS.find(item => item.id === action.region).name}` };
  } else {
    const item = missionFor(action.mission);
    requireRule(availableMissions(state).some(value => value.id === item.id), 'Complete this objective\'s prerequisites first.');
    requireRule(state.visited.includes(item.region), `Reach the ${REGIONS.find(value => value.id === item.region).name} station first.`);
    if (action.type === 'operate') {
      requireRule(!state.operations[item.id], 'This station work has already been committed.');
      const evaluation = evaluateWork(state, item, action.payload);
      requireRule(evaluation.ok, evaluation.reason);
      next.operations[item.id] = clone(action.payload);
      entry = { type:'operate', mission:item.id, payload:clone(action.payload), label:`${item.task.label}: ${evaluation.reason}` };
    } else if (action.type === 'choose') {
      requireRule(state.operations[item.id], 'Complete the station work before committing a policy.');
      const preview = previewChoice(state, item.id, action.choice);
      requireRule(preview.allowed, preview.reason);
      next.resources = preview.resources;
      next.decisions[item.id] = action.choice;
      if (preview.selected.flag) next.flags.push(preview.selected.flag);
      entry = {
        type:'choose', mission:item.id, choice:action.choice, label:preview.selected.label,
        changes:preview.changes, pressure:preview.pressure, resources:{ ...next.resources },
      };
      next.ended = item.id === 'M12';
    } else throw new GameRuleError('Unsupported action; no progress was recorded.');
  }
  requireRule(next.journal.length < 100, 'Campaign history exceeded its supported action limit.');
  next.journal.push(entry);
  return next;
}

export const ENDINGS = {
  shared:{ title:'Shared abundance', text:'Useful production reached people while control and trust held. Your coalition paid for access and governance rather than treating them as automatic consequences of capability.' },
  concentrated:{ title:'Concentrated abundance', text:'The settlement produces more, but access remains narrow. Bright production districts coexist with underserved communities: output did not build its own distribution layer.' },
  managed:{ title:'Managed transition', text:'The coalition retained a workable path through uneven change. Some ambitions remain unfinished; coordination, staged deployment and modest production kept options open.' },
  long:{ title:'Resilient long horizon', text:'Physical constraints slowed the optimistic build-out. A stronger human floor and reserve capacity made patience a viable outcome rather than a failed race.' },
  shock:{ title:'Disorderly labor shock', text:'Deployment outpaced the transition floor. Production gains did not compensate for exposure and strain; the debrief shows where adaptation and support fell behind.' },
  control:{ title:'Compromised control', text:'Rapid expansion outran the safeguards the coalition retained. This fictional ending identifies a control tradeoff; it is not an assessment of any real system or forecast.' },
};

export function endingFor(state) {
  const r = state.resources;
  let key = 'managed', reason = 'A mixed settlement: no other ending condition dominates.';
  if (r.control < 32 && (r.compute > 65 || state.flags.includes('unchecked'))) {
    key = 'control'; reason = `Control assurance ${r.control} is below 32 during high-capability or unchecked expansion.`;
  } else if (r.strain > 60 && r.resilience < 55) {
    key = 'shock'; reason = `Transition strain ${r.strain} exceeds 60 while social resilience ${r.resilience} is below 55.`;
  } else if (r.output + r.compute >= 110 && r.access < 50) {
    key = 'concentrated'; reason = `Production plus usable capability reaches ${r.output + r.compute}, but access ${r.access} remains below 50.`;
  } else if (r.access >= 60 && r.control >= 55 && r.trust >= 50 && r.output >= 45) {
    key = 'shared'; reason = `Access ${r.access}, control ${r.control}, trust ${r.trust} and output ${r.output} meet the shared-system conditions.`;
  } else if (r.resilience >= 58 && (r.power < 55 || state.profile === 'bottleneck')) {
    key = 'long'; reason = `Resilience ${r.resilience} holds despite the constrained physical-capacity profile.`;
  }
  return { key,...ENDINGS[key],reason,agency:state.flags.includes('agency-protected') || state.flags.includes('frontier-observer') ? 'An explicit consent/evidence boundary was retained.' : 'The frontier commitment needs particular scrutiny for access and consent.' };
}

export function replayActions(profile, seed, actions) {
  requireRule(Array.isArray(actions) && actions.length <= 100, 'Unsupported saved action history.');
  let state = createCampaign(profile, seed);
  for (const action of actions) state = dispatch(state, action);
  return state;
}

export function checkpointActions(state) {
  return state.journal.map(entry => {
    if (entry.type === 'visit') return { type:'visit', region:entry.region };
    if (entry.type === 'operate') return { type:'operate', mission:entry.mission, payload:clone(entry.payload) };
    return { type:'choose', mission:entry.mission, choice:entry.choice };
  });
}

export function rulesDescriptor() {
  return JSON.stringify({
    version:GAME_VERSION,rules:RULES_VERSION,regions:REGIONS,connections:CONNECTIONS,
    profiles:PROFILES,missions:MISSIONS,resources:initialResources,resourceLabels:RESOURCE_LABELS,endings:ENDINGS,
    functions:[requireRule,bounded,clone,createCampaign,availableMissions,missionFor,regionUnlocked,defaultWork,evaluateWork,
      applyDeltas,workEffects,pressureFor,previewChoice,dispatch,endingFor,replayActions,checkpointActions]
      .map(fn=>fn.toString().replace(/\r\n/g,'\n')),
  });
}
