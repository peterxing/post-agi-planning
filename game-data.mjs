import { GAME_VERSION, RULES_VERSION, rulesDescriptor, replayActions, checkpointActions, PROFILES, MISSIONS, GameRuleError } from './game-core.mjs';

export const SAVE_KEY = 'pap-branch-campaign:v1';
export const SAVE_LIMIT = 65536;
export const BOOK_TAGS = ['article','section','div','span','p','h1','h2','h3','h4','h5','h6','strong','em','b','i','small',
  'ul','ol','li','blockquote','br','hr','a','table','thead','tbody','tr','th','td','pre','code','sup','sub','figure','figcaption','dl','dt','dd'];
const hashPattern = /^[a-f0-9]{64}$/;
const idPattern = /^(?:20\d{2}-\d+|horizon-[a-z0-9-]+)$/;
const byteLimits = { 'predictions.json':300000, 'signals.json':2000000, 'author.json':50000, 'game-content.json':420000 };
const recordObject = value => value && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
export class GameDataError extends Error {
  constructor(message) { super(message); this.name='GameDataError'; }
}
const need = (condition,message) => { if (!condition) throw new GameDataError(message); };
export const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now()+300000;

export async function digest(value) {
  need(globalThis.crypto?.subtle,'Source identity verification requires a secure browser context.');
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');
}

export function safeLink(value, channel = 'reference') {
  if (typeof value !== 'string') return '';
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return value;
  let url;
  try { url = new URL(value); }
  catch (error) { if (error instanceof TypeError) return ''; throw error; }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password) return '';
  if (channel === 'reference' && (url.protocol !== 'https:' || /(?:^|\.)(?:x|twitter|twimg)\.com$/i.test(url.hostname))) return '';
  return url.href;
}

export function displayTime(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not recorded';
  const date = new Date(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? date.toLocaleDateString('en-US',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric'})+' (date only)'
    : date.toLocaleString('en-US',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'})+' UTC';
}

export function forecastRows(predictions) {
  need(Array.isArray(predictions?.years) && predictions.years.length > 0 && predictions.years.length <= 100,'Forecast year schema is invalid.');
  need(Array.isArray(predictions.postSuperintelligence?.items),'The undated horizon is missing.');
  const rows = predictions.years.flatMap(year => {
    need(Number.isInteger(year.year) && year.year >= 2000 && year.year <= 2200 && Array.isArray(year.events),'Forecast year is invalid.');
    return year.events.map((data,index) => ({id:`${year.year}-${index}`,data,year:year.year,kind:'dated',yearSummary:year.summary}));
  }).concat(predictions.postSuperintelligence.items.map(data=>({id:`horizon-${data.id}`,data,year:null,kind:'horizon'})));
  need(rows.length > 0 && rows.length <= 1000 && new Set(rows.map(row=>row.id)).size === rows.length,'Forecast identities are missing or duplicated.');
  for (const row of rows) {
    need(idPattern.test(row.id) && nonempty(row.data?.t) && row.data.t.length <= 5000,'A forecast identity or text is invalid.');
    const probability = row.kind === 'dated' ? row.data.prob : row.data.conditionalProb;
    need(Number.isFinite(probability) && probability >= 0 && probability <= 100,`Forecast probability is invalid: ${row.id}`);
  }
  return rows;
}

function freezeData(value) {
  const stack = [{value,depth:0}];
  let count = 0;
  while (stack.length) {
    const item = stack.pop();
    need(item.depth <= 64 && ++count <= 120000,'Published data structure is excessive.');
    if (item.value && typeof item.value === 'object') {
      Object.freeze(item.value);
      Object.values(item.value).forEach(child=>stack.push({value:child,depth:item.depth+1}));
    }
  }
  return value;
}

export async function fetchPublished(file, signal, fetchImpl = fetch) {
  need(Object.hasOwn(byteLimits,file),'Unknown published artifact requested.');
  const response = await fetchImpl('/'+file,{cache:'no-cache',signal});
  need(response.ok,`${file} request failed (HTTP ${response.status}).`);
  need(/application\/json/i.test(response.headers.get('content-type') || ''),`${file} did not return JSON.`);
  need(Number(response.headers.get('content-length') || 0) <= byteLimits[file],`${file} exceeds its size limit.`);
  need(response.body,`${file} returned no body.`);
  const reader = response.body.getReader(), chunks = [];
  let total = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      need(total <= byteLimits[file],`${file} exceeds its decoded size limit.`);
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(total);
  let offset=0;
  for (const chunk of chunks) { bytes.set(chunk,offset);offset+=chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch (error) {
    if (error instanceof SyntaxError) throw new GameDataError(`${file} contains malformed JSON; no replacement was applied.`);
    throw error;
  }
}

function validateNews(signals, rows) {
  need(recordObject(signals.embeds) && recordObject(signals.context?.items) && recordObject(signals.uncited?.items),'NEWS channels are incomplete.');
  const ids = new Set(rows.map(row=>row.id));
  const channels = [signals.embeds,signals.context.items,signals.uncited.items];
  const flattened = channels.flatMap(channel=>Object.keys(channel));
  need(flattened.length === rows.length && new Set(flattened).size === rows.length && flattened.every(id=>ids.has(id)),
    'NEWS must account for every forecast in exactly one cited, context or uncited channel.');
  need(signals.coverage?.total === rows.length && signals.coverage.cited === Object.keys(signals.embeds).length &&
    signals.context.count === Object.keys(signals.context.items).length && signals.uncited.count === Object.keys(signals.uncited.items).length,
    'NEWS coverage counters disagree with the published records.');
  need(recordObject(signals.search) && Object.keys(signals.search).length === 0,'Prediction search fallbacks are not permitted.');
  need(signals.coverage.byEvidenceMedium?.x === 0 &&
    Object.keys(signals.coverage.byEvidenceOwner || {}).every(owner=>owner==='news'),
    'The NEWS evidence medium/owner partition crosses the retired X-evidence boundary.');
  for (const record of [...Object.values(signals.embeds),...Object.values(signals.context.items)]) {
    need(record.evidenceOwner === 'news' && safeLink(record.url) &&
      [record.publisher,record.headline,record.quote].every(nonempty) && validTime(record.publishedAt || record.articleDate),
      'A NEWS record is missing its source/provenance or crosses the evidence channel boundary.');
  }
  for (const record of Object.values(signals.uncited.items))
    need(nonempty(record.statement) && validTime(record.searchedAt),'An uncited record lacks its honest search statement/date.');
}

function validateReferences(signals, rows, hashes, forecastHash) {
  const layer = signals.referencePoints;
  need(layer?.schemaVersion === 1 && layer.forecastSha256 === forecastHash && validTime(layer.updatedAt) &&
    recordObject(layer.items) && recordObject(layer.sources) && recordObject(layer.gaps),'Reference roster/schema/version is invalid.');
  need(Object.keys(layer.gaps).length === 0 && layer.coverage?.total === rows.length && layer.coverage.mapped === rows.length &&
    layer.coverage.gaps === 0 && Object.keys(layer.items).length === rows.length,'Reviewed reference coverage is incomplete; this is not a gameplay-only mapping gap.');
  const used = new Set();
  let references = 0;
  for (const row of rows) {
    const entries = layer.items[row.id];
    need(Array.isArray(entries) && entries.length > 0 && entries.length <= 6,`Reviewed reference missing: ${row.id}`);
    for (const entry of entries) {
      const source = layer.sources[entry.sourceId], health = source?.health;
      need(entry.id === row.id && entry.predictionText === row.data.t && entry.predictionSha256 === hashes[row.id] &&
        ['measured','deployment','policy','trial','precursor','feasibility','constraint','counterevidence','theory'].includes(entry.relation) &&
        ['supports-prerequisite','context','challenges'].includes(entry.direction) &&
        [entry.facet,entry.why,entry.doesNotEstablish,entry.excerpt,source?.title,source?.organization].every(nonempty) &&
        safeLink(source.url) && source.url.startsWith('https:') && validTime(entry.reviewedAt) &&
        validTime(source.retrievedAt) && (source.publishedAt === null || validTime(source.publishedAt)) &&
        hashPattern.test(source.reviewSha256) && health?.reviewSha256 === source.reviewSha256 &&
        ['verified','unavailable','changed','unverified'].includes(health.status) &&
        validTime(health.lastCheckedAt) && validTime(health.lastVerifiedAt) &&
        Date.parse(health.lastCheckedAt) >= Date.parse(health.lastVerifiedAt),`Reference binding or review receipt is invalid: ${row.id}`);
      if (entry.metric !== null && entry.metric !== undefined) {
        const metric = entry.metric;
        need(Number.isFinite(metric.value) && nonempty(metric.unit) && nonempty(metric.coverage) &&
          (metric.high === undefined || (Number.isFinite(metric.high) && metric.high >= metric.value)),
          `Reference metric is invalid: ${row.id}`);
      }
      used.add(entry.sourceId);references++;
    }
  }
  need(layer.coverage.sources === used.size && layer.coverage.references === references,'Reference accounting is inconsistent.');
}

function validateMetr(signals) {
  const layer = signals.capabilities?.metr;
  if (!layer) return;
  const current = layer.current;
  need(layer.schemaVersion === 1 && ['ok','error','unavailable'].includes(layer.status),'METR layer schema is invalid.');
  if (!current) { need(layer.status !== 'ok','METR claims availability without a measurement snapshot.');return; }
  need(current.benchmark === 'METR-Horizon-v1.1' && current.unit === 'human-expert minutes' &&
    current.intervalLevel === .95 && current.measuredAt === null && current.publishedAt === null &&
    hashPattern.test(current.sha256) && validTime(current.retrievedAt) && validTime(layer.lastCheckedAt) &&
    layer.lastSuccessfulFetchAt === current.retrievedAt && Array.isArray(current.records) && current.records.length > 0 &&
    current.records.length <= 200,'METR units, revision, dates or measurement snapshot are invalid.');
  for (const row of current.records) need(nonempty(row.id) && validTime(row.releaseDate) && Array.isArray(row.scaffolds) &&
    row.p80?.estimate <= row.p50?.estimate && ['p50','p80'].every(key =>
      [row[key]?.estimate,row[key]?.ci_low,row[key]?.ci_high].every(value=>Number.isFinite(value)&&value>0) &&
      row[key].ci_low <= row[key].estimate && row[key].estimate <= row[key].ci_high),'METR interval record is invalid.');
}

export async function validateBundle({predictions,signals,author,content}, previous = null) {
  const rows = forecastRows(predictions);
  const [forecastHash,authorHash,rulesHash] = await Promise.all([
    digest(JSON.stringify(predictions)),digest(JSON.stringify(author)),digest(rulesDescriptor()),
  ]);
  const hashes = Object.fromEntries(await Promise.all(rows.map(async row=>[row.id,await digest(JSON.stringify(row.data))])));
  need(signals.forecastVersion?.schemaVersion === 1 && signals.forecastVersion.sha256 === forecastHash,
    'Forecast and evidence versions differ. No mixed-version bundle was applied.');
  need(validTime(signals.updated) && validTime(signals.sourceFetchedAt),'Published collection/publication dates are invalid.');
  validateNews(signals,rows);validateReferences(signals,rows,hashes,forecastHash);validateMetr(signals);
  need(content?.schemaVersion === 1 && content.rulesVersion === RULES_VERSION && content.rulesSha256 === rulesHash &&
    content.forecastSha256 === forecastHash && content.authorSha256 === authorHash,
    'Campaign, code or canonical-content versions differ. Reload after publication; no old progress is rebound.');
  need(hashPattern.test(content.bookSha256) && hashPattern.test(content.toolsSha256) && hashPattern.test(content.mappingSha256) &&
    Array.isArray(content.book) && content.book.length > 0 && content.book.length <= 100 &&
    Array.isArray(content.mappings) && Array.isArray(content.guide) && recordObject(content.tools) &&
    ['ready','review-required'].includes(content.coverage?.status) && Array.isArray(content.coverage.pending) &&
    content.coverage.forecasts === rows.length && content.coverage.mapped === content.mappings.length &&
    content.coverage.chapters === content.book.length,'Campaign projection or coverage schema is invalid.');
  need((content.coverage.status === 'ready') === (content.coverage.pending.length === 0) &&
    (content.coverage.status !== 'ready' || content.mappings.length === rows.length),
    'A complete game adaptation cannot be claimed while mappings are missing.');
  need(new Set(content.mappings.map(row=>row.forecastId)).size === content.mappings.length &&
    content.mappings.every(row=>hashes[row.forecastId] === row.recordSha256 && nonempty(row.mechanicRole) &&
      nonempty(row.conceptScenario) && nonempty(row.tradeoff) && nonempty(row.simulationScope) &&
      Array.isArray(row.chapters) && row.chapters.every(index=>content.book.some(chapter=>chapter.index===index)) &&
      MISSIONS.some(mission=>mission.id===row.mission && mission.region===row.region && mission.task.kind===row.task &&
        JSON.stringify(mission.choices.map(choice=>choice.id))===JSON.stringify(row.choices))),
    'A game mapping is duplicated, unbound or missing its individual meaning.');
  need(new Set(content.book.map(chapter=>chapter.index)).size === content.book.length,'Book chapter identities are duplicated.');
  for(const chapter of content.book) {
    need(Number.isInteger(chapter.index)&&nonempty(chapter.title)&&Array.isArray(chapter.blocks),'A complete book entry is invalid.');
    const stack=chapter.blocks.map(value=>({value,depth:0}));
    while(stack.length) {
      const {value,depth}=stack.pop();
      if(typeof value==='string')continue;
      need(depth<=32 && recordObject(value) && BOOK_TAGS.includes(value.tag) && Array.isArray(value.children) &&
        (value.href===undefined || Boolean(safeLink(value.href,'external'))),'Book projection contains an unsafe or invalid node.');
      value.children.forEach(child=>stack.push({value:child,depth:depth+1}));
    }
  }
  if(signals.xSignals) {
    need(recordObject(signals.xSignals.items)&&validTime(signals.xSignals.summary?.builtAt),'The separate weekly activity layer is invalid.');
    for(const [id,activity] of Object.entries(signals.xSignals.items)) need(hashes[id] && activity.channel==='x-trajectory-signal' &&
      ['tracked','nearest'].includes(activity.tier) && /^\d+$/.test(activity.id) && nonempty(activity.text) && validTime(activity.created) &&
      safeLink(activity.url,'external') && !['evidenceOwner','publisher','textSha256','verifiedThrough'].some(key=>key in activity),
      'A weekly activity placement is invalid or shaped like evidence.');
  }
  need(nonempty(author.name) && nonempty(author.headline) && Array.isArray(author.bio) &&
    author.bio.every(nonempty) && Array.isArray(author.roles) && Array.isArray(author.talks),'Author projection is incomplete.');
  if (previous) {
    need(Date.parse(signals.updated) >= Date.parse(previous.signals.updated),'An older evidence bundle was returned; the last good bundle is retained.');
    need(Date.parse(signals.referencePoints.updatedAt) >= Date.parse(previous.signals.referencePoints.updatedAt),
      'An older reference roster was returned; the last good bundle is retained.');
    const priorMetr = previous.signals.capabilities?.metr;
    if (priorMetr?.current) need(signals.capabilities?.metr?.current &&
      Date.parse(signals.capabilities.metr.lastCheckedAt) >= Date.parse(priorMetr.lastCheckedAt),
      'Older or missing METR data was returned; the last good bundle is retained.');
  }
  [predictions,signals,author,content].forEach(freezeData);
  return {predictions,signals,author,content,rows,byId:new Map(rows.map(row=>[row.id,row])),
    forecastHash,authorHash,rulesHash,recordHashes:hashes,loadedAt:new Date().toISOString()};
}

export async function loadBundle({signal,previous = null,fetchImpl = fetch} = {}) {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason || 'cancelled');
  signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted) cancel();
  const timer = setTimeout(()=>controller.abort('timeout'),12000);
  try {
    const files = Object.keys(byteLimits);
    const values = await Promise.all(files.map(file=>fetchPublished(file,controller.signal,fetchImpl)));
    controller.signal.throwIfAborted();
    return await validateBundle({predictions:values[0],signals:values[1],author:values[2],content:values[3]},previous);
  } catch(error) {
    const reason=controller.signal.reason;
    controller.abort('failed');
    if (signal?.aborted) throw new GameDataError('Published-data loading was cancelled.');
    if (reason==='timeout' || (error instanceof DOMException && error.name === 'AbortError'))
      throw new GameDataError('Published-data loading timed out; no replacement was applied.');
    throw error;
  } finally { clearTimeout(timer);signal?.removeEventListener('abort',cancel); }
}

export function bundleHealth(bundle) {
  const data = bundle.signals;
  if (['degraded','unavailable'].includes(data.sourceStatus?.mode)) return 'Published source outage; retained source details are not a new observation.';
  return Date.now()-Math.min(Date.parse(data.updated),Date.parse(data.sourceFetchedAt)) > 36*3600000
    ? 'Stale published bundle (over 36 hours). Original source dates are unchanged.'
    : 'Published bundle within 36 hours. This is not a live upstream feed.';
}

export function trajectory(bundle,id) {
  const unknown = {label:'Trajectory not yet assessed',detail:'No valid reviewed criterion and measurement resolve this exact forecast.',records:[]};
  const layer = bundle.signals.observations, entries = layer?.items?.[id];
  if (layer?.schemaVersion !== 1 || layer.forecastSha256 !== bundle.forecastHash || !Array.isArray(entries) || !entries.length) return unknown;
  const valid = entries.every(row=>row?.reviewed === true && nonempty(row.reviewedBy) && validTime(row.reviewedAt) &&
    ['supporting','mixed','challenging'].includes(row.direction) && nonempty(row.criterion?.id) &&
    nonempty(row.criterion.version) && nonempty(row.criterion.description) && Number.isFinite(row.measurement?.value) &&
    nonempty(row.measurement.unit) && validTime(row.measurement.observedAt) && safeLink(row.source?.url) &&
    validTime(row.source.publishedAt) && validTime(row.source.fetchedAt) && nonempty(row.source.name) &&
    nonempty(row.rationale) && nonempty(row.limitations));
  if(!valid) return unknown;
  const directions = new Set(entries.map(row=>row.direction));
  const direction = directions.size > 1 || directions.has('mixed') ? 'mixed' : entries[0].direction;
  return {label:{supporting:'Supporting observations',mixed:'Mixed observations',challenging:'Challenging observations'}[direction],
    detail:'Reviewed against stated criteria. Not proof that the target is achieved and not a new probability.',records:entries};
}

export function forecastTiming(row, tools) {
  if(row.kind === 'horizon') return 'Deliberately undated; conditional on aligned superintelligence and every stated prerequisite.';
  const data = row.data, month = data.m;
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isFinite(data.mBand))
    return 'Estimated timing unavailable; inspect the original forecast parameters.';
  const names = tools.MONTH_NAMES;
  const main = data.mPrecision === 'month' && Array.isArray(names) ? `${names[month-1]} ${row.year}`
    : data.mPrecision === 'quarter' ? `Q${Math.ceil(month/3)} ${row.year}`
    : data.mPrecision === 'half' ? `H${month<=6?1:2} ${row.year}`
    : `${month<=4?'Early':month<=8?'Mid':'Late'} ${row.year}`;
  return `${main}; author-estimated timing band +/- ${data.mBand} months (${data.mPrecision} precision).`;
}

const storageFault = error => error instanceof DOMException || ['SecurityError','QuotaExceededError','NS_ERROR_DOM_QUOTA_REACHED'].includes(error?.name);
export class CampaignStore {
  constructor() {
    this.mode='local';this.message='Saved on this browser only.';this.raw=null;this.saved=null;
    try { this.storage=window.localStorage;this.raw=this.storage.getItem(SAVE_KEY); }
    catch(error) {
      if(!storageFault(error)) throw error;
      this.mode='session';this.message='Session only: browser storage is unavailable. Existing data has not been overwritten.';return;
    }
    if(!this.raw) return;
    try {
      need(new TextEncoder().encode(this.raw).length <= SAVE_LIMIT,'Saved campaign exceeds the supported size.');
      const value=JSON.parse(this.raw);
      need(value?.version === GAME_VERSION && nonempty(value.rulesVersion) && hashPattern.test(value.rulesHash) &&
        hashPattern.test(value.forecastHash) && hashPattern.test(value.bookHash) && hashPattern.test(value.toolsHash) && hashPattern.test(value.mappingHash) &&
        recordObject(value.recordHashes) && Object.keys(value.recordHashes).length <= 1000 &&
        Object.entries(value.recordHashes).every(([id,hash])=>idPattern.test(id)&&hashPattern.test(hash)) &&
        Object.hasOwn(PROFILES,value.profile) && Number.isInteger(value.seed) && value.seed>=0 && value.seed<=0xffffffff &&
        Array.isArray(value.actions) && value.actions.length<=100 &&
        (value.location == null || (recordObject(value.location) &&
          ['x','z','yaw','pitch','zoom'].every(key=>Number.isFinite(value.location[key])) &&
          Math.abs(value.location.x)<=200 && Math.abs(value.location.z)<=200)),
        'Saved campaign has an unsupported or invalid schema.');
      this.saved=value;
    } catch(error) {
      if(!(error instanceof SyntaxError) && !(error instanceof GameDataError)) throw error;
      this.mode='session';this.message='Session only: saved data is corrupt or unsupported. The old value is retained; an explicit reset is required to replace it.';
    }
  }
  resume(bundle) {
    if(!this.saved) return {kind:'unavailable',message:this.raw?this.message:'No saved campaign was found.'};
    const value=this.saved;
    const sameRules=value.rulesVersion===RULES_VERSION && value.rulesHash===bundle.rulesHash &&
      value.bookHash===bundle.content.bookSha256 && value.toolsHash===bundle.content.toolsSha256 && value.mappingHash===bundle.content.mappingSha256;
    const changedIds=[...new Set([...Object.keys(value.recordHashes),...Object.keys(bundle.recordHashes)])]
      .filter(id=>value.recordHashes[id]!==bundle.recordHashes[id]);
    if(!sameRules || changedIds.length) return {kind:'incompatible',changedIds,
      message:'This saved campaign belongs to changed content or game rules. Its old record is retained; start/reset explicitly rather than reusing incompatible progress.'};
    let state;
    try { state=replayActions(value.profile,value.seed,value.actions); }
    catch(error) {
      if(!(error instanceof GameRuleError)) throw error;
      this.mode='session';this.message='Session only: saved actions do not form a valid campaign. The original save is retained.';
      return {kind:'incompatible',changedIds:[],message:this.message};
    }
    return {kind:value.forecastHash===bundle.forecastHash?'ready':'rebind',state,location:value.location,
      message:value.forecastHash===bundle.forecastHash?'Compatible campaign restored.':'Publication metadata changed; record identities and rules match. Review and explicitly rebind before saving.'};
  }
  save(bundle,state,location,preferences={}) {
    if(this.mode !== 'local') return false;
    const value={version:GAME_VERSION,rulesVersion:RULES_VERSION,rulesHash:bundle.rulesHash,
      forecastHash:bundle.forecastHash,bookHash:bundle.content.bookSha256,toolsHash:bundle.content.toolsSha256,
      mappingHash:bundle.content.mappingSha256,
      recordHashes:bundle.recordHashes,profile:state.profile,seed:state.seed,actions:checkpointActions(state),location,preferences};
    const text=JSON.stringify(value);
    if(new TextEncoder().encode(text).length>SAVE_LIMIT) {
      this.mode='session';this.message='Session only: this campaign exceeds the save limit. Earlier local progress remains.';return false;
    }
    try {
      if(this.storage.getItem(SAVE_KEY)!==this.raw) {
        this.mode='session';this.message='Session only: another tab changed the campaign save. Its progress will not be overwritten.';return false;
      }
      this.storage.setItem(SAVE_KEY,text);this.raw=text;this.saved=value;this.message='Saved on this browser only.';return true;
    }
    catch(error) {
      if(!storageFault(error)) throw error;
      this.mode='session';this.message='Session only: this change could not be saved. Earlier local progress may remain; reset explicitly to retry.';return false;
    }
  }
  reset() {
    try {
      this.storage=window.localStorage;this.storage.removeItem(SAVE_KEY);
      this.raw=null;this.saved=null;this.mode='local';this.message='Only the campaign save was cleared. Existing planning/watchlist data is unchanged.';return true;
    } catch(error) {
      if(!storageFault(error)) throw error;
      this.mode='session';this.message='Session-only reset: local storage could not be cleared. Earlier saved data may remain.';return false;
    }
  }
}

export function startPublishedRefresh({getBundle,onBundle,onStatus}) {
  let controller=null,timer=0,failures=0,lastAttempt=0,stopped=false;
  const schedule=()=>{clearTimeout(timer);if(!stopped&&!document.hidden)timer=setTimeout(check,Math.min(1800000,300000*2**failures));};
  async function check() {
    if(stopped||document.hidden||controller||Date.now()-lastAttempt<15000)return;
    lastAttempt=Date.now();controller=new AbortController();
    const current=controller,started=performance.now();
    onStatus({message:'Checking published artifacts...',checking:true});
    try {
      const next=await loadBundle({signal:current.signal,previous:getBundle()});
      if(stopped||current.signal.aborted)return;
      failures=0;
      const prior=getBundle();
      const sameIdentity=next.forecastHash===prior.forecastHash && next.rulesHash===prior.rulesHash &&
        next.content.bookSha256===prior.content.bookSha256 && next.content.toolsSha256===prior.content.toolsSha256 &&
        next.content.mappingSha256===prior.content.mappingSha256;
      onBundle(next,sameIdentity);
      onStatus({message:`Browser checked ${displayTime(new Date().toISOString())}; round trip ${Math.round(performance.now()-started)} ms. Published-artifact polling only.`,checking:false});
    } catch(error) {
      if(stopped||current.signal.reason==='hidden')return;
      failures++;
      onStatus({message:`Update unavailable: ${error.message}. Last good snapshot retained.`,checking:false,error:true});
    } finally {controller=null;schedule();}
  }
  const visibility=()=>{if(document.hidden){clearTimeout(timer);controller?.abort('hidden');}else schedule();};
  document.addEventListener('visibilitychange',visibility);schedule();
  return {check,stop(){stopped=true;clearTimeout(timer);controller?.abort('exit');document.removeEventListener('visibilitychange',visibility);}};
}
