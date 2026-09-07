'use strict';
const crypto = require('node:crypto');
const acorn = require('acorn');

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const allowedTags = new Set(['article','section','div','span','p','h1','h2','h3','h4','h5','h6','strong','em','b','i','small',
  'ul','ol','li','blockquote','br','hr','a','table','thead','tbody','tr','th','td','pre','code','sup','sub','figure','figcaption','dl','dt','dd']);
const attribute = (node,name) => node.attrs?.find(item => item.name === name)?.value;
const descendants = node => [node,...(node.childNodes || []).flatMap(descendants)];
const textOf = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(textOf).join('');
class ToolShapeError extends Error {}

function literal(node) {
  if (!node) throw new ToolShapeError('Missing canonical literal.');
  if (node.type === 'Literal' && ['string','number','boolean'].includes(typeof node.value)) return node.value;
  if (node.type === 'Literal' && node.value === null) return null;
  if (node.type === 'UnaryExpression' && ['-','+'].includes(node.operator) && node.argument.type === 'Literal')
    return node.operator === '-' ? -node.argument.value : +node.argument.value;
  if (node.type === 'ArrayExpression') return node.elements.map(literal);
  if (node.type === 'ObjectExpression') return Object.fromEntries(node.properties.map(property => {
    if (property.type !== 'Property' || property.computed || property.kind !== 'init') throw new ToolShapeError('Nonliteral tool configuration');
    return [property.key.name ?? property.key.value,literal(property.value)];
  }));
  throw new ToolShapeError(`Nonliteral tool configuration: ${node.type}`);
}

function astNodes(node) {
  if (!node || typeof node !== 'object') return [];
  return [node,...Object.values(node).flatMap(value => Array.isArray(value) ? value.flatMap(astNodes) : astNodes(value))];
}

function safeHref(value) {
  if (typeof value !== 'string') return '';
  if (value.startsWith('#')) return '/' + value;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const parsed = new URL(value);
    return ['http:','https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : '';
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return '';
  }
}

function semanticNode(node) {
  if (node.nodeName === '#text') return node.value;
  if (!node.tagName || ['script','style','template'].includes(node.tagName)) return null;
  const children = (node.childNodes || []).map(semanticNode).filter(value => value !== null);
  if (!allowedTags.has(node.tagName)) return children.length ? { tag:'div',children } : null;
  const value = { tag:node.tagName,children };
  if (node.tagName === 'a') {
    const href = safeHref(attribute(node,'href'));
    if (href) value.href = href;
  }
  return value;
}

async function extractCanonical(html, app) {
  const { parse, serialize } = await import('parse5');
  const document = parse(html,{sourceCodeLocationInfo:true});
  const nodes = descendants(document);
  const source = nodes.find(node => attribute(node,'id') === 'bookSource');
  if (!source) throw new Error('Canonical #bookSource is missing; no empty book projection is permitted.');
  const book = (source.childNodes || []).filter(node => node.tagName === 'article').map(node => {
    const index = Number(attribute(node,'data-idx'));
    const heading = descendants(node).find(child => child.tagName === 'h1');
    if (!Number.isInteger(index) || !heading) throw new Error('A book article has no stable index or title.');
    const blocks = node.childNodes.map(semanticNode).filter(value => value !== null);
    return { index,title:textOf(heading).replace(/\s+/g,' ').trim(),blocks };
  });
  if (!book.length || new Set(book.map(row=>row.index)).size !== book.length) throw new Error('Book projection is empty or duplicates chapter identities.');
  const rawBook = html.slice(source.sourceCodeLocation.startTag.endOffset,source.sourceCodeLocation.endTag.startOffset);
  const canonicalBook = serialize(source);
  const ast = acorn.parse(app,{ecmaVersion:'latest',sourceType:'script'});
  const all = astNodes(ast);
  const tools = {}, reviewGaps = [];
  const names = ['sixDs','futures','allocBuckets','questions','chapters','simulatorPresets','simulatorOutcomeLabels','MONTH_NAMES'];
  for (const name of names) {
    const declarations = all.filter(node => node.type === 'VariableDeclarator' && node.id?.name === name);
    if (declarations.length !== 1) {
      reviewGaps.push({id:name,kind:'tool-shape-changed',detail:'Expected one canonical literal declaration.'});
      continue;
    }
    try { tools[name] = literal(declarations[0].init); }
    catch (error) {
      if (!(error instanceof ToolShapeError)) throw error;
      reviewGaps.push({id:name,kind:'tool-shape-changed',detail:error.message});
    }
  }
  tools.functions = {};
  for (const name of ['simulatedProbabilities','simulatorAnchors','renderResult','estimatedTiming','monthPhase']) {
    const found = all.filter(node => node.type === 'FunctionDeclaration' && node.id?.name === name);
    if (found.length !== 1) reviewGaps.push({id:name,kind:'tool-shape-changed',detail:'Canonical assumption function is missing or ambiguous.'});
    else tools.functions[name] = app.slice(found[0].start,found[0].end).replace(/\r\n/g,'\n');
  }
  const netWorth = all.filter(node => node.type === 'VariableDeclarator' && node.id?.name === 'netWorth');
  if (netWorth.length === 1) {
    tools.exampleNetWorth = literal(netWorth[0].init);
    const allocator = all.filter(node => node.type === 'FunctionExpression' &&
      node.start < netWorth[0].start && node.end > netWorth[0].end).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
    if (allocator) tools.functions.portfolioAllocator = app.slice(allocator.start,allocator.end).replace(/\r\n/g,'\n');
  }
  else reviewGaps.push({id:'netWorth',kind:'tool-shape-changed',detail:'The canonical example value is ambiguous.'});
  const normalizer = all.filter(node => node.type === 'CallExpression'
    && node.callee?.property?.name === 'addEventListener'
    && node.callee.object?.type === 'CallExpression'
    && node.callee.object.callee?.property?.name === 'getElementById'
    && node.callee.object.arguments?.[0]?.value === 'allocNormalize');
  if (normalizer.length === 1) {
    const handler = normalizer[0].arguments[1];
    tools.functions.normalizeAllocation = app.slice(handler.start,handler.end).replace(/\r\n/g,'\n');
  } else reviewGaps.push({id:'allocNormalize',kind:'tool-shape-changed',detail:'Canonical normalization handler is missing or ambiguous.'});
  tools.controls = nodes.filter(node => node.tagName === 'input' && attribute(node,'id')).map(node => ({
    id:attribute(node,'id'),type:attribute(node,'type')||'text',min:attribute(node,'min')??null,
    max:attribute(node,'max')??null,step:attribute(node,'step')??null,value:attribute(node,'value')??null,
  }));
  const guide = nodes.filter(node => node.tagName === 'section' && attribute(node,'id')).map(node => {
    const heading = descendants(node).find(child => ['h1','h2'].includes(child.tagName));
    return {id:attribute(node,'id'),title:heading?textOf(heading).replace(/\s+/g,' ').trim():attribute(node,'id'),
      text:textOf(node).replace(/\s+/g,' ').trim()};
  });
  for (const [id,title,find,sourceHref] of [
    ['navigation','Original navigation',node=>node.tagName==='nav','/'],
    ['hero','Original opening and observatory',node=>node.tagName==='header'&&(attribute(node,'class')||'').split(/\s+/).includes('hero'),'/'],
    ['reader','Original complete-book reader controls',node=>attribute(node,'id')==='reader','/#book'],
    ['missionResetDialog','Original planning reset controls',node=>attribute(node,'id')==='missionResetDialog','/#mission-control'],
    ['footer','Original footer and model-input disclaimers',node=>node.tagName==='footer','/'],
  ]) {
    const node=nodes.find(find);
    if(!node)reviewGaps.push({id,kind:'site-section-missing',detail:'An original major content/control surface is missing.'});
    else if(!guide.some(row=>row.id===id))guide.push({id,title,text:textOf(node).replace(/\s+/g,' ').trim(),sourceHref});
  }
  return {book,bookSha256:sha(canonicalBook),bookCharacters:canonicalBook.length,rawBookSha256:sha(rawBook),tools,
    toolsSha256:sha(JSON.stringify(tools)),guide,reviewGaps,sourceIndexSha256:sha(html)};
}

function roster(predictions) {
  return [...predictions.years.flatMap(year => year.events.map((data,index) => ({id:`${year.year}-${index}`,data}))),
    ...predictions.postSuperintelligence.items.map(data => ({id:`horizon-${data.id}`,data}))];
}

function buildProjection({canonical,predictions,author,mapping,core}) {
  if (mapping?.schemaVersion !== 1 || !Array.isArray(mapping.mappings) || !Array.isArray(mapping.sections))
    throw new Error('Reviewed game mapping is missing or invalid.');
  const rows = roster(predictions), ids = new Set(rows.map(row=>row.id)), seen = new Set();
  if (ids.size !== rows.length) throw new Error('Canonical forecast identities are duplicated.');
  const pending = [...canonical.reviewGaps], mappings = [];
  for (const row of mapping.mappings) {
    if (seen.has(row.forecastId)) throw new Error(`Duplicate reviewed game mapping: ${row.forecastId}`);
    seen.add(row.forecastId);
    const mission = core.MISSIONS.find(item => item.id === row.mission);
    if (!mission || row.region !== mission.region || row.task !== mission.task.kind ||
      !Array.isArray(row.choices) || JSON.stringify(row.choices) !== JSON.stringify(mission.choices.map(item=>item.id)) ||
      !Array.isArray(row.chapters) || !row.chapters.length || !row.chapters.every(index=>canonical.book.some(chapter=>chapter.index===index)) ||
      ![row.mechanicRole,row.conceptScenario,row.tradeoff,row.simulationScope].every(value=>typeof value==='string'&&value.trim()) ||
      !/^[a-f0-9]{64}$/.test(row.recordSha256)) throw new Error(`Invalid or unimplemented game mapping: ${row.forecastId}`);
    if (!ids.has(row.forecastId)) pending.push({id:row.forecastId,kind:'removed-id',expected:row.recordSha256,observed:null});
  }
  for (const record of rows) {
    const entry = mapping.mappings.find(row=>row.forecastId===record.id), hash = sha(JSON.stringify(record.data));
    if (!entry) pending.push({id:record.id,kind:'new-id',expected:null,observed:hash});
    else if (entry.recordSha256 !== hash) pending.push({id:record.id,kind:'changed-record',expected:entry.recordSha256,observed:hash});
    else mappings.push(entry);
  }
  if (mapping.bookSha256 !== canonical.bookSha256)
    pending.push({id:'bookSource',kind:'changed-book',expected:mapping.bookSha256,observed:canonical.bookSha256});
  if (mapping.toolsSha256 !== canonical.toolsSha256)
    pending.push({id:'source-tools',kind:'changed-tools',expected:mapping.toolsSha256,observed:canonical.toolsSha256});
  const chapterIds = canonical.book.map(row=>row.index);
  for (const index of chapterIds) if (!core.MISSIONS.some(row=>row.chapter===index))
    pending.push({id:`chapter-${index}`,kind:'unmapped-chapter'});
  const sectionIds = canonical.guide.map(row=>row.id);
  for (const id of sectionIds) if (!mapping.sections.some(row=>row.id===id))
    pending.push({id,kind:'unmapped-site-section'});
  return {
    schemaVersion:1,rulesVersion:core.RULES_VERSION,rulesSha256:sha(core.rulesDescriptor()),
    forecastSha256:sha(JSON.stringify(predictions)),authorSha256:sha(JSON.stringify(author)),
    bookSha256:canonical.bookSha256,toolsSha256:canonical.toolsSha256,
    mappingSha256:sha(JSON.stringify(mapping)),sourceIndexSha256:canonical.sourceIndexSha256,
    book:canonical.book,bookCharacters:canonical.bookCharacters,tools:canonical.tools,guide:canonical.guide,
    chapterMissions:core.MISSIONS.map(row=>({chapter:row.chapter,mission:row.id})),sections:mapping.sections,
    mappings,coverage:{status:pending.length?'review-required':'ready',forecasts:rows.length,mapped:mappings.length,
      chapters:chapterIds.length,sections:sectionIds.length,pending},
    notice:'Game fiction and concept mapping only. Original probabilities, evidence and planning assumptions remain separate and unchanged. Live evidence is read exclusively from canonical signals.json.',
  };
}

module.exports = {sha,extractCanonical,roster,buildProjection,allowedTags,safeHref};
