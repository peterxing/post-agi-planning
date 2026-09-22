const byId = id => document.getElementById(id);
const yearHost = byId('yearContent');
const status = byId('recordStatus');
const search = document.querySelector('[data-reader-search]');
const dateFormat = new Intl.DateTimeFormat('en-GB', { day:'numeric', month:'short', year:'numeric', timeZone:'UTC' });
const monthFormat = new Intl.DateTimeFormat('en-GB', { month:'long', year:'numeric', timeZone:'UTC' });
const typeLabels = { direct:'Reporting / observation', 'leading-indicator':'Partial leading indicator', scenario:'Scenario reporting' };
let engine, model, forecastData, selectedYear = 2026, visibleCount = 6, query = '', request = null, pending = null;
let refreshTimer = 0, refreshFailures = 0, recordController = null, suppressHashRestore = '';
const readingPositions = new Map();

function node(tag, className, text){
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}
function link(text, href, external = false){
  const element = node('a', '', text);
  element.href = href;
  if (external) { element.target = '_blank'; element.rel = 'noopener noreferrer'; }
  return element;
}
function action(text, handler){
  const element = node('button', 'text-button', text);
  element.type = 'button';
  element.addEventListener('click', handler);
  return element;
}
function recordsFor(data){
  if (!Array.isArray(data?.years) || !Array.isArray(data?.postSuperintelligence?.items)) throw new Error('Forecast structure is unavailable.');
  return [
    ...data.years.flatMap(year => year.events.map((data, index) => ({
      id:`${year.year}-${index}`, title:data.t, data, timing:String(year.year),
      probability:`${data.prob}% stated probability`, href:`#event-${year.year}-${index}`,
    }))),
    ...data.postSuperintelligence.items.map(data => ({
      id:`horizon-${data.id}`, title:data.t, data, timing:'Dependency-gated / undated',
      probability:`${data.conditionalProb}% conditional plausibility`, href:`#horizon-${data.id}`,
    })),
  ];
}
async function fingerprint(data){
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(data)));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function readJson(name, signal){
  const response = await fetch(name, { cache:'no-cache', signal });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}.`);
  const text = await response.text();
  if (text.length > 2000000) throw new Error('Published snapshot exceeds its size limit.');
  return JSON.parse(text);
}
function dateLabel(date){
  return date.at == null ? date.label : dateFormat.format(date.at);
}
function sourceId(article){
  return `article-${encodeURIComponent(article.key)}`;
}
function recorded(value){
  return value ? engine.parsePublishedDate(value).label : 'not recorded';
}
function position(){
  const article = [...document.querySelectorAll('.story, .forecast-card')].find(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.bottom > 120 && bounds.top < innerHeight;
  });
  const active = document.activeElement;
  const control = active?.getAttribute('href') || active?.dataset.watch;
  return { id:article?.id, top:article?.getBoundingClientRect().top, focus:active?.id,
    focusHost:active?.closest('[id]')?.id, control,
    open:[...document.querySelectorAll('main details[open][id]')].map(element => element.id) };
}
function restore(saved){
  const apply = () => {
    for (const id of saved.open) { const element = byId(id); if (element) element.open = true; }
  };
  apply();
  requestAnimationFrame(() => {
    apply();
    requestAnimationFrame(() => {
      const host = byId(saved.focusHost);
      const control = saved.control && host ? [...host.querySelectorAll('a[href], [data-watch]')]
        .find(element => element.getAttribute('href') === saved.control || element.dataset.watch === saved.control) : null;
      (byId(saved.focus) || control)?.focus({ preventScroll:true });
      if (saved.id && byId(saved.id)) scrollBy({ top:byId(saved.id).getBoundingClientRect().top - saved.top, behavior:'instant' });
    });
  });
}
function rememberReadingPosition(){
  if (!model) return;
  const saved = { selectedYear, visibleCount, query, position:position(), scrollY };
  readingPositions.set(location.hash, saved);
}
function restoreReadingPosition(){
  const saved = readingPositions.get(location.hash);
  if (!saved || !model) return false;
  selectedYear = saved.selectedYear; visibleCount = saved.visibleCount; query = search.value = saved.query;
  renderYear();
  scrollTo({ top:saved.scrollY, behavior:'instant' }); restore(saved.position);
  return true;
}
function setRecordStatus(error = ''){
  observationError = error;
  status.dataset.state = error ? 'error' : 'ready';
  if (error) {
    status.textContent = `${model ? 'Last good record retained.' : 'The published record is unavailable.'} ${error}`;
    if (exploreSession) renderObservationHealth();
    return;
  }
  const count = model.articles.filter(article => article.date.year >= 2026).length;
  status.textContent = `${count} reports from 2026 onward. A curated record of currently reviewed NEWS, not an exhaustive archive.`;
  const stale = Date.now() - Math.min(model.updated, model.fetched) > 36 * 3600000;
  byId('recordDates').textContent = `Snapshot published ${recorded(model.bundle.updated)}. Source collection ${recorded(model.bundle.sourceFetchedAt)}. `
    + `${stale ? 'The recorded collection is stale. ' : ''}Review and verification dates belong to individual sources; this is not a live feed. Author estimates are not observed outcomes.`;
  byId('recordInfo').hidden = false;
}
async function loadRecord(){
  if (request) return request;
  const started = performance.now();
  byId('openTimeline').disabled = true;
  byId('refreshRecord').disabled = true;
  status.textContent = model ? 'Checking the published snapshot…' : 'Loading the curated published record…';
  request = (async () => {
    const controller = new AbortController();
    recordController = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      engine ||= await import('./news-timeline.js');
      const [predictions, signals] = await Promise.all([
        readJson('predictions.json', controller.signal), readJson('signals.json', controller.signal),
      ]);
      const hash = await fingerprint(predictions);
      assertPublishedRecord(signals, predictions, hash, model?.bundle || null);
      const candidate = engine.projectNews(recordsFor(predictions), signals, hash);
      if (model && (candidate.updated < model.updated || candidate.fetched < model.fetched)) throw new Error('An older snapshot was returned.');
      if (model && hash !== model.fingerprint) throw new Error('A new forecast revision is published. Reload to review it; the current record has not changed.');
      observationLastChecked = new Date().toISOString();
      observationLatency = Math.round(performance.now() - started);
      if (model && JSON.stringify(signals) === JSON.stringify(model.bundle)) {
        refreshFailures = 0;
        setRecordStatus();
      } else if (model && (byId('reader').open || document.activeElement?.closest('.story, .forecast-card, #explore'))) {
        pending = { candidate, predictions };
        status.textContent = 'A validated update is ready. Your reading position and current source details are retained.';
        byId('refreshRecord').textContent = 'Apply the reviewed snapshot';
        if (exploreSession) renderObservationHealth();
      } else applyRecord(candidate, predictions);
    } catch (error) {
      if (controller.signal.reason !== 'hidden') {
        refreshFailures++;
        setRecordStatus(error.name === 'AbortError' ? 'The request timed out. Try again.' : error.message);
      }
    } finally {
      clearTimeout(timeout);
      byId('openTimeline').disabled = false;
      byId('refreshRecord').disabled = false;
      request = null;
      recordController = null;
      scheduleRecordCheck();
    }
    function scheduleRecordCheck(){
      clearTimeout(refreshTimer);
      if (!model || document.hidden) return;
      refreshTimer = setTimeout(loadRecord, Math.min(1800000, 300000 * 2 ** refreshFailures));
    }
    document.addEventListener('visibilitychange', () => {
      clearTimeout(refreshTimer);
      if (document.hidden) recordController?.abort('hidden');
      else { if (model) setRecordStatus(observationError); scheduleRecordCheck(); }
    });
    addEventListener('pagehide', () => { clearTimeout(refreshTimer); recordController?.abort('hidden'); });
  })();
  return request;
}
function applyRecord(candidate, predictions){
  const saved = position();
  const prior = model;
  const newsChanged = !prior || JSON.stringify([prior.bundle.embeds, prior.bundle.context, prior.bundle.uncited])
    !== JSON.stringify([candidate.bundle.embeds, candidate.bundle.context, candidate.bundle.uncited]);
  model = candidate; forecastData = predictions; pending = null;
  refreshFailures = 0;
  observationLastChecked = new Date().toISOString();
  updateExploreSnapshot();
  if (saved.id) {
    const articles = engine.selectArticles(model.articles, { order:'oldest', query }).filter(article => article.date.year === selectedYear);
    const index = articles.findIndex(article => sourceId(article) === saved.id);
    if (index >= 0) visibleCount = Math.ceil((index + 1) / 6) * 6;
  }
  byId('refreshRecord').textContent = 'Check published updates';
  byId('openTimeline').hidden = true;
  document.querySelector('.timeline-toolbar').hidden = false;
  if (!prior) {
    const rail = byId('yearRail');
    rail.replaceChildren();
    for (const year of predictions.years.filter(row => row.year >= 2026)) {
      const item = link(String(year.year), `#year-${year.year}`);
      item.dataset.year = String(year.year);
      rail.append(item);
    }
  }
  if (newsChanged) { renderYear(); renderEarlier(); renderHorizons(); }
  else document.querySelectorAll('.forecast-dossier[open] [data-forecast-dossier]').forEach(host => {
    const row = forecastRecords().find(item => item.id === host.dataset.forecastDossier);
    if (row) host.replaceWith(renderSourceDossier(row));
  });
  setRecordStatus();
  restore(saved);
  yearHost.dataset.forecastSha256 = candidate.fingerprint;
  yearHost.dataset.loaded = 'true';
  if (!saved.id) revealHash();
}
function renderProvenance(connection){
  const details = node('details', 'source-provenance');
  details.append(node('summary', '', 'Source record & limits'));
  details.append(node('p', '', `${connection.channel === 'context' ? 'Dated background, not current evidence' : 'Cited in this snapshot, not a freshness claim'}. ${typeLabels[connection.type]}. NEWS source quality: ${qualityLabel(connection.quality)}.`));
  details.append(node('p', '', `Mapping reviewed: ${recorded(connection.reviewedAt)}. Recorded verification: ${recorded(connection.verifiedAt)}. Retrieved: ${recorded(connection.retrievedAt)}.`));
  const health = connection.health;
  details.append(node('p', '', health
    ? `NEWS health: ${health.status}. Checked ${recorded(health.lastCheckedAt)}; verified ${recorded(health.lastVerifiedAt)}.`
    : 'Current health is not recorded in this NEWS record. Checks from the separate research-reference layer are not substituted.'));
  details.append(node('p', '', `Reviewed source text SHA-256: ${connection.textSha256}.`));
  return details;
}
function renderConnection(connection, article){
  const section = node('section', 'connection');
  const targetYear = connection.id.startsWith('horizon-') ? 'BEYOND THE TIMELINE' : `${connection.forecast.timing} FORECAST`;
  section.append(node('p', 'connection-kicker', `${dateLabel(article.date)} REPORT → ${targetYear}`));
  const heading = node('h6');
  heading.append(link(connection.forecast.title, connection.forecast.href));
  section.append(heading);
  const rationale = node('p', 'connection-rationale');
  rationale.append(node('strong', '', 'Why this connection matters — and what it does not establish'),
    document.createTextNode(connection.rationale));
  section.append(rationale, renderProvenance(connection));
  return section;
}
function renderStory(article){
  const story = node('article', 'story');
  story.id = sourceId(article); story.tabIndex = -1;
  story.dataset.publishedAt = article.date.value || '';
  const meta = node('p', 'story-meta');
  const date = node(article.date.value ? 'time' : 'span', '', dateLabel(article.date));
  if (article.date.value) { date.dateTime = article.date.value; date.title = article.date.label; }
  meta.append(node('span', 'reported-label', 'Reported'), date, node('span', '', article.publisher));
  const title = node('h5');
  title.append(link(article.title, engine.safeSourceUrl(article.url), true));
  const detail = node('details');
  detail.name = 'reader-news-connections';
  detail.id = `connections-${encodeURIComponent(article.key)}`;
  detail.append(node('summary', '', `How this informs ${article.connections.length === 1 ? 'the forecast' : `${article.connections.length} forecasts`}`));
  let connectionPage = 0;
  function connections(){
    while (detail.children.length > 1) detail.lastElementChild.remove();
    const selected = article.connections.slice(connectionPage * 6, (connectionPage + 1) * 6);
    for (const connection of selected) detail.append(renderConnection(connection, article));
    if (article.connections.length > 6) {
      const pages = node('nav', 'more-stories');
      pages.setAttribute('aria-label', 'Forecast connections for this report');
      const previous = action('← Previous connections', () => { connectionPage--; connections(); detail.querySelector('h6 a').focus(); });
      const next = action('Next connections →', () => { connectionPage++; connections(); detail.querySelector('h6 a').focus(); });
      previous.disabled = connectionPage === 0;
      next.disabled = (connectionPage + 1) * 6 >= article.connections.length;
      pages.append(previous, next); detail.append(pages);
    }
    detail.append(node('p', 'article-note', `Published ${article.date.label}. ${engine.publicationAge(article.date)}. Original article opens in a new tab. A connection is not confirmation and does not change a probability.`));
  }
  detail.addEventListener('toggle', () => {
    story.classList.toggle('story-open', detail.open);
    if (!detail.open) {
      while (detail.children.length > 1) detail.lastElementChild.remove();
      return;
    }
    for (const other of document.querySelectorAll('.story > details[open]')) if (other !== detail) other.open = false;
    connectionPage = 0; connections();
  });
  const preview = article.connections.length === 1
    ? article.connections[0].rationale.match(/^.+?[.!?](?:\s|$)/)?.[0]?.trim()
    : `One reported article, ${article.connections.length} separately reviewed forecast connections.`;
  story.append(meta, title);
  if (preview) story.append(node('p', 'why-preview', preview));
  story.append(detail);
  return story;
}
function relatedArticles(id){
  return engine.selectArticles(model.articles, { order:'oldest', forecast:id });
}
function renderForecast(row){
  const details = node('details', 'forecast-card');
  details.id = row.href.slice(1);
  details.tabIndex = -1;
  const summary = node('summary', '', row.title);
  details.append(summary);
  details.addEventListener('toggle', () => {
    if (!details.open || details.dataset.rendered) return;
    const body = node('div', 'forecast-facts');
    const probability = node('p');
    probability.append(node('strong', '', row.id.startsWith('horizon-') ? `${row.data.conditionalProb}% conditional plausibility` : `${row.data.prob}% authored estimate`),
      document.createTextNode('Peter’s estimate, not an observed outcome or a market price.'));
    body.append(probability);
    if (row.id.startsWith('horizon-')) {
      body.append(node('p', '', 'Dependency-gated / undated'));
      body.append(node('p', '', `Epistemic status: ${row.data.epistemic}.`));
      const list = node('ul');
      for (const dependency of row.data.dependencies || []) list.append(node('li', '', dependency));
      body.append(list, node('p', '', row.data.caveat));
      const indicators = node('ul');
      for (const indicator of row.data.indicators || []) indicators.append(node('li', '', indicator));
      body.append(node('p', '', 'Leading indicators to watch, not a record of achieved outcomes:'), indicators);
    } else {
      const timing = estimatedTiming(row.data, Number(row.timing));
      body.append(node('p', '', timing ? `Timing estimate: ${timing.label} ${timing.bandText}. Precision: ${timing.precision}.` : 'Estimated timing is not recorded.'));
      if (timing?.elapsed) body.append(node('p', 'dossier-note', 'The estimated window has elapsed. This does not establish whether the outcome occurred.'));
      if (row.data.mBasis) body.append(node('p', '', row.data.mBasis));
    }
    const related = relatedArticles(row.id), sources = node('ul', 'forecast-sources');
    body.append(node('p', '', related.length ? 'Read the connected reporting in its actual publication year:' : 'No reviewed NEWS article is currently connected. This is not evidence that the forecast has occurred.'));
    for (const article of related) {
      const item = node('li');
      item.append(link(`${dateLabel(article.date)} · ${article.title}`, `#${sourceId(article)}`));
      sources.append(item);
    }
    body.append(sources, watchControl(row.id), forecastDossierControl(row));
    details.append(body); details.dataset.rendered = 'true';
  });
  return details;
}
function renderYear(){
  if (!model) return;
  const year = forecastData.years.find(row => row.year === selectedYear);
  if (!year) return;
  const heading = node('div', 'year-heading');
  heading.id = `year-${selectedYear}`; heading.tabIndex = -1;
  const outlook = node('p');
  outlook.append(node('strong', 'outlook-label', 'Peter’s outlook for this year'), document.createTextNode(year.summary));
  heading.append(node('h3', '', String(selectedYear)), outlook);
  const columns = node('div', 'year-columns');
  const reports = node('section');
  reports.append(node('h4', 'column-label', 'The reported record / publication order'));
  const all = engine.selectArticles(model.articles, { order:'oldest', query }).filter(article => article.date.year === selectedYear);
  visibleCount = Math.max(6, Math.min(visibleCount, Math.ceil(all.length / 6) * 6 || 6));
  const visible = all.slice(Math.max(0, visibleCount - 6), visibleCount);
  let month = '';
  for (const article of visible) {
    if (article.date.group !== month) {
      month = article.date.group;
      reports.append(node('p', 'month-label', month));
    }
    reports.append(renderStory(article));
  }
  if (!all.length) reports.append(node('p', 'empty-record', query
    ? 'No reports match this theme in this year. Clear the search to restore the record.'
    : 'No reviewed report is published in this year in the loaded record. The milestones shown alongside are forecasts, not future facts.'));
  if (visibleCount < all.length || visibleCount > 6) {
    const footer = node('div', 'more-stories');
    if (visibleCount > 6) footer.append(action('← Previous reports', () => {
      visibleCount -= 6; renderYear(); byId(`year-${selectedYear}`).focus();
    }));
    if (visibleCount < all.length) footer.append(action('Continue through the year →', () => {
      visibleCount += 6; renderYear();
      const first = yearHost.querySelector('.story');
      first.focus({ preventScroll:true }); first.scrollIntoView({ block:'start', behavior:'instant' });
    }));
    footer.append(node('span', '', `${Math.max(1, visibleCount - 5)}–${Math.min(visibleCount, all.length)} of ${all.length} reports`));
    reports.append(footer);
  }
  const forecasts = node('aside', 'forecast-reading');
  forecasts.append(node('h4', 'column-label', `Forecasts for ${selectedYear}`), node('p', '', 'Authored milestones, not a record of what has happened. Open a forecast for its estimate, timing and connected reports.'));
  for (const row of model.records.filter(row => row.timing === String(selectedYear)
    && (!query || row.title.toLowerCase().includes(query.toLowerCase())))) forecasts.append(renderForecast(row));
  if (selectedYear > 2026 && !all.length && !query) {
    columns.classList.add('forecast-year');
    const note = node('p', 'empty-record', 'No reviewed reports are dated to this year in the loaded record. These are authored forecasts, not future facts.');
    columns.append(note, forecasts);
  } else columns.append(reports, forecasts);
  yearHost.replaceChildren(heading, columns);
  for (const item of byId('yearRail').querySelectorAll('a')) {
    if (item.dataset.year === String(selectedYear)) item.setAttribute('aria-current', 'date');
    else item.removeAttribute('aria-current');
  }
  const years = forecastData.years.filter(item => item.year >= 2026).map(item => item.year);
  document.querySelector('[data-year-step="-1"]').disabled = selectedYear === years[0];
  document.querySelector('[data-year-step="1"]').disabled = selectedYear === years.at(-1);
  const current = byId('yearRail').querySelector('[aria-current="date"]');
  if (current) {
    const rail = byId('yearRail'), bounds = current.getBoundingClientRect(), viewport = rail.getBoundingClientRect();
    if (bounds.left < viewport.left || bounds.right > viewport.right)
      rail.scrollLeft += bounds.left - viewport.left - (viewport.width - bounds.width) / 2;
  }
  byId('timelineAnnouncement').textContent = `${selectedYear}. ${all.length} matching reports, in publication order.`;
  yearHost.dataset.year = String(selectedYear);
}
function renderEarlier(){
  const host = byId('earlierStories');
  host.replaceChildren();
  const render = () => {
    if (!byId('earlierBackground').open || host.childElementCount) return;
    for (const article of engine.selectArticles(model.articles, { order:'oldest' }).filter(article => article.date.year < 2026 || !article.date.year))
      host.append(renderStory(article));
  };
  render();
  byId('earlierBackground').ontoggle = render;
}
function renderHorizons(){
  byId('horizonReading').replaceChildren(...model.records.filter(row => row.id.startsWith('horizon-')).map(renderForecast));
}
function refreshPublishedObservations(){ return loadRecord(); }
function applySignalBundle(data){
  if (!model || !forecastData) throw new Error('No coherent forecast is loaded.');
  assertPublishedRecord(data, forecastData, model.fingerprint, model.bundle);
  const next = engine.projectNews(recordsFor(forecastData), data, model.fingerprint);
  if (next.updated < model.updated || next.fetched < model.fetched) throw new Error('An older source record cannot replace the current record.');
  applyRecord(next, forecastData);
}
function revealHash(){
  if (suppressHashRestore === location.href) { suppressHashRestore = ''; return; }
  const hash = location.hash;
  if (/^#chapter-\d+$/.test(hash)) { openReader(Number(hash.slice(9))); return; }
  if (!model) {
    if (/^#(?:timeline|year-|event-|article-|horizon-|post-superintelligence|news-timeline|signals)/.test(hash)) loadRecord();
    else {
      const section = byId(hash.slice(1));
      if (section && !section.closest('#explore')) {
        section.tabIndex = -1;
        section.scrollIntoView({ block:'start', behavior:'instant' });
        section.focus({ preventScroll:true });
      }
    }
    return;
  }
  let target;
  const year = /^#(?:year-|event-)(\d{4})/.exec(hash);
  if (year) {
    if (!forecastData.years.some(row => row.year === Number(year[1]))) {
      byId('timelineAnnouncement').textContent = 'This timeline year is not present in the current forecast.';
      return;
    }
    selectedYear = Number(year[1]); query = search.value = ''; visibleCount = 6; renderYear();
    target = byId(hash.slice(1));
  } else if (hash.startsWith('#article-')) {
    const article = model.articles.find(item => `#${sourceId(item)}` === hash);
    if (!article) return;
    if (article.date.year >= 2026) {
      selectedYear = article.date.year; query = search.value = '';
      const articles = engine.selectArticles(model.articles, { order:'oldest' }).filter(item => item.date.year === selectedYear);
      visibleCount = Math.ceil((articles.indexOf(article) + 1) / 6) * 6; renderYear();
    } else {
      byId('earlierBackground').open = true;
      const host = byId('earlierStories');
      if (!host.childElementCount) for (const item of engine.selectArticles(model.articles, { order:'oldest' }).filter(item => item.date.year < 2026 || !item.date.year)) host.append(renderStory(item));
    }
    target = byId(sourceId(article));
    target.querySelector('details').open = true;
  } else if (hash.startsWith('#horizon-')) target = byId(hash.slice(1));
  else if (hash === '#news-timeline') target = byId('timeline');
  else target = byId(hash.slice(1));
  if (target?.closest('#explore')) { revealExploreHash(); return; }
  if (target) {
    if (target.tagName === 'DETAILS') target.open = true;
    if (!target.matches('a, button, input, select, summary')) target.tabIndex = -1;
    requestAnimationFrame(() => {
      target.scrollIntoView({ block:'start', behavior:'instant' });
      target.focus({ preventScroll:true });
    });
  }
}
byId('openTimeline').addEventListener('click', loadRecord);
byId('newsReset').addEventListener('click', () => {
  query = search.value = ''; selectedYear = 2026; visibleCount = 6;
  renderYear(); search.focus({ preventScroll:true });
  byId('timelineAnnouncement').textContent = 'Timeline reset to 2026. All themes are shown.';
});
document.querySelectorAll('[data-year-step]').forEach(button => button.addEventListener('click', () => {
  if (!forecastData) return;
  const years = forecastData.years.filter(year => year.year >= 2026).map(year => year.year);
  const index = years.indexOf(selectedYear) + Number(button.dataset.yearStep);
  if (index >= 0 && index < years.length) navigateSection(`#year-${years[index]}`);
}));
byId('refreshRecord').addEventListener('click', () => pending ? applyRecord(pending.candidate, pending.predictions) : loadRecord());
search.addEventListener('input', () => { query = search.value; visibleCount = 6; renderYear(); });
document.querySelectorAll('a[href="#timeline"]').forEach(element => element.addEventListener('click', () => {
  if (!model) loadRecord();
}));
addEventListener('hashchange', revealHash);
function navigateSection(hash){
  rememberReadingPosition();
  if (location.hash !== hash) history.pushState(null, '', hash);
  revealHash(); revealExploreHash();
}
document.addEventListener('click', event => {
  const target = event.target.closest('a[href^="#"]');
  if (!target || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const hash = target.getAttribute('href');
  if (/^#chapter-\d+$/.test(hash)) return;
  event.preventDefault();
  navigateSection(hash);
}, true);
addEventListener('popstate', () => {
  if (restoreReadingPosition()) suppressHashRestore = location.href;
  else { revealHash(); revealExploreHash(); suppressHashRestore = location.href; }
});
function syncTheme(){
  byId('themeToggle').setAttribute('aria-label', `Switch to ${document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'} theme`);
}
byId('themeToggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('pap-theme', next); }
  catch { byId('timelineAnnouncement').textContent = 'Theme changed for this visit; browser storage is unavailable.'; }
  syncTheme();
});
syncTheme();

const bookArticles = [...document.querySelectorAll('#bookSource > article[data-idx]')];
let readerReturnFocus, readerIndex = -1;
function openReader(index){
  const source = bookArticles.find(article => Number(article.dataset.idx) === index);
  if (!source) return;
  if (!byId('reader').open) readerReturnFocus = document.activeElement;
  readerIndex = index;
  byId('readerTitle').textContent = source.querySelector('h1').textContent;
  const content = node('div', 'reader-canonical');
  content.append(...[...source.childNodes].map(child => child.cloneNode(true)));
  const context = node('aside', 'reader-context');
  const read = action('I have read this chapter', () => {});
  read.dataset.readChapter = String(index);
  const progress = node('p', 'mission-help', 'Self-reported reading progress. Opening a chapter does not complete a quest.');
  progress.setAttribute('role', 'status');
  const chapter = chapters[index];
  const destination = /1000-Day/i.test(chapter.title) ? ['#moonshot','Open the 1000-day planner']
    : /Five Futures/i.test(chapter.title) ? ['#futures','Open the scenario portfolio']
      : chapter.route === 'Risk' ? ['#post-superintelligence','Inspect the dependency-gated horizon']
        : chapter.route === 'Capability' ? ['#timeline','Return to the dated forecast'] : ['#engine','Trace the abundance engine'];
  const related = link(destination[1], destination[0]);
  related.addEventListener('click', () => byId('reader').close());
  context.append(read, progress, related);
  byId('rdBody').replaceChildren(content, context);
  byId('rdPrev').disabled = index === 0;
  byId('rdNext').disabled = index === bookArticles.length - 1;
  byId('rdProgress').textContent = `${index + 1} / ${bookArticles.length}`;
  byId('rdToc').querySelectorAll('button').forEach((button, i) => {
    if (i === index) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  if (!byId('reader').open) byId('reader').showModal();
  byId('reader').scrollTop = 0;
}
window.openReader = openReader;
byId('closeReader').addEventListener('click', () => byId('reader').close());
byId('reader').addEventListener('close', () => readerReturnFocus?.focus({ preventScroll:true }));
byId('rdPrev').addEventListener('click', () => { if (readerIndex > 0) openReader(readerIndex - 1); });
byId('rdNext').addEventListener('click', () => { if (readerIndex < bookArticles.length - 1) openReader(readerIndex + 1); });
byId('reader').addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.target.matches('input,select,textarea')) return;
  if (event.key === 'ArrowLeft' && readerIndex > 0) { event.preventDefault(); openReader(readerIndex - 1); }
  if (event.key === 'ArrowRight' && readerIndex < bookArticles.length - 1) { event.preventDefault(); openReader(readerIndex + 1); }
});
for (const chapter of bookArticles) {
  const index = Number(chapter.dataset.idx), item = link('', `#chapter-${index}`);
  item.append(node('span', '', index === 0 ? 'START HERE' : `CHAPTER ${String(index).padStart(2, '0')}`),
    node('strong', '', chapter.querySelector('h1').textContent));
  item.addEventListener('click', event => { event.preventDefault(); openReader(index); });
  byId('chapterPreview').append(item);
  byId('rdToc').append(action(chapter.querySelector('h1').textContent, () => openReader(index)));
}
function decodeText(text){
  return String(text).replace(/&(amp|quot|apos|lt|gt);/g, (_, name) => ({ amp:'&', quot:'"', apos:"'", lt:'<', gt:'>' })[name]);
}
async function loadAuthor(){
  try {
    const data = await readJson('author.json', AbortSignal.timeout(10000));
    if (typeof data.headline !== 'string' || !Array.isArray(data.bio) || !Array.isArray(data.talks)) throw new Error('Author structure is invalid.');
    byId('authorIntroduction').textContent = data.headline;
    const host = byId('authorDetails');
    for (const paragraph of data.bio) host.append(node('p', '', decodeText(paragraph)));
    for (const role of data.roles) host.append(node('p', '', `${decodeText(role.org)} — ${decodeText(role.detail)}`));
    for (const talk of data.talks) {
      const url = new URL(talk.url);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('An author appearance has an unsafe link.');
      const paragraph = node('p');
      paragraph.append(link(`${decodeText(talk.title)} · ${decodeText(talk.venue)} · ${talk.year}`, url.href, true));
      if (talk.blurb) paragraph.append(node('span', 'author-talk-blurb', decodeText(talk.blurb)));
      host.append(paragraph);
    }
    if (data.updated) host.append(node('p', 'dossier-note', `Author information last updated ${data.updated}.`));
  } catch (error) {
    byId('authorDetails').append(node('p', '', `Author details unavailable: ${error.message}`));
  }
}
/* BEGIN RESTORED EXPLORE */
const sixDs = [
  ['Digitised', 'Once intelligence is represented as data, it inherits the exponential. Models, weights and tokens replace handcrafted expertise.'],
  ['Deceptive', 'Early progress looks underwhelming — chatbots that hallucinate — so most people dismiss the curve right before it bends.'],
  ['Disruptive', 'Cheaper, better AI undercuts incumbents: search, coding, translation, tutoring, diagnosis, design — all reorganised.'],
  ['Demonetised', 'The marginal cost of intelligence falls toward zero. What cost a salary now costs an API call.'],
  ['Dematerialised', 'Whole product categories collapse into software — the studio, the office, the call centre, the analyst all fit on a phone.'],
  ['Democratised', 'Finally, the capability is everywhere and cheap. A teenager with a laptop wields what nations once couldn\'t buy.'],
];

const futures = [
  { key:'S1', name:'Disorderly Labour Shock', col:'var(--cp-accent)', prob:'Plausible · near-term', desc:'Capability outruns institutions. Jobs vanish faster than safety nets adapt, and the gains pool at the top before redistribution catches up.',
    moves:['Hold a cash & skills buffer for 12–18 months','Diversify income away from a single automatable role','Back UBI / distribution politics early','Build local, hard-to-offshore relationships'] },
  { key:'S2', name:'Fast Abundance', col:'var(--cp-accent)', prob:'Plausible · 2029–2033', desc:'Energy, compute and robotics compound and the dividend actually reaches people. Costs of the essentials fall through the floor.',
    moves:['Own a slice of productive assets early','Learn to direct AI, not compete with it','Position for a demonetised cost of living','Help build distribution so abundance spreads'] },
  { key:'S3', name:'The Gentle Singularity', col:'var(--cp-accent)', prob:'Central case', desc:'No single dramatic day — capability seeps into everything gradually. Most people barely notice the threshold being crossed.',
    moves:['Treat adaptation as a continuous practice','Re-skill on a rolling 6-month cadence','Automate your own life first to feel the curve','Keep optionality; avoid 10-year bets'] },
  { key:'S4', name:'The Long Horizon', col:'var(--cp-accent)', prob:'Possible · slower', desc:'Bottlenecks — energy build-out, regulation, trust, robotics — stretch timelines into the 2040s. The change is real but unhurried.',
    moves:['Invest in durable, compounding skills','Don\'t over-rotate on hype cycles','Build institutions and community capacity','Stay solvent and patient'] },
  { key:'S5', name:'Existential Risk', col:'var(--cp-accent)', prob:'Low probability · high stakes', desc:'Misaligned or weaponised superintelligence threatens catastrophe. Low odds, but the downside is unbounded — so it earns a hedge.',
    moves:['Support alignment & governance work','Favour resilient, decentralised systems','Avoid single points of catastrophic failure','Treat safety as everyone\'s problem'] },
  { key:'S6', name:'The Sixth Thread: Human Merger', col:'var(--cp-accent)', prob:'Runs through all five', desc:'Across every branch, the line between human and machine blurs — BCIs, cognitive tools, biological enhancement. We don\'t just witness the change; we become it.',
    moves:['Stay curious about enhancement, not fearful','Guard agency and identity deliberately','Keep a human core: relationships, meaning, body','Decide your own augmentation boundaries'] },
];

const allocBuckets = [
  { name:'Cash & skills buffer',    sub:'Hedges S1 · Disorderly Labour Shock', col:'var(--cp-accent)', def:20 },
  { name:'Productive assets',       sub:'Hedges S2 · Fast Abundance',           col:'var(--cp-accent)', def:30 },
  { name:'Adaptive re-skilling',    sub:'Hedges S3 · The Gentle Singularity',   col:'var(--cp-accent)',  def:20 },
  { name:'Community & local ties',  sub:'Hedges S4 · The Long Horizon',         col:'var(--cp-accent)', def:15 },
  { name:'Alignment & safety',      sub:'Hedges S5 · Existential Risk',         col:'var(--cp-accent)', def:5  },
  { name:'Enhancement optionality', sub:'Hedges S6 · The Sixth Thread',         col:'var(--cp-accent)', def:10 },
];

const questions = [
  { q:"How soon do you think AI meaningfully changes your daily work?", dim:'urgency',
    opts:[ ["Already has","a",3],["Within ~2 years","b",3],["3–5 years out","c",2],["Not in my field","d",0] ] },
  { q:"If your income stopped tomorrow, how long could you sustain yourself?", dim:'survival',
    opts:[ ["Under a month","a",0],["1–6 months","b",1],["6–18 months","c",2],["18+ months / passive income","d",3] ] },
  { q:"How are you adapting your skills right now?", dim:'capability',
    opts:[ ["Not really","a",0],["Reading & watching","b",1],["Using AI tools weekly","c",2],["Building & orchestrating AI daily","d",3] ] },
  { q:"Do you own anything that produces value while you sleep?", dim:'assets',
    opts:[ ["No","a",0],["A little savings","b",1],["Some equity / audience / property","c",2],["Diversified productive assets","d",3] ] },
  { q:"How plugged in are you to a community or network?", dim:'community',
    opts:[ ["Mostly on my own","a",0],["A few loose ties","b",1],["An active community or two","c",2],["A network I actively build","d",3] ] },
  { q:"Which future are you actually preparing for?", dim:'portfolio',
    opts:[ ["None in particular","a",0],["Just the bad one","b",1],["Just the good one","c",1],["A portfolio across all five","d",3] ] },
];

const chapters = [
  { idx:'00', route:'Capability', rc:'var(--cp-accent)', title:'How to Use This Book', body:'<p>This is a navigation map, not a manual. Pick a <strong>route</strong> — capability, abundance, or risk — and jump between star systems. It\'s a living document: forecasts update as reality sends new signals.</p>' },
  { idx:'—', route:'Capability', rc:'var(--cp-accent)', title:'Opening — The Future Stopped Arriving Politely', body:'<p>For decades the future RSVP\'d in advance. Now it just shows up. <strong>When intelligence becomes cheap, every plan changes</strong> — so the task is to build toward abundance instead of bracing for panic.</p>' },
  { idx:'01', route:'Abundance', rc:'var(--cp-accent)', title:'From Scarcity to Abundance — My Why', body:'<p>Peter\'s origin: from Harbin on the Black Dragon River to Hobart and Sydney, climbing the migrant ladder as hard-won skills — English, travel agencies, taxis, tax advisory — were devalued one by one by software. A hospital bed became the turn toward transhumanism: <strong>if scarcity made us, abundance can remake us.</strong></p>' },
  { idx:'02', route:'Abundance', rc:'var(--cp-accent)', title:'The Abundance Engine', body:'<p>The <strong>Six Ds</strong> carry every exponential from digitisation to democratisation. The abundance stack — energy, compute, robots, capital, policy, trust — is assembling now: physical AGI and Optimus-class labour, decentralised AI token networks, AGI compressing into 2026–2027, Diamandis\'s "middle of the singularity," Hassabis\'s AGI around 2030. The bottleneck isn\'t intelligence; it\'s <strong>bureaucracy</strong>.</p>' },
  { idx:'03', route:'Abundance', rc:'var(--cp-accent)', title:'The Human Stack', body:'<p>Four layers to secure, bottom-up: <strong>survival, economic, social, and potential.</strong> The goal is adaptive plans, not bunker fantasies — resilience you can actually live inside.</p>' },
  { idx:'04', route:'Capability', rc:'var(--cp-accent)', title:'Energy, Compute, Capacity', body:'<p>Energy is the floor of abundance; compute is your access to intelligence. Pair them with productive infrastructure — homes, farms, workshops, community hubs — so the curve produces <strong>things people can touch</strong>, not just charts.</p>' },
  { idx:'05', route:'Abundance', rc:'var(--cp-accent)', title:'Work After Work', body:'<p>The ladder breaks before the top disappears. Four work identities replace the single career, and — per <em>Alyse\'s View</em> — sometimes the winning move is simply to <strong>keep it simple</strong> and stay human-shaped.</p>' },
  { idx:'06', route:'Risk', rc:'var(--cp-accent)', title:'Five Futures, One Portfolio', body:'<p>Disorderly labour shock, fast abundance, the gentle singularity, the long horizon, and existential risk — plus a sixth thread, the human merger, running through them all. Don\'t predict one; <strong>hold a portfolio</strong> that pays off across branches.</p>' },
  { idx:'07', route:'Capability', rc:'var(--cp-accent)', title:'When — Capability, Deployment, Impact', body:'<p>Separate three clocks: when a capability exists, when it\'s deployed, and when it actually hits your life. My call: <strong>human-level capability by end of 2026</strong>, disruptive across every industry through 2027 — so <strong>hope for the best, prepare for the worst.</strong></p>' },
  { idx:'08', route:'Abundance', rc:'var(--cp-accent)', title:'Your 1000-Day Moonshot Plan', body:'<p>Four phases: <strong>0–30 days</strong> create your first plan, <strong>30–180</strong> build capability, <strong>180–365</strong> own or access productive assets, <strong>365–1000</strong> become a node in the better future.</p>' },
  { idx:'09', route:'Abundance', rc:'var(--cp-accent)', title:'The Distribution Layer', body:'<p>UBI is the floor, <strong>Universal High Income</strong> is the aspiration, and <strong>Universal Compute</strong> is the leverage — making sure the dividend of abundance reaches people, not just balance sheets.</p>' },
  { idx:'10', route:'Risk', rc:'var(--cp-accent)', title:'Human Enhancement', body:'<p>Longevity escape velocity, BCIs and cognitive tools move enhancement from fringe to mainstream. The question stops being <em>whether</em> and becomes <strong>how you keep agency and meaning</strong> while you change.</p>' },
  { idx:'11', route:'Abundance', rc:'var(--cp-accent)', title:'Build the Better Branch', body:'<p>The future isn\'t something that happens to you — it\'s a branch you help select. <strong>Become a node</strong>: build, connect, distribute, and steer toward the abundant timeline on purpose.</p>' },
];

const simulatorPresets = {
  baseline:{ capability:0, coordination:0, deployment:0 },
  fast:{ capability:18, coordination:-8, deployment:-4 },
  managed:{ capability:4, coordination:18, deployment:0 },
  bottleneck:{ capability:8, coordination:4, deployment:18 },
};

const simulatorOutcomeLabels = {
  agi:{ title:'Human-level AGI', meta:'End of 2026' },
  managed:{ title:'Managed pause', meta:'Frontier training · 2029' },
  default:{ title:'Default path', meta:'Top-expert / ASI · 2030' },
  ungoverned:{ title:'Ungoverned takeoff', meta:'2028–2030 window' },
  handoff:{ title:'Managed handoff', meta:'Controlled scaling · 2040' },
};

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function monthPhase(m){ return m <= 4 ? 'Early' : m <= 8 ? 'Mid' : 'Late'; }

function estimatedTiming(e, year){
  const m = Number(e.m);
  if (!Number.isFinite(m) || m < 1 || m > 12) return null;
  const band = Number(e.mBand);
  const precision = e.mPrecision;
  let label;
  if (precision === 'month') label = `${MONTH_NAMES[m - 1]} ${year}`;
  else if (precision === 'quarter') label = `Q${Math.floor((m - 1) / 3) + 1} ${year}`;
  else if (precision === 'half') label = `${m <= 6 ? 'H1' : 'H2'} ${year}`;
  else label = `${monthPhase(m)} ${year}`;
  const bandText = Number.isFinite(band) ? `±${band} month${band === 1 ? '' : 's'}` : '';
  /* An estimate whose window has already closed is not silently left looking pending.
     Whether it actually resolved is an evidence question, not a timing one, so this states
     only that the window has passed and lets the evidence cards speak to the outcome. */
  const now = new Date();
  const windowEnd = new Date(Date.UTC(year, (m - 1) + (Number.isFinite(band) ? band : 0) + 1, 0));
  const elapsed = windowEnd < now;
  return { label, bandText, precision, elapsed, basis: e.mBasis || '' };
}
const HTML_ENTITIES = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", '#39':"'", nbsp:' ' };

const clampNumber = (value, min, max) => Math.max(min, Math.min(max, value));

function setText(id, value){
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function utcInstant(value){
  const date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function formatUtcDate(value){
  const date = utcInstant(value);
  return date ? date.toLocaleDateString('en-US', { timeZone:'UTC', day:'numeric', month:'short', year:'numeric' }) : '';
}

function formatUtcDateTime(value){
  const date = utcInstant(value);
  /* The zone is named because a bare time of day is ambiguous to every reader outside UTC. */
  return date ? date.toLocaleString('en-US', { timeZone:'UTC', day:'numeric', month:'short', year:'numeric', hour:'numeric', minute:'2-digit' }) + ' UTC' : '';
}

function decodeKnownEntities(value){
  return String(value == null ? '' : value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const codepoint = parseInt(hex, 16);
      return Number.isInteger(codepoint) && codepoint >= 0 && codepoint <= 0x10ffff
        ? String.fromCodePoint(codepoint)
        : '\ufffd';
    })
    .replace(/&#(\d+);/g, (_, decimal) => {
      const codepoint = parseInt(decimal, 10);
      return Number.isInteger(codepoint) && codepoint >= 0 && codepoint <= 0x10ffff
        ? String.fromCodePoint(codepoint)
        : '\ufffd';
    })
    .replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/gi, entity => HTML_ENTITIES[entity.slice(1, -1).toLowerCase()]);
}

function htmlText(value){
  return decodeKnownEntities(value).replace(/[&<>"']/g, character => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[character]);
}

function safeHttpUrl(value){
  try {
    const url = new URL(String(value));
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

function qualityLabel(value){
  return {
    'peer-reviewed-journal': 'Peer-reviewed journal',
    'primary-news-organization': 'Primary news organisation',
    'established-technology-press': 'Established technology press',
    'named-expert-analysis': 'Named expert analysis',
    'official-ai-lab': 'Frontier lab, first-party',
    'official-research-organization': 'Research organisation, first-party',
    'official-company': 'Company, first-party',
    'industry-primary-source': 'Industry primary source',
    'intergovernmental-organization': 'Intergovernmental body, first-party',
    'government': 'Government source',
    'original-researcher': 'Original researcher',
  }[value] || String(value || 'Source quality not recorded');
}

function forecastRecords(){ return model ? model.records : []; }
let publishedSignals = null;
let forecastFingerprint = '';
let exploreSession = null;
let exploreMountFailed = false;
let observationError = '';
let observationLastChecked = '';
let observationLatency = null;
function pendingObservationRecord(){ return pending?.candidate.bundle || null; }
Object.defineProperty(window, 'pendingSignals', { get:pendingObservationRecord, configurable:true });

const MISSION_KEY = 'pap-mission-control:v1';
const questIds = ['scenario-v1', 'chapter-v1', 'evidence-v1', 'action-v1'];
const readinessIds = ['uncertainty-v1', 'limits-v1', 'conversation-v1'];
const actionIds = ['first-plan-v1', 'capability-v1', 'community-v1', 'review-v1'];
const emptyMission = () => ({ version:1, quests:[], readiness:[], action:'', actionConfirmed:false, watchlist:{} });
let missionStorageMode = 'local';
let missionStorageMessage = 'Saved on this browser only.';
const comparedForecasts = new Set();
let missionState = null;
function validPredictionId(id){ return /^(?:20\d{2}-\d+|horizon-[a-z0-9-]+)$/.test(id); }

function loadMission(){
  try {
    const raw = localStorage.getItem(MISSION_KEY);
    if (!raw) {
      localStorage.setItem(MISSION_KEY, JSON.stringify(emptyMission()));
      return emptyMission();
    }
    const data = JSON.parse(raw);
    if (data?.version !== 1 || !Array.isArray(data.quests) || !Array.isArray(data.readiness)
      || !data.quests.every(id => questIds.includes(id)) || !data.readiness.every(id => readinessIds.includes(id))
      || new Set(data.quests).size !== data.quests.length || new Set(data.readiness).size !== data.readiness.length
      || !['', ...actionIds].includes(data.action) || typeof data.actionConfirmed !== 'boolean'
      || (data.actionConfirmed && !data.action)
      || !data.watchlist || Array.isArray(data.watchlist) || typeof data.watchlist !== 'object'
      || Object.keys(data.watchlist).length > 1000
      || !Object.entries(data.watchlist).every(([id, row]) => validPredictionId(id) && row
        && ['title', 'forecast', 'seen'].every(key => typeof row[key] === 'string' && row[key].length < 100000))) {
      throw new Error('Unsupported or invalid planning data');
    }
    for (const row of Object.values(data.watchlist)) {
      if (row.seen) {
        const snapshot = JSON.parse(row.seen);
        if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('Invalid observation snapshot');
      }
    }
    localStorage.setItem(MISSION_KEY, raw);
    return data;
  } catch (error) {
    missionStorageMode = 'session';
    missionStorageMessage = 'Session only: storage is unavailable or saved data is unreadable. Nothing has been overwritten. Reset to try local saving again.';
    return emptyMission();
  }
}

function saveMission(){
  if (missionStorageMode !== 'local') return;
  try { localStorage.setItem(MISSION_KEY, JSON.stringify(missionState)); }
  catch (error) {
    missionStorageMode = 'session';
    missionStorageMessage = 'Session only: the browser could not save this change. Earlier saved data may remain; reset to retry.';
  }
}

function completeQuest(id){
  if (!missionState.quests.includes(id)) {
    missionState.quests.push(id);
    saveMission();
    setText('missionAnnouncement', 'Planning quest recorded. This measures completion only.');
  }
  renderMission();
}

function watchButton(id){
  const saved = Boolean(missionState.watchlist[id]);
  return `<button type="button" class="watch-button" data-watch="${htmlText(id)}" aria-pressed="${saved}"
    aria-label="${saved ? 'Remove forecast from watchlist' : 'Save forecast to watchlist'}">${saved ? 'Saved' : '+ Watch'}</button>`;
}

function evidenceSnapshot(id, data = publishedSignals){
  if (!data) return '';
  return JSON.stringify({
    citation:data.embeds[id] || null, context:data.context.items[id] || null,
    // Re-running a search is a freshness change, not a new observation.
    gap:data.uncited.items[id]?.reason || null, currency:data.currency?.[id] || [],
    assessment:data.observations?.items?.[id] || null,
    references:data.referencePoints?.items[id] || null,
    ...(data.capabilities?.metr?.context?.id === id && data.capabilities.metr.context.forecastSha256 === forecastFingerprint
      && data.capabilities.metr.current ? { capability:[data.capabilities.metr.current.records,
        data.capabilities.metr.current.longTasksVersion, data.capabilities.metr.current.swaaVersion] } : {}),
  });
}

function watchStatus(row, saved){
  if (!row) return 'No longer in the current forecast. Kept here so you can remove it.';
  if (saved.forecast !== JSON.stringify(row.data)) return 'Forecast content changed. Review before acknowledging a new baseline.';
  if (!publishedSignals) return 'Evidence unavailable; saved snapshot retained.';
  const current = evidenceSnapshot(row.id);
  if (saved.seen === current) return 'No observation change since your saved snapshot.';
  const before = saved.seen ? JSON.parse(saved.seen) : {};
  const after = JSON.parse(current);
  const fields = { citation:'citation details', context:'dated background', gap:'search outcome', currency:'current references', assessment:'reviewed assessment', capability:'METR measurements', references:'reviewed reference points' };
  const changed = Object.keys(fields).filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key])).map(key => fields[key]);
  return `Observation record changed since your saved snapshot: ${changed.join(', ')}. Inspect the source, dates and limitations before acknowledging.`;
}

function renderWatchlist(){
  const host = document.getElementById('watchlist');
  const focus = host.contains(document.activeElement)
    ? { id:document.activeElement.dataset.watch || document.activeElement.dataset.ack, ack:Boolean(document.activeElement.dataset.ack) } : null;
  const rows = new Map(forecastRecords().map(row => [row.id, row]));
  host.innerHTML = Object.entries(missionState.watchlist).map(([id, saved]) => {
    const row = rows.get(id);
    return `<li class="watch-item"><div>${row ? `<a href="${row.href}">${htmlText(row.title)}</a>` : `<strong>${htmlText(saved.title)}</strong>`}
      <p data-watch-status="${htmlText(id)}">${htmlText(watchStatus(row, saved))}</p>
      <span class="assessment-label">${htmlText(row ? referenceLabel(id) + ' · ' + trajectoryFor(id).label : 'Forecast unavailable')}</span></div>
      <div class="watch-actions">${row ? `<button type="button" class="text-button" data-inspect="${htmlText(id)}">Inspect</button>` : ''}
      ${row && publishedSignals ? `<button type="button" class="text-button" data-ack="${htmlText(id)}">Acknowledge snapshot</button>` : ''}
      <button type="button" class="text-button" data-watch="${htmlText(id)}">Remove</button></div></li>`;
  }).join('') || '<li class="mission-empty">Nothing saved yet. Inspect a forecast below to start your watchlist.</li>';
  if (focus) {
    const target = host.querySelector(`[data-${focus.ack ? 'ack' : 'watch'}="${focus.id}"]`);
    (target || document.getElementById('observationPrediction')).focus({ preventScroll:true });
  }
  setText('watchCount', `${Object.keys(missionState.watchlist).length} saved`);
}

function renderMissionControls(){
  setText('missionStorage', missionStorageMessage);
  document.getElementById('missionStorage').dataset.mode = missionStorageMode;
  const count = questIds.filter(id => missionState.quests.includes(id)).length;
  setText('questCount', `${count} / 4`);
  document.getElementById('questProgress').value = count;
  setText('questReward', count === 4
    ? 'Field notes established. You completed four planning activities, not a prediction of your readiness.'
    : 'Four ways to explore. Completion is not a readiness score.');
  document.querySelectorAll('[data-quest]').forEach(node => {
    const done = missionState.quests.includes(node.dataset.quest);
    node.classList.toggle('is-complete', done);
    node.querySelector('.quest-state').textContent = done ? 'Recorded' : 'To explore';
  });
  document.querySelectorAll('[data-readiness]').forEach(input => { input.checked = missionState.readiness.includes(input.dataset.readiness); });
  document.getElementById('preparationAction').value = missionState.action;
  document.getElementById('confirmPreparation').checked = missionState.actionConfirmed;
  document.getElementById('confirmPreparation').disabled = !missionState.action;
  document.getElementById('confirmComparison').disabled = comparedForecasts.size < 2;
  setText('readinessCount', `${missionState.readiness.length + Number(missionState.actionConfirmed)} of 4 planning items recorded.`);
  document.querySelectorAll('.watch-button').forEach(button => {
    const saved = Boolean(missionState.watchlist[button.dataset.watch]);
    button.textContent = saved ? 'Saved' : '+ Watch';
    button.setAttribute('aria-pressed', String(saved));
    button.setAttribute('aria-label', saved ? 'Remove forecast from watchlist' : 'Save forecast to watchlist');
  });
  renderWatchlist();
  renderObservationDetail();
  renderObservationHealth();
  renderMetr();
}
function validTime(value){
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now() + 300000;
}

function recordedTime(value){
  if (!value) return 'Not recorded';
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${formatUtcDate(value)} (date only)` : formatUtcDateTime(value) || 'Not recorded';
}

function bundleFreshness(data){
  if (!data || !validTime(data.updated) || !validTime(data.sourceFetchedAt)) return 'Source freshness unavailable';
  if (['degraded', 'unavailable'].includes(data.sourceStatus?.mode)) return 'Source outage reported';
  const age = Date.now() - Math.min(Date.parse(data.updated), Date.parse(data.sourceFetchedAt));
  return age > 36 * 3600000 ? 'Stale published bundle (over 36 hours)' : 'Published bundle within 36 hours';
}

function trajectoryFor(id, data = publishedSignals){
  const unknown = { label:'Trajectory not yet assessed', detail:'Insufficient measured data: no reviewed criterion and measurement are published for this exact forecast.', records:[] };
  const layer = data?.observations;
  if (!layer) return unknown;
  if (layer.schemaVersion !== 1 || layer.forecastSha256 !== forecastFingerprint) {
    return { ...unknown, detail:'Assessment version does not match this forecast. No direction is inferred.' };
  }
  const records = layer.items?.[id];
  if (!Array.isArray(records) || !records.length) return unknown;
  const valid = records.every(record => record && record.reviewed === true
    && typeof record.reviewedBy === 'string' && record.reviewedBy.trim() && validTime(record.reviewedAt)
    && ['supporting', 'mixed', 'challenging'].includes(record.direction)
    && typeof record.criterion?.id === 'string' && record.criterion.id
    && typeof record.criterion.version === 'string' && record.criterion.version
    && typeof record.criterion.description === 'string' && record.criterion.description
    && Number.isFinite(record.measurement?.value) && typeof record.measurement.unit === 'string' && record.measurement.unit
    && validTime(record.measurement.observedAt) && safeHttpUrl(record.source?.url)
    && !/(?:^|\.)((?:x|twitter)\.com)$/i.test(new URL(record.source.url).hostname)
    && validTime(record.source.publishedAt) && validTime(record.source.fetchedAt)
    && typeof record.source.name === 'string' && record.source.name
    && typeof record.rationale === 'string' && record.rationale
    && typeof record.limitations === 'string' && record.limitations);
  if (!valid) return { ...unknown, detail:'A published assessment is incomplete. Treat trajectory as unassessed; the source record is not enough.' };
  const directions = new Set(records.map(record => record.direction));
  const direction = directions.size > 1 || directions.has('mixed') ? 'mixed' : records[0].direction;
  return { label:{ supporting:'Supporting observations', mixed:'Mixed observations', challenging:'Challenging observations' }[direction],
    detail:'Reviewed direction against the stated criteria, not proof that the target is achieved or a new probability.', records };
}

function referenceLabel(id){
  const rows = publishedSignals?.referencePoints?.items[id];
  return rows?.length ? `Reference: ${rows[0].relation} / ${rows[0].direction.replaceAll('-', ' ')}` : 'Inspect real-world references';
}

function renderMetr(){
  const m = publishedSignals?.capabilities?.metr, s = m?.current;
  const select = document.getElementById('metrModel');
  const value = select.value;
  const options = s?.records.map(r => `<option value="${htmlText(r.id)}">${htmlText(r.id)}</option>`).join('') || '<option>No measurements loaded</option>';
  if (select.innerHTML !== options) { select.innerHTML = options; if (s?.records.some(r => r.id === value)) select.value = value; }
  select.disabled = !s;
  const r = s?.records.find(r => r.id === select.value);
  setText('metrStatus', !m || m.status !== 'ok' ? `${m?.error || 'Source unavailable.'} ${s ? 'Last-good measurements retained.' : 'No measurements available.'}`
    : Date.now() - Date.parse(m.lastCheckedAt) > 36 * 3600000 ? 'Stale source check (over 36 hours).' : 'Source checked; this does not mean a new evaluation.');
  for (const key of ['p50', 'p80']) {
    const v = r?.[key];
    setText(key === 'p50' ? 'metrP50' : 'metrP80', v ? `${v.estimate.toFixed(2)} min (95% CI ${v.ci_low.toFixed(2)}–${v.ci_high.toFixed(2)})` : 'Not recorded');
  }
  for (const [id, date] of Object.entries({ metrRelease:r?.releaseDate, metrChecked:m?.lastCheckedAt,
    metrFetched:m?.lastSuccessfulFetchAt, metrModified:s?.lastModified })) setText(id, recordedTime(date));
  setText('metrRevision', s ? `${s.benchmark}; SHA-256 ${s.sha256}` : 'Not recorded');
  setText('metrSetup', r?.scaffolds.join('; ') || 'Not recorded');
  setText('metrChange', m?.changeSummary || 'No site collection history yet.');
  setText('metrContext', m?.context?.id === document.getElementById('observationPrediction').value
    && m.context.forecastSha256 === forecastFingerprint ? m.context.role : '');
}

function ensureMission(){
  if (!missionState) missionState = loadMission();
  return missionState;
}
function renderMission(){
  if (!missionState) return;
  if (exploreSession) renderMissionControls();
  document.querySelectorAll('[data-watch]').forEach(button => {
    const saved = Boolean(missionState.watchlist[button.dataset.watch]);
    button.textContent = saved ? 'Saved to watchlist' : 'Save to watchlist';
    button.setAttribute('aria-pressed', String(saved));
  });
}
function watchControl(id){
  const control = action(missionState?.watchlist[id] ? 'Saved to watchlist' : 'Save to watchlist', () => {});
  control.dataset.watch = id;
  control.classList.add('watch-button');
  control.setAttribute('aria-pressed', String(Boolean(missionState?.watchlist[id])));
  return control;
}
function renderObservationHealth(){
  const coverage = publishedSignals?.referencePoints?.coverage;
  setText('referenceCoverage', coverage
    ? `${coverage.mapped}/${coverage.total} forecasts have reviewed reference mappings to ${coverage.sources} sources. This is coverage, not forecast success.`
    : 'Reviewed reference data is unavailable.');
  setText('observationFreshness', observationError
    ? `Update unavailable. ${publishedSignals ? 'Last good record retained.' : 'No coherent source record loaded.'}`
    : bundleFreshness(publishedSignals));
  setText('observationCheck', observationError || (observationLastChecked
    ? `Browser checked ${formatUtcDateTime(observationLastChecked)}; ${observationLatency} ms round trip.`
    : 'No browser source check completed.'));
  setText('observationTimes', publishedSignals
    ? `Snapshot ${recordedTime(publishedSignals.updated)}. Collection ${recordedTime(publishedSignals.sourceFetchedAt)}. Browser checks do not reverify upstream sources.`
    : 'Publication and collection dates appear only after a coherent record loads.');
  byId('applyObservations').hidden = !pending;
}
function assertPublishedRecord(data, predictions, hash, previous){
  const timelineData = predictions.years;
  const horizonData = predictions.postSuperintelligence;
  const forecastFingerprint = hash;
  const publishedSignals = previous;
  const forecastRecords = () => recordsFor(predictions);
  function expectedSignalIds(){
  return [
    ...timelineData.flatMap(year => year.events.map((_, index) => `${year.year}-${index}`)),
    ...horizonData.items.map(item => `horizon-${item.id}`),
  ];
}

function hasCompleteSignalCoverage(data){
  /* REWRITTEN 2026-08-13 for the news migration. The previous gate demanded an embed for EVERY one of
     the 103 ids. With 7 cited and 96 honestly recorded as uncited it returned false, which set
     signalCoverageReady = false and hid ALL direct evidence - the site would have shown nothing
     because the evidence became honest. It also asserted three floor fields the artefact no longer
     emits, so the chain was permanently false for a second, independent reason.

     The contract is now ACCOUNTED-FOR, which is stronger than the totality it replaces: every
     prediction must be cited or explicitly recorded as uncited, never both and never neither. A
     silent gap is still a hard failure. Nothing was loosened to make this pass - the X floors are
     asserted ABSENT rather than dropped, so reinstating one fails here. */
  if (!data || data.sourceFresh !== true || !data.embeds || typeof data.embeds !== 'object') return false;
  const expected = expectedSignalIds();
  const directIds = Object.keys(data.embeds);
  const searchIds = data.search && typeof data.search === 'object' ? Object.keys(data.search) : [];
  if (searchIds.length) return false;
  const uncited = data.uncited && typeof data.uncited === 'object' ? data.uncited : null;
  const uncitedItems = uncited && uncited.items && typeof uncited.items === 'object' ? uncited.items : {};
  const uncitedIds = Object.keys(uncitedItems);
  /* THE THIRD CHANNEL (2026-08-17): the partition is cited | context | uncited, with no gap and no
     overlap. Context may be empty, but a present entry must be well-formed — one that cannot state
     its own age would render as though it were current evidence. Rationale: verify-direct-coverage.js. */
  const context = data.context && typeof data.context === 'object' ? data.context : null;
  const contextItems = context && context.items && typeof context.items === 'object' ? context.items : {};
  const contextIds = Object.keys(contextItems);
  const expectedSet = new Set(expected);
  if (directIds.some(id => !expectedSet.has(id)) || uncitedIds.some(id => !expectedSet.has(id))) return false;
  if (contextIds.some(id => !expectedSet.has(id))) return false;
  if (directIds.some(id => uncitedItems[id])) return false;
  if (contextIds.some(id => uncitedItems[id] || data.embeds[id])) return false;
  if (expected.some(id => !data.embeds[id] && !uncitedItems[id] && !contextItems[id])) return false;
  if (directIds.length + contextIds.length + uncitedIds.length !== expected.length) return false;
  const contextValid = contextIds.every(id => {
    const r = contextItems[id];
    return r && typeof r.url === 'string' && /^https:\/\//i.test(r.url)
      && r.publisher && r.headline && r.quote && r.publishedAtSource && r.ageBucket
      && !isNaN(new Date(r.publishedAt).getTime()) && Number.isFinite(Number(r.ageDays));
  });
  if (!contextValid) return false;
  const windowDays = Number(uncited && uncited.windowDays);
  if (!Number.isInteger(windowDays) || windowDays <= 0) return false;
  if (Number(uncited && uncited.count) !== uncitedIds.length) return false;
  const uncitedValid = uncitedIds.every(id => {
    const record = uncitedItems[id];
    return record && record.id === id
      && typeof record.reason === 'string' && record.reason.trim()
      && typeof record.statement === 'string' && record.statement.trim()
      && Number(record.windowDays) === windowDays
      && !isNaN(new Date(record.searchedAt).getTime());
  });
  if (!uncitedValid) return false;
  /* Group on the SOURCE (the resolved article url the builder publishes as sourceKey), not on the
     ledger row's name. Two reviewed rows quoting one article are one source used twice; keying on
     the row name would let a reused source pass as two unique ones. */
  const usesByPost = directIds.reduce((uses, id) => {
    const embed = data.embeds[id] || {};
    const postId = String(embed.sourceKey || embed.id || '');
    if (!uses[postId]) uses[postId] = [];
    uses[postId].push(data.embeds[id]);
    return uses;
  }, {});
  const reuseValid = Object.values(usesByPost).every(uses => uses.length === 1
    ? uses[0].assignmentMode === 'unique' && Number(uses[0].reuseCount) === 1
    : uses.every(signal => signal.assignmentMode === 'news-reuse'
      && Number(signal.reuseCount) === uses.length
      && signal.reuseFamily === uses[0].reuseFamily));
  if (!reuseValid) return false;
  /* Every direct record must be live-verified news, with the full provenance the news verifier
     re-checks at publish: a fetched publisher, a publication date, a retrieval instant, a quality
     class, and a SHA-256 of the extracted article text bound to a verbatim quote. */
  const directValid = directIds.every(id => {
    const signal = data.embeds[id];
    const provenance = signal && signal.provenance || {};
    return !!signal
      && signal.evidenceOwner === 'news'
      && signal.kind === 'news'
      && signal.activityKind === 'news'
      && /^news:[a-z0-9][a-z0-9-]*$/.test(String(signal.id || ''))
      && /^https:\/\/[^\s/]+\.[^\s/]+\/\S*$/.test(String(signal.url || ''))
      && signal.reviewed === true
      && !!signal.evidenceFamily
      && !!signal.mappingRationale
      && !!signal.headline
      && !!signal.quote
      && !!signal.publisher
      && signal.matchMethod === 'reviewed-news'
      && ['direct', 'scenario', 'leading-indicator'].includes(signal.evidenceType)
      && ['unique', 'news-reuse'].includes(signal.assignmentMode)
      && !!signal.reuseFamily
      && provenance.evidenceOwner === 'news'
      && provenance.activityKind === 'news'
      && !!provenance.publisher
      && !!provenance.publisherHost
      && !!provenance.publishedAt
      && !!provenance.publishedAtSource
      && !!provenance.retrievedAt
      && !!provenance.sourceQuality
      && !!provenance.textSha256
      && ['live-fetch+quote-match', 'browser-render+quote-match'].includes(provenance.verifiedThrough)
      && Array.isArray(provenance.sourceChain)
      && provenance.sourceChain.includes('quote-match');
  });
  if (!directValid) return false;
  const owners = data.coverage && data.coverage.byEvidenceOwner || {};
  const media = data.coverage && data.coverage.byEvidenceMedium || {};
  /* Asserted POSITIVELY, on GC seq-91's finding: a retired floor compared with < is satisfied by
     absence, so absence is what gets checked. X-owned or X-medium coverage reappearing fails here. */
  const xRetired = owners.peterxing === undefined && owners.external === undefined
    && Number(media.x || 0) === 0
    && data.coverage.stickyPeterFloor === undefined
    && data.coverage.stickyPeterAuthoredFloor === undefined;
  return xRetired
    && data.coverage
    && data.coverage.complete === true
    && data.coverage.cited === directIds.length
    && data.coverage.searches === 0
    && data.coverage.total === expected.length
    // ...and the SURVIVORS: a drop must not render as the authored population (see verify-perpred.js).
    && data.coverage.kept === expected.length && data.coverage.dropped === 0
    && Number(media.news || owners.news || 0) === directIds.length
    && data.source === 'news-verified'
    && data.sourceStatus
    && data.sourceStatus.activeSource === data.source
    && data.sourceStatus.mode === 'news-verified'
    && data.sourceStatus.primarySource === 'live-verified-news';
}

function validatePublishedBundle(data){
  const refs = data?.referencePoints, priorRefs = publishedSignals?.referencePoints;
  const records = forecastRecords(), ids = new Set(records.map(row => row.id));
  if (priorRefs && (!refs || Date.parse(refs.updatedAt) < Date.parse(priorRefs.updatedAt)))
    throw new Error('Older or missing reference roster returned. Last good bundle retained.');
  if (refs && (refs.schemaVersion !== 1 || refs.forecastSha256 !== forecastFingerprint || !validTime(refs.updatedAt)
    || !refs.sources || !refs.items || !refs.gaps || refs.coverage?.total !== records.length
    || refs.coverage.mapped !== Object.keys(refs.items).length
    || refs.coverage.gaps !== Object.keys(refs.gaps).length
    || refs.coverage.mapped + refs.coverage.gaps !== refs.coverage.total
    || refs.coverage.sources !== new Set(Object.values(refs.items).flat().map(r => r.sourceId)).size
    || refs.coverage.references !== Object.values(refs.items).flat().length
    || [...Object.keys(refs.items), ...Object.keys(refs.gaps)].some(id => !ids.has(id))
    || !records.every(row => {
      const entries = refs.items[row.id];
      return entries?.length ? !refs.gaps[row.id] && entries.every(r => {
        const s = refs.sources[r.sourceId], m = r.metric;
        return r.id === row.id && r.predictionText === row.title && s && /^https:\/\//.test(safeHttpUrl(s.url))
          && !/(?:^|\.)(?:x|twitter)\.com$/i.test(new URL(s.url).hostname)
          && ['measured','deployment','policy','trial','precursor','feasibility','constraint','counterevidence','theory'].includes(r.relation)
          && ['supports-prerequisite','context','challenges'].includes(r.direction)
          && [r.facet,r.why,r.doesNotEstablish,r.excerpt,s.title,s.organization].every(v => typeof v === 'string' && v.trim())
          && (m === null || (Number.isFinite(m?.value) && [undefined,'>','<','~'].includes(m.operator)
            && (m.high === undefined || Number.isFinite(m.high) && m.high >= m.value && !m.operator)
            && typeof m.unit === 'string' && typeof m.coverage === 'string' && typeof m.evidence === 'string'))
          && validTime(r.reviewedAt) && validTime(s.retrievedAt) && (s.publishedAt === null || validTime(s.publishedAt))
          && (!s.publishedPeriod || /^\d{4}-(0[1-9]|1[0-2])$/.test(s.publishedPeriod))
          && ['verified','unavailable','changed','unverified'].includes(s.health?.status)
          && /^[a-f0-9]{64}$/.test(s.reviewSha256) && s.health.reviewSha256 === s.reviewSha256
          && validTime(s.health.lastCheckedAt) && validTime(s.health.lastVerifiedAt)
          && Date.parse(s.health.lastCheckedAt) >= Date.parse(s.health.lastVerifiedAt);
      }) : typeof refs.gaps[row.id] === 'string';
    }))) throw new Error('Reference schema or forecast binding mismatch. Last good bundle retained; revision review is pending.');
  const m = data?.capabilities?.metr, s = m?.current;
  const prior = publishedSignals?.capabilities?.metr;
  if (prior?.current && (!s || Date.parse(m?.lastCheckedAt) < Date.parse(prior.lastCheckedAt)))
    throw new Error('Older or missing METR data returned. Last good bundle retained.');
  if (m && (m.schemaVersion !== 1 || !['ok', 'error', 'unavailable'].includes(m.status)
    || (m.lastCheckedAt !== null && !validTime(m.lastCheckedAt)) || (m.status === 'ok' && !s)
    || (s && (s.benchmark !== 'METR-Horizon-v1.1' || s.unit !== 'human-expert minutes'
    || !validTime(s.retrievedAt) || !validTime(m.lastCheckedAt) || m.lastSuccessfulFetchAt !== s.retrievedAt
    || Date.parse(m.lastCheckedAt) < Date.parse(s.retrievedAt) || !/^[a-f0-9]{64}$/.test(s.sha256)
    || s.measuredAt !== null || s.publishedAt !== null
    || s.intervalLevel !== 0.95 || !Array.isArray(s.records) || !s.records.length || s.records.length > 200
    || !s.records.every(r => r && typeof r.id === 'string' && validTime(r.releaseDate) && Array.isArray(r.scaffolds)
      && r.p80?.estimate <= r.p50?.estimate
      && ['p50', 'p80'].every(k => [r[k]?.estimate, r[k]?.ci_low, r[k]?.ci_high].every(v => Number.isFinite(v) && v > 0)
        && r[k].ci_low <= r[k].estimate && r[k].estimate <= r[k].ci_high))))))
    throw new Error('METR measurement schema is invalid. Last good bundle retained.');
  if (!forecastFingerprint || data?.forecastVersion?.schemaVersion !== 1 || data.forecastVersion.sha256 !== forecastFingerprint) {
    throw new Error('Forecast and observation versions do not match. Reload after publication completes; existing data is retained.');
  }
  if (!validTime(data.updated) || !validTime(data.sourceFetchedAt) || !hasCompleteSignalCoverage(data)
    || !Array.isArray(data.reality) || !data.reality.length || data.reality.length > 100
    || !data.reality.every(row => row && typeof row.t === 'string' && ['news', 'none'].includes(row.kind)
      && (row.kind !== 'news' || /^https:\/\//.test(safeHttpUrl(row.url))))
    || data.context.count !== Object.keys(data.context.items).length) {
    throw new Error('Published evidence failed timestamp, provenance or coverage validation. No replacement was applied.');
  }
  if (publishedSignals && Date.parse(data.updated) < Date.parse(publishedSignals.updated)) {
    throw new Error('The server returned an older bundle. The newer local snapshot is retained.');
  }
}
  validatePublishedBundle(data);
  for (const source of Object.values(data.referencePoints?.sources || {})) {
    for (const url of [source.dateEvidenceUrl, source.revisionIndex?.url].filter(Boolean)) engine.safeSourceUrl(url);
  }
  for (const entries of Object.values(data.currency || {})) {
    if (!Array.isArray(entries)) throw new Error('The later-reference layer has an invalid record shape.');
    for (const entry of entries) engine.safeSourceUrl(entry.url);
  }
}
function updateExploreSnapshot(){
  publishedSignals = model?.bundle || null;
  forecastFingerprint = model?.fingerprint || '';
  observationError = '';
  if (exploreSession) exploreSession.update();
}
function bindMissionControls(){
  byId('observationPrediction').addEventListener('change', () => { renderObservationDetail(); renderMetr(); });
  byId('metrModel').addEventListener('change', renderMetr);
  byId('observationDetail').addEventListener('toggle', event => {
    if (event.target.matches('.source-inspection') && event.target.open) recordComparison(byId('observationPrediction').value);
  }, true);
  byId('confirmComparison').addEventListener('click', () => {
    if (comparedForecasts.size >= 2) completeQuest('evidence-v1');
  });
  document.querySelectorAll('[data-readiness]').forEach(input => input.addEventListener('change', () => {
    missionState.readiness = readinessIds.filter(id => document.querySelector(`[data-readiness="${id}"]`).checked);
    saveMission(); renderMission();
  }));
  byId('preparationAction').addEventListener('change', event => {
    missionState.action = event.target.value;
    missionState.actionConfirmed = false;
    missionState.quests = missionState.quests.filter(id => id !== 'action-v1');
    saveMission(); renderMission();
  });
  byId('confirmPreparation').addEventListener('change', event => {
    missionState.actionConfirmed = Boolean(missionState.action && event.target.checked);
    missionState.quests = missionState.quests.filter(id => id !== 'action-v1');
    if (missionState.actionConfirmed) missionState.quests.push('action-v1');
    saveMission(); renderMission();
  });
  const reset = byId('missionResetDialog');
  byId('missionReset').addEventListener('click', () => reset.showModal());
  byId('cancelMissionReset').addEventListener('click', () => reset.close());
  byId('confirmMissionReset').addEventListener('click', () => {
    missionState = emptyMission(); comparedForecasts.clear();
    missionStorageMode = 'local'; missionStorageMessage = 'Saved on this browser only.';
    saveMission(); renderMission(); reset.close(); byId('missionReset').focus();
    setText('missionAnnouncement', missionStorageMode === 'local' ? 'Planning data cleared.' : 'Session data cleared; browser storage could not be changed.');
  });
  byId('refreshObservations').addEventListener('click', loadRecord);
  byId('applyObservations').addEventListener('click', () => {
    if (pending) applyRecord(pending.candidate, pending.predictions);
  });
}
function recordComparison(id){
  if (!model?.records.some(row => row.id === id)) return;
  comparedForecasts.add(id);
  byId('confirmComparison').disabled = comparedForecasts.size < 2;
}
document.addEventListener('click', event => {
  const watch = event.target.closest('[data-watch]');
  const acknowledge = event.target.closest('[data-ack]');
  const inspect = event.target.closest('[data-inspect]');
  const read = event.target.closest('[data-read-chapter]');
  if (watch) {
    ensureMission();
    const id = watch.dataset.watch, row = forecastRecords().find(row => row.id === id);
    if (missionState.watchlist[id]) delete missionState.watchlist[id];
    else if (row) missionState.watchlist[id] = { title:row.title, forecast:JSON.stringify(row.data), seen:evidenceSnapshot(id) };
    else { setText('timelineAnnouncement', 'This forecast is unavailable; no saved record was changed.'); return; }
    saveMission(); renderMission();
    setText('timelineAnnouncement', `${missionState.watchlist[id] ? 'Forecast saved.' : 'Forecast removed.'} ${missionStorageMessage}`);
  }
  if (acknowledge) {
    ensureMission();
    const row = forecastRecords().find(row => row.id === acknowledge.dataset.ack);
    if (row && missionState.watchlist[row.id] && publishedSignals) {
      missionState.watchlist[row.id] = { title:row.title, forecast:JSON.stringify(row.data), seen:evidenceSnapshot(row.id) };
      saveMission(); renderMission();
    }
  }
  if (inspect) {
    openExplore('#observations');
    const select = byId('observationPrediction');
    select.value = inspect.dataset.inspect;
    select.dispatchEvent(new Event('change'));
    select.focus({ preventScroll:true }); select.scrollIntoView({ block:'center', behavior:'instant' });
  }
  if (read && byId('reader').open) {
    ensureMission(); completeQuest('chapter-v1');
    read.textContent = 'Reading recorded'; read.setAttribute('aria-pressed', 'true');
    read.closest('.reader-context').querySelector('[role="status"]').textContent = missionStorageMessage;
  }
});

function initializeExplore(){
  ensureMission();
  let timelineData = forecastData?.years || [];
  let predictionModelState = model ? 'loaded' : 'loading';
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const frames = new Set(), timers = new Set();
  function requestAnimationFrame(callback){
    const id = window.requestAnimationFrame(time => { frames.delete(id); callback(time); });
    frames.add(id); return id;
  }
  function setTimeout(callback, delay){
    const id = window.setTimeout(() => { timers.delete(id); callback(); }, delay);
    timers.add(id); return id;
  }
  function clearTimeout(id){ timers.delete(id); window.clearTimeout(id); }
  const probabilitySimulatorState = {
  anchors:null,
  values:null,
  controlsBound:false,
  updateTimer:0,
};
const simulatorBranchGeometry = [
  { key:'managed', variant:'managed', d:'M274 168 C322 128 352 78 412 76' },
  { key:'handoff', variant:'managed', d:'M428 75 C500 72 558 66 642 65' },
  { key:'default', variant:'default', d:'M274 170 C330 170 362 170 412 170 C500 170 558 170 650 170' },
  { key:'ungoverned', variant:'ungoverned', d:'M274 172 C324 214 356 266 412 270 C500 276 560 280 650 282' },
];
const simulatorNodeScale = {
  agi:{ id:'sim-node-agi', base:8, range:6 },
  default:{ id:'sim-node-default', base:7, range:6 },
  ungoverned:{ id:'sim-node-ungoverned', base:7, range:6 },
  handoff:{ id:'sim-node-handoff', base:6, range:6 },
};
  function fasterBranchRange(years){
  const anchored = years.flatMap(year => year.events.map(event => ({ ...event, year:year.year })));
  const ungoverned = anchored.find(event => event.simAnchor === 'ungoverned');
  const defaultPath = anchored.find(event => event.simAnchor === 'default');
  if (ungoverned && defaultPath) {
    return { start:ungoverned.year, end:defaultPath.year, label:`${ungoverned.year}–${defaultPath.year}` };
  }
  const match = years.map(year => year.summary).join(' ').match(/\b(20\d{2})\s*[–-]\s*(20\d{2})\b/);
  if (!match) return null;
  return { start:Number(match[1]), end:Number(match[2]), label:`${match[1]}–${match[2]}` };
}

function simulatorAnchors(years){
  const events = years.flatMap(year => year.events.map(event => ({ ...event, year:year.year })));
  const anchors = {
    agi:events.find(event => event.simAnchor === 'agi' && Number.isFinite(event.prob)),
    managed:events.find(event => event.simAnchor === 'managed' && Number.isFinite(event.prob)),
    default:events.find(event => event.simAnchor === 'default' && Number.isFinite(event.prob)),
    ungoverned:events.find(event => event.simAnchor === 'ungoverned' && Number.isFinite(event.prob)),
    handoff:events.find(event => event.simAnchor === 'handoff' && Number.isFinite(event.prob)),
  };
  return Object.values(anchors).every(Boolean) ? anchors : null;
}

function simulatedProbabilities(anchors, assumptions){
  const { capability, coordination, deployment } = assumptions;
  const round = value => Math.round(clampNumber(value, 5, 95));
  return {
    agi:round(anchors.agi.prob + capability * .55),
    managed:round(anchors.managed.prob - capability * .15 + coordination * .65),
    default:round(anchors.default.prob + capability * .45 - coordination * .35 - deployment * .08),
    ungoverned:round(anchors.ungoverned.prob + capability * .5 - coordination * .55),
    handoff:round(anchors.handoff.prob + coordination * .35 - deployment * .45),
  };
}

function simulatorAssumptions(){
  return {
    capability:Number(document.getElementById('simCapability').value),
    coordination:Number(document.getElementById('simCoordination').value),
    deployment:Number(document.getElementById('simDeployment').value),
  };
}

function formatSimulatorAssumption(value){
  if (value === 0) return 'Baseline';
  return (value > 0 ? '+' : '−') + Math.abs(value);
}

function simulatorBranchStyle(value){
  const share = clampNumber(value, 0, 100) / 100;
  return {
    width:(1.5 + share * 8).toFixed(2),
    opacity:(.22 + share * .74).toFixed(2),
  };
}

function animateSimulatorValue(element, next, animate){
  if (!element) return;
  const previous = Number.parseInt(element.textContent, 10);
  if (!animate || motionQuery.matches || !Number.isFinite(previous)) {
    element.textContent = next + '%';
    return;
  }
  const token = String((Number(element.dataset.animationToken) || 0) + 1);
  element.dataset.animationToken = token;
  const started = performance.now();
  const duration = 260;
  function frame(now){
    if (element.dataset.animationToken !== token) return;
    const progress = clampNumber((now - started) / duration, 0, 1);
    const value = Math.round(previous + (next - previous) * (1 - Math.pow(1 - progress, 3)));
    element.textContent = value + '%';
    if (progress < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function setSimulatorBranch(key, value){
  const group = document.getElementById('sim-branch-' + key);
  const fill = document.getElementById('sim-path-' + key);
  if (!group || !fill) return;
  const style = simulatorBranchStyle(value);
  group.style.setProperty('--branch-width', style.width);
  group.style.setProperty('--branch-opacity', style.opacity);
  /* Filled length is the quantity. getTotalLength() is geometry not layout, so it is correct before
     first paint and inside a hidden route, where a bounding-box read would be 0 and draw it empty. */
  const total = typeof fill.getTotalLength === 'function' ? fill.getTotalLength() : 0;
  if (total > 0) {
    const filled = total * clampNumber(value, 0, 100) / 100;
    fill.style.strokeDasharray = `${filled.toFixed(2)} ${(total - filled + 1).toFixed(2)}`;
  }
  group.setAttribute('data-probability', String(value));
}

function setSimulatorNode(key, value){
  const scale = simulatorNodeScale[key];
  if (!scale) return;
  const node = document.getElementById(scale.id);
  if (!node) return;
  node.setAttribute('r', (scale.base + clampNumber(value, 0, 100) / 100 * scale.range).toFixed(2));
}

function updateProbabilitySimulator(animate = true){
  if (!probabilitySimulatorState.anchors) return;
  const assumptions = simulatorAssumptions();
  const values = simulatedProbabilities(probabilitySimulatorState.anchors, assumptions);
  probabilitySimulatorState.values = values;
  document.getElementById('simCapabilityOutput').textContent = formatSimulatorAssumption(assumptions.capability);
  document.getElementById('simCoordinationOutput').textContent = formatSimulatorAssumption(assumptions.coordination);
  document.getElementById('simDeploymentOutput').textContent = formatSimulatorAssumption(assumptions.deployment);
  document.getElementById('simCapability').setAttribute('aria-valuetext', formatSimulatorAssumption(assumptions.capability));
  document.getElementById('simCoordination').setAttribute('aria-valuetext', formatSimulatorAssumption(assumptions.coordination));
  document.getElementById('simDeployment').setAttribute('aria-valuetext', formatSimulatorAssumption(assumptions.deployment));
  Object.entries(values).forEach(([key, value]) => {
    animateSimulatorValue(document.getElementById('sim-card-' + key), value, animate);
    document.getElementById('sim-rail-' + key)?.style.setProperty('--prob', value + '%');
    const row = document.querySelector(`[data-simulator-outcome="${key}"]`);
    if (row) row.setAttribute('aria-label', `${simulatorOutcomeLabels[key].title}. Conditional likelihood: ${value} percent.`);
  });
  setSimulatorBranch('managed', values.managed);
  setSimulatorBranch('handoff', values.handoff);
  setSimulatorBranch('default', values.default);
  setSimulatorBranch('ungoverned', values.ungoverned);
  Object.keys(simulatorNodeScale).forEach(key => setSimulatorNode(key, values[key]));
  const branches = [
    ['Managed pause', values.managed],
    ['Default-path superintelligence', values.default],
    ['Ungoverned takeoff', values.ungoverned],
  ].sort((a, b) => b[1] - a[1]);
  /* Which branch leads is categorical, so it gets a categorical mark: proportional encodings alone
     cannot show a lead CHANGING HANDS, which is the most decisive thing these assumptions can do. */
  const leaders = { 'Managed pause':'managed', 'Default-path superintelligence':'default', 'Ungoverned takeoff':'ungoverned' };
  const leadingKey = leaders[branches[0][0]];
  simulatorBranchGeometry.forEach(branch => {
    document.getElementById('sim-branch-' + branch.key)
      ?.classList.toggle('is-leading', branch.key === leadingKey);
  });
  const isBaseline = Object.values(assumptions).every(value => value === 0);
  document.getElementById('simulatorInterpretation').textContent = isBaseline
    ? `Published baseline: AGI ${values.agi}%, managed pause ${values.managed}%, default path ${values.default}%, ungoverned takeoff ${values.ungoverned}%, managed handoff ${values.handoff}%.`
    : `Under these assumptions, ${branches[0][0].toLowerCase()} carries the strongest simulated pressure at ${branches[0][1]}%, while the end-2026 AGI anchor moves to ${values.agi}%.`;
  const description = document.getElementById('simulatorSvgDesc');
  if (description) description.textContent =
    `A branch map from the ${values.agi}% end-2026 AGI anchor to a ${values.managed}% managed pause, ${values.default}% default path, ${values.ungoverned}% ungoverned takeoff and ${values.handoff}% managed handoff.`;
  document.querySelectorAll('[data-sim-preset]').forEach(button => {
    const preset = simulatorPresets[button.dataset.simPreset];
    const active = preset && Object.keys(preset).every(key => preset[key] === assumptions[key]);
    button.classList.toggle('active', active);
  });
  const map = document.getElementById('probabilitySimulatorMap');
  if (animate && !motionQuery.matches) {
    map.classList.remove('is-updating');
    void map.offsetWidth;
    map.classList.add('is-updating');
    clearTimeout(probabilitySimulatorState.updateTimer);
    probabilitySimulatorState.updateTimer = setTimeout(() => map.classList.remove('is-updating'), 380);
  }
}

function bindProbabilitySimulatorControls(){
  if (probabilitySimulatorState.controlsBound) return;
  probabilitySimulatorState.controlsBound = true;
  ['simCapability','simCoordination','simDeployment'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => updateProbabilitySimulator(true));
  });
  document.querySelectorAll('[data-sim-preset]').forEach(button => button.addEventListener('click', () => {
    const preset = simulatorPresets[button.dataset.simPreset];
    if (!preset) return;
    document.getElementById('simCapability').value = preset.capability;
    document.getElementById('simCoordination').value = preset.coordination;
    document.getElementById('simDeployment').value = preset.deployment;
    updateProbabilitySimulator(true);
  }));
}

function renderProbabilitySimulator(years, branchRange){
  const host = document.getElementById('probabilitySimulatorMap');
  const grid = document.getElementById('simulatorProbabilityGrid');
  if (!host || !grid) return;
  const anchors = simulatorAnchors(years);
  probabilitySimulatorState.anchors = anchors;
  bindProbabilitySimulatorControls();
  const controls = ['simCapability','simCoordination','simDeployment'].map(id => document.getElementById(id));
  controls.forEach(control => { control.disabled = !anchors; });
  if (!anchors) {
    host.className = 'simulator-map';
    const message = predictionModelState === 'loading'
      ? 'Loading forecast anchors…'
      : predictionModelState === 'offline'
        ? 'The simulator needs predictions.json when this file is opened offline.'
        : 'Published simulator anchors are unavailable.';
    host.innerHTML = `<div class="simulator-loading">${message}</div>`;
    grid.innerHTML = '';
    document.getElementById('simulatorInterpretation').textContent = message;
    return;
  }
  const initial = simulatedProbabilities(anchors, simulatorAssumptions());
  host.className = 'simulator-map simulator-ready';
  host.innerHTML = `
    <svg viewBox="0 0 720 330" role="img" aria-labelledby="simulatorSvgTitle simulatorSvgDesc">
      <title id="simulatorSvgTitle">Interactive probability branch map from 2026 to 2040</title>
      <desc id="simulatorSvgDesc">A branch map using published forecast anchors.</desc>
      <line class="sim-grid-line" x1="34" y1="306" x2="690" y2="306"/>
      <text class="sim-year" x="42" y="322" text-anchor="middle">2026</text>
      <text class="sim-year" x="420" y="322" text-anchor="middle">${branchRange ? branchRange.label : '2028–2030'}</text>
      <text class="sim-year" x="650" y="322" text-anchor="middle">2040</text>
      <path class="sim-trunk" d="M52 170 C92 170 116 170 146 170 M164 170 C205 170 232 170 266 170"/>
      ${simulatorBranchGeometry.map(branch => `
      <g id="sim-branch-${branch.key}" class="sim-branch-group ${branch.variant}">
        <path class="sim-branch ${branch.variant}" d="${branch.d}"/>
        <path id="sim-path-${branch.key}" class="sim-branch-fill ${branch.variant}" d="${branch.d}"/>
      </g>`).join('')}
      <g class="sim-node">
        <circle class="sim-node-ring" cx="43" cy="170" r="9"/><circle class="sim-node-core" cx="43" cy="170" r="3"/>
        <text class="sim-sublabel" x="43" y="194" text-anchor="middle">NOW</text>
      </g>
      <g class="sim-node">
        <circle id="sim-node-agi" class="sim-node-ring" cx="155" cy="170" r="11"/><circle class="sim-node-core" cx="155" cy="170" r="4"/>
        <text class="sim-label" x="155" y="132" text-anchor="middle">HUMAN-LEVEL AGI</text>
        <text class="sim-sublabel" x="155" y="147" text-anchor="middle">END OF 2026</text>
      </g>
      <rect class="sim-gate" x="264" y="162" width="16" height="16" rx="3" transform="rotate(45 272 170)"/>
      <text class="sim-sublabel" x="272" y="198" text-anchor="middle">BRANCH POINT</text>
      <g class="sim-node">
        <rect class="sim-gate" x="412" y="67" width="16" height="16" rx="3"/>
        <text class="sim-label" x="420" y="36" text-anchor="middle">MANAGED PAUSE</text>
        <text class="sim-sublabel" x="420" y="52" text-anchor="middle">FRONTIER TRAINING · 2029</text>
      </g>
      <g class="sim-node">
        <circle id="sim-node-handoff" class="sim-node-ring" cx="650" cy="65" r="10"/><circle class="sim-node-core" cx="650" cy="65" r="3"/>
        <text class="sim-label" x="650" y="36" text-anchor="middle">MANAGED HANDOFF</text>
        <text class="sim-sublabel" x="650" y="52" text-anchor="middle">2040</text>
      </g>
      <g class="sim-node">
        <circle id="sim-node-default" class="sim-node-ring" cx="420" cy="170" r="11"/><circle class="sim-node-core" cx="420" cy="170" r="4"/>
        <text class="sim-label" x="420" y="140" text-anchor="middle">DEFAULT PATH</text>
        <text class="sim-sublabel" x="420" y="156" text-anchor="middle">TOP-EXPERT / ASI · 2030</text>
      </g>
      <g class="sim-node">
        <circle id="sim-node-ungoverned" class="sim-node-ring" cx="420" cy="270" r="11"/><circle class="sim-node-core" cx="420" cy="270" r="4"/>
        <text class="sim-label" x="420" y="240" text-anchor="middle">UNGOVERNED TAKEOFF</text>
        <text class="sim-sublabel" x="420" y="256" text-anchor="middle">${branchRange ? branchRange.label : '2028–2030'} WINDOW</text>
      </g>
    </svg>`;
  grid.innerHTML = Object.keys(simulatorOutcomeLabels).map(key => `
    <div class="simulator-outcome" data-simulator-outcome="${key}" aria-label="${simulatorOutcomeLabels[key].title}. Conditional likelihood: ${initial[key]} percent.">
      <div class="simulator-outcome-copy"><strong>${simulatorOutcomeLabels[key].title}</strong><span>${simulatorOutcomeLabels[key].meta}</span></div>
      <span class="simulator-outcome-rail" id="sim-rail-${key}" style="--prob:${initial[key]}%" aria-hidden="true"><i></i></span>
      <strong class="simulator-outcome-stat" id="sim-card-${key}">${initial[key]}%</strong>
    </div>
  `).join('');
  updateProbabilitySimulator(false);
}
  /* ---------- Six Ds ---------- */

document.getElementById('sixDs').innerHTML = sixDs.map((d,i) => `
  <div class="drow">
    <div class="dword"><span>${String(i+1).padStart(2,'0')}</span> &nbsp;${d[0]}</div>
    <div class="ddesc">${d[1]}</div>
  </div>`).join('');


  /* ---------- Five Futures, One Portfolio ---------- */


document.getElementById('futTabs').setAttribute('role', 'tablist');
document.getElementById('futTabs').setAttribute('aria-label', 'Future branches');
document.getElementById('futTabs').innerHTML = futures.map((f,i) =>
  `<button type="button" role="tab" class="fut-tab ${i===0?'active':''}" id="future-tab-${i}" data-i="${i}" aria-selected="${i===0}" aria-controls="future-panel-${i}" tabindex="${i===0?'0':'-1'}"><span class="dotmark" style="background:${f.col}"></span>${f.key} · ${f.name}</button>`).join('');
document.getElementById('futPanels').innerHTML = futures.map((f,i) => `
  <div class="fut-panel ${i===0?'active':''}" id="future-panel-${i}" data-i="${i}" role="tabpanel" aria-labelledby="future-tab-${i}">
    <div>
      <h3>${f.name}</h3>
      <div class="fut-prob">LIKELIHOOD: ${f.prob.toUpperCase()}</div>
      <p>${f.desc}</p>
      <ul class="fut-list">${f.moves.map(m=>`<li>${m}</li>`).join('')}</ul>
    </div>
    <div class="fut-side" data-hedgechip="${i}">
      <h4>Your hedge for this branch</h4>
      <div class="hedge-chip"><span class="alloc-dot" style="background:${f.col}"></span><span class="hedge-chip-name">${allocBuckets[i].name}</span></div>
      <div class="hedge-chip-stat"><span class="mono" data-chip-pct>0%</span><span class="hedge-chip-of">of net worth</span></div>
      <div class="hedge-chip-dollar mono" data-chip-dollar>$0</div>
      <button class="hedge-jump" data-jump>Adjust your allocation ↓</button>
    </div>
  </div>`).join('');
function selectFutureTab(tab){
  const i = tab.dataset.i;
  document.querySelectorAll('.fut-tab').forEach(t => {
    const active = t === tab;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', String(active));
    t.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll('.fut-panel').forEach(p=>p.classList.remove('active'));
  document.querySelector(`.fut-panel[data-i="${i}"]`).classList.add('active');
}
document.querySelectorAll('.fut-tab').forEach(tab => {
  tab.addEventListener('click', () => selectFutureTab(tab));
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll('.fut-tab')];
    const current = tabs.indexOf(tab);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    selectFutureTab(tabs[next]);
    tabs[next].focus();
  });
});


  /* ---------- One Portfolio: net-worth allocator ---------- */
(function(){
  const rowsEl = document.getElementById('allocRows');
  const totalEl = document.getElementById('allocTotal');
  const hintEl = document.getElementById('allocHint');
  const stackEl = document.getElementById('allocStackBar');
  const nwInput = document.getElementById('netWorthInput');
  if(!rowsEl) return;
  let weights = allocBuckets.map(b => b.def);
  let netWorth = 100000;
  const fmt = n => '$' + Math.round(n).toLocaleString('en-US');
  const parseNW = s => { const n = parseFloat(String(s).replace(/[^0-9.]/g,'')); return isNaN(n) ? 0 : n; };
  const clamp = n => Math.max(0, Math.min(100, Math.round(n || 0)));

  rowsEl.innerHTML = allocBuckets.map((b,i) => `
    <div class="alloc-row" data-i="${i}">
      <div class="alloc-meta">
        <span class="alloc-dot" style="background:${b.col}"></span>
        <div class="alloc-text"><div class="alloc-name">${b.name}</div><div class="alloc-sub">${b.sub}</div></div>
      </div>
      <input type="range" class="alloc-slider" min="0" max="100" step="1" value="${weights[i]}" aria-label="${b.name} allocation percent" style="accent-color:${b.col}">
      <div class="alloc-vals">
        <span class="alloc-pct"><input type="number" class="alloc-num" min="0" max="100" step="1" value="${weights[i]}">%</span>
        <span class="alloc-dollar mono" data-dollar>${fmt(netWorth*weights[i]/100)}</span>
      </div>
    </div>`).join('');

  const rowEls = [...rowsEl.querySelectorAll('.alloc-row')];

  function render(){
    const total = weights.reduce((a,b)=>a+b,0);
    rowEls.forEach((row,i) => {
      row.querySelector('.alloc-slider').value = weights[i];
      const num = row.querySelector('.alloc-num');
      if(document.activeElement !== num) num.value = weights[i];
      row.querySelector('[data-dollar]').textContent = fmt(netWorth*weights[i]/100);
    });
    totalEl.textContent = total + '%';
    totalEl.classList.toggle('ok', total === 100);
    totalEl.classList.toggle('off', total !== 100);
    const off = total - 100;
    hintEl.textContent = off === 0 ? 'Balanced ✓' : (off < 0 ? (100 - total) + '% unallocated' : '+' + off + '% over');
    hintEl.classList.toggle('ok', off === 0);
    hintEl.classList.toggle('off', off !== 0);
    const denom = total > 0 ? total : 1;
    stackEl.innerHTML = allocBuckets.map((b,i) => weights[i] > 0 ? `<span style="width:${weights[i]/denom*100}%;background:${b.col}"></span>` : '').join('');
    document.querySelectorAll('[data-hedgechip]').forEach(el => {
      const i = +el.dataset.hedgechip;
      const p = el.querySelector('[data-chip-pct]'); const d = el.querySelector('[data-chip-dollar]');
      if(p) p.textContent = weights[i] + '%';
      if(d) d.textContent = fmt(netWorth*weights[i]/100);
    });
  }

  rowEls.forEach((row,i) => {
    row.querySelector('.alloc-slider').addEventListener('input', e => { weights[i] = clamp(+e.target.value); render(); });
    row.querySelector('.alloc-num').addEventListener('input', e => { weights[i] = clamp(+e.target.value); render(); });
  });
  nwInput.addEventListener('input', () => { netWorth = parseNW(nwInput.value); render(); });

  document.getElementById('allocNormalize').addEventListener('click', () => {
    const total = weights.reduce((a,b)=>a+b,0);
    if(total === 0){ weights = allocBuckets.map(b=>b.def); render(); return; }
    const raw = weights.map(w => w/total*100);
    const out = raw.map(Math.floor);
    const rem = 100 - out.reduce((a,b)=>a+b,0);
    const order = raw.map((v,i)=>[i, v - Math.floor(v)]).sort((a,b)=>b[1]-a[1]);
    for(let k=0; k<rem; k++) out[order[k % order.length][0]]++;
    weights = out; render();
  });
  document.getElementById('allocReset').addEventListener('click', () => {
    weights = allocBuckets.map(b=>b.def); netWorth = 100000; nwInput.value = '100,000'; render();
  });
  document.addEventListener('click', e => {
    if(e.target.closest('[data-jump]')) document.getElementById('portfolioBuilder').scrollIntoView({ behavior:'smooth', block:'start' });
  });

  render();
})();


  /* ---------- 1000-Day Moonshot planner ---------- */

let answers = new Array(questions.length).fill(null);
let qi = 0;

function renderPlanner(){
  document.getElementById('plannerSteps').innerHTML =
    questions.map((_,i)=>`<div class="pstep ${i<=qi||answers[i]!=null?'done':''}"></div>`).join('') + `<div class="pstep ${qi>=questions.length?'done':''}"></div>`;
  const body = document.getElementById('plannerBody');
  if (qi < questions.length){
    const Q = questions[qi];
    body.innerHTML = `
      <div class="q-block">
        <div class="q-num">QUESTION ${qi+1} / ${questions.length}</div>
        <div class="q-text" id="planner-question">${Q.q}</div>
        <div class="opts" role="radiogroup" aria-labelledby="planner-question">
          ${Q.opts.map((o,j)=>`<button type="button" role="radio" aria-checked="${answers[qi]===j}" class="opt ${answers[qi]===j?'sel':''}" data-j="${j}"><span class="opt-key">${o[1].toUpperCase()}</span>${o[0]}</button>`).join('')}
        </div>
        <div class="planner-nav">
          <button class="btn btn-ghost" id="prevBtn" ${qi===0?'style="visibility:hidden"':''}>Back</button>
          <button class="btn btn-primary" id="nextBtn" ${answers[qi]==null?'disabled style="opacity:.5;cursor:not-allowed"':''}>${qi===questions.length-1?'See my plan':'Next'}</button>
        </div>
      </div>`;
    body.querySelectorAll('.opt').forEach(o => o.addEventListener('click', () => {
      const selected = +o.dataset.j;
      answers[qi] = selected;
      renderPlanner();
      requestAnimationFrame(() => body.querySelector(`.opt[data-j="${selected}"]`)?.focus());
    }));
    document.getElementById('nextBtn').addEventListener('click', () => { if(answers[qi]!=null){ qi++; renderPlanner(); } });
    const pv = document.getElementById('prevBtn'); if(pv) pv.addEventListener('click', () => { qi--; renderPlanner(); });
  } else {
    renderResult(body);
  }
}

function renderResult(body){
  const dims = { survival:0, capability:0, assets:0, community:0, portfolio:0, urgency:0 };
  questions.forEach((Q,i) => { if(answers[i]!=null) dims[Q.dim] += Q.opts[answers[i]][2]; });
  const total = Object.values(dims).reduce((a,b)=>a+b,0);
  const pct = Math.round((total/18)*100);
  let phase, verdict;
  if (pct < 30){ phase='Phase 1 · 0–30 days'; verdict='You\'re at the launch pad. Start by writing the one-page version of your plan — name your survival floor, your skills, and the single asset you\'d most like to own.'; }
  else if (pct < 55){ phase='Phase 2 · 30–180 days'; verdict='You\'ve got a foundation. Now compound capability: learn to orchestrate AI instead of competing with it, and pick one durable, hard-to-automate skill.'; }
  else if (pct < 80){ phase='Phase 3 · 180–365 days'; verdict='You\'re resilient. Convert that into ownership — get access to things that produce: energy, compute, audience, equity, or a share of the robots.'; }
  else { phase='Phase 4 · 365–1000 days'; verdict='You\'re ahead of the curve. Become a node: plug into a community and a distribution layer, and help build the better branch instead of just surviving it.'; }

  const bars = [ ['Survival floor', dims.survival],['Capability', dims.capability],['Productive assets', dims.assets],['Community', dims.community],['Portfolio breadth', dims.portfolio] ];
  const checklist = [];
  if (dims.survival < 2) checklist.push('Build a 6+ month cash & skills buffer before anything else.');
  if (dims.capability < 2) checklist.push('Use AI tools daily until directing them feels native.');
  if (dims.assets < 2) checklist.push('Acquire one productive asset — audience, equity, or a slice of compute.');
  if (dims.community < 2) checklist.push('Join or build one community that compounds over time.');
  if (dims.portfolio < 3) checklist.push('Hedge across all five futures, not just the one you fear or hope for.');
  if (dims.urgency < 2) checklist.push('Assume impact arrives sooner than comfortable — plan on a 1000-day clock.');
  if (!checklist.length) checklist.push('You\'re well-positioned — now help others up the ladder and steer the distribution layer.');

  const C = 2*Math.PI*52; const off = C*(1-pct/100);
  body.innerHTML = `
    <div class="result">
      <svg class="score-ring" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="52" fill="none" stroke="var(--cp-surface-soft)" stroke-width="10"/>
        <circle cx="60" cy="60" r="52" fill="none" stroke="var(--cp-accent)" stroke-width="10" stroke-linecap="round"
          stroke-dasharray="${C}" stroke-dashoffset="${C}" transform="rotate(-90 60 60)" id="ring"/>
        <text x="60" y="56" text-anchor="middle" font-size="26" font-weight="800" fill="var(--cp-text)" font-family="Consolas,monospace">${pct}</text>
        <text x="60" y="74" text-anchor="middle" font-size="9" fill="var(--cp-text-muted)" font-family="Consolas,monospace">READINESS</text>
      </svg>
      <div class="q-num">${phase.toUpperCase()}</div>
      <h3>Your starting vector</h3>
      <p class="verdict">${verdict}</p>
      <div class="profile-bars">
        ${bars.map(b=>{const p=Math.round((b[1]/3)*100);return `
          <div class="bar-row">
            <div class="bar-label"><span>${b[0]}</span><span class="mono">${b[1]}/3</span></div>
            <div class="bar-track"><div class="bar-fill" style="width:0%" data-w="${p}"></div></div>
          </div>`;}).join('')}
      </div>
      <h4 style="font-family:Consolas,monospace;font-size:0.7rem;letter-spacing:0.16em;text-transform:uppercase;color:var(--cp-text-muted);margin:8px 0 14px;text-align:center">Your next moves</h4>
      <div class="checklist">
        ${checklist.map(c=>`<div class="check-item"><span class="ci-ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg></span>${c}</div>`).join('')}
      </div>
      <div style="margin-top:26px"><button class="btn btn-ghost" id="restartBtn">Start over</button></div>
    </div>`;
  requestAnimationFrame(() => {
    const r = document.getElementById('ring'); if(r) r.style.transition='stroke-dashoffset 1s ease', r.style.strokeDashoffset=off;
    body.querySelectorAll('.bar-fill').forEach(f => setTimeout(()=>f.style.width=f.dataset.w+'%',120));
  });
  document.getElementById('restartBtn').addEventListener('click', () => { answers=new Array(questions.length).fill(null); qi=0; renderPlanner(); });
}
renderPlanner();


  (function(){
    /* ---------- Book star map ---------- */
const systems = [
  { id:'op', x:50,  y:240, label:'Opening', sub:'launch vector', col:'var(--cp-accent)' },
  { id:'01', x:120, y:170, label:'01 · Why', sub:'origin system', col:'var(--cp-accent)' },
  { id:'02', x:200, y:215, label:'02 · Abundance', sub:'engine room', col:'var(--cp-accent)' },
  { id:'03', x:165, y:110, label:'03 · Human Stack', sub:'ordinary life', col:'var(--cp-accent)' },
  { id:'04', x:265, y:140, label:'04 · Energy', sub:'compute lanes', col:'var(--cp-accent)' },
  { id:'05', x:300, y:225, label:'05 · Work', sub:'new ladders', col:'var(--cp-accent)' },
  { id:'06', x:355, y:90,  label:'06 · Portfolio', sub:'scenario bets', col:'var(--cp-accent)' },
];
const links = [['op','01'],['01','02'],['02','03'],['02','04'],['04','06'],['02','05'],['05','06'],['03','04']];
const sm = document.getElementById('starmap');
const byId = Object.fromEntries(systems.map(s=>[s.id,s]));
let smHtml = `<rect x="0" y="0" width="420" height="300" fill="var(--cp-bg-elevated)"/>`;
smHtml += `<path d="M28 252 C105 44 288 42 392 246" fill="none" stroke="var(--cp-border)" stroke-width="1"/>
  <path d="M42 266 C164 174 276 164 378 62" fill="none" stroke="var(--cp-border)" stroke-width="1" stroke-dasharray="4 5"/>`;
links.forEach(([a,b]) => { const A=byId[a],B=byId[b]; smHtml += `<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" stroke="var(--cp-border-strong)" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>`; });
systems.forEach(s => {
  smHtml += `<g class="sysnode" data-sys="${s.id}" role="button" tabindex="0" aria-label="Open ${s.label} chapter" style="cursor:pointer">
    <circle cx="${s.x}" cy="${s.y}" r="7" fill="${s.col}"/>
    <circle cx="${s.x}" cy="${s.y}" r="13" fill="none" stroke="${s.col}" stroke-width="1" opacity="0.4"/>
    <text x="${s.x}" y="${s.y-18}" text-anchor="middle" fill="var(--cp-text)" font-size="9" font-family="Consolas,monospace" font-weight="700">${s.label}</text>
    <text x="${s.x}" y="${s.y+24}" text-anchor="middle" fill="var(--cp-text-muted)" font-size="7" font-family="Consolas,monospace">${s.sub}</text>
  </g>`;
});
sm.innerHTML = smHtml;


    document.querySelectorAll('.sysnode').forEach(element => {
      const open = () => {
        const indexes = { op:1, '01':2, '02':3, '03':4, '04':5, '05':6, '06':7 };
        window.openReader(indexes[element.dataset.sys]);
      };
      element.addEventListener('click', open);
      element.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
      });
    });
  })();
  bindMissionControls();
  document.querySelector('.probability-simulator').addEventListener('input', () => completeQuest('scenario-v1'));
  document.querySelector('.probability-simulator').addEventListener('click', event => {
    if (event.target.closest('[data-sim-preset]:not([data-sim-preset="baseline"])') && probabilitySimulatorState.anchors)
      completeQuest('scenario-v1');
  });
  const filters = initialForecastFilters();
  let evidenceVisible = true, cataloguePage = 0;
  function catalogue(syncUrl = false){
    const dated = forecastRecords().filter(row => !row.id.startsWith('horizon-'));
    const matched = dated.filter(row => matchesCatalogueFilters(row.data, filters));
    const horizons = forecastRecords().filter(row => row.id.startsWith('horizon-')
      && (!filters.query || row.title.toLowerCase().includes(filters.query.toLowerCase()))
      && (filters.domain === 'all' || filters.domain === row.data.d));
    const host = byId('catalogueResults');
    const total = matched.length + horizons.length;
    cataloguePage = Math.min(cataloguePage, Math.max(0, Math.ceil(total / 12) - 1));
    host.replaceChildren();
    for (const row of [...matched, ...horizons].slice(cataloguePage * 12, cataloguePage * 12 + 12)) {
      const item = node('article', 'catalogue-result');
      const title = node('h4');
      title.append(link(row.title, row.href));
      item.append(node('p', 'instrument-label', `${row.timing} / ${domainNames[row.data.d]}`), title,
        node('p', '', row.probability), watchControl(row.id));
      if (evidenceVisible) {
        const news = publishedSignals?.embeds[row.id] || publishedSignals?.context?.items[row.id];
        item.append(node('p', 'mission-help', !publishedSignals ? 'Evidence unavailable; no source is inferred.'
          : news ? `${publishedSignals.context.items[row.id] ? 'Dated background' : 'Cited in this snapshot'}: ${news.publisher}. Open the forecast for dates and limits.`
            : publishedSignals.uncited.items[row.id]?.statement || 'No NEWS record is available.'));
      }
      host.append(item);
    }
    if (!total) host.append(node('p', 'mission-help', model ? 'No forecasts match these filters.' : 'Forecast records are unavailable.'));
    if (total > 12) {
      const pages = node('nav', 'more-stories');
      pages.setAttribute('aria-label', 'Forecast catalogue pages');
      const previous = action('Previous forecasts', () => { cataloguePage--; catalogue(); byId('filterResultCount').focus(); });
      const next = action('Next forecasts', () => { cataloguePage++; catalogue(); byId('filterResultCount').focus(); });
      previous.disabled = cataloguePage === 0; next.disabled = (cataloguePage + 1) * 12 >= total;
      pages.append(previous, node('span', '', `${cataloguePage + 1} / ${Math.ceil(total / 12)}`), next); host.append(pages);
    }
    setText('filterResultCount', model ? `${matched.length} dated forecasts and ${horizons.length} undated horizons match.` : 'Forecast catalogue unavailable.');
    byId('filterResultCount').tabIndex = -1;
    byId('atlasSearch').value = filters.query;
    byId('branchFilter').value = filters.branch;
    byId('probabilityFilter').value = filters.probability;
    byId('themeFilter').value = filters.theme;
    byId('changesOnlyToggle').setAttribute('aria-pressed', String(filters.changed));
    document.querySelectorAll('[data-domain]').forEach(button => {
      button.classList.toggle('active', button.dataset.domain === filters.domain);
      button.setAttribute('aria-pressed', String(button.dataset.domain === filters.domain));
    });
    document.querySelectorAll('[data-domain-count]').forEach(element => {
      element.textContent = dated.filter(row => element.dataset.domainCount === 'all' || row.data.d === element.dataset.domainCount).length;
    });
    if (syncUrl) {
      const url = new URL(location.href);
      for (const [key, value] of Object.entries({ fd:filters.domain, fb:filters.branch, fp:filters.probability, ft:filters.theme, fc:filters.changed ? '1' : '', fq:filters.query })) {
        if (!value || value === 'all') url.searchParams.delete(key); else url.searchParams.set(key, value);
      }
      history.replaceState(history.state, '', url);
    }
    renderChapterSearch(filters.query);
  }
  function changeFilter(key, value){
    filters[key] = value; cataloguePage = 0; catalogue(true);
  }
  byId('atlasSearch').addEventListener('input', event => changeFilter('query', event.target.value.slice(0, 120)));
  byId('atlasSearch').addEventListener('keydown', event => {
    if (event.key === 'Escape') changeFilter('query', '');
  });
  byId('searchClear').addEventListener('click', () => { changeFilter('query', ''); byId('atlasSearch').focus(); });
  for (const [id, key] of [['branchFilter','branch'],['probabilityFilter','probability'],['themeFilter','theme']])
    byId(id).addEventListener('change', event => changeFilter(key, event.target.value));
  byId('changesOnlyToggle').addEventListener('click', () => changeFilter('changed', !filters.changed));
  document.querySelectorAll('[data-domain]').forEach(button => button.addEventListener('click', () => changeFilter('domain', button.dataset.domain)));
  byId('filterReset').addEventListener('click', () => {
    Object.assign(filters, { domain:'all', branch:'all', probability:'all', theme:'all', changed:false, query:'' });
    cataloguePage = 0; catalogue(true);
  });
  byId('overlayToggle').addEventListener('click', () => {
    evidenceVisible = !evidenceVisible;
    byId('overlayToggle').setAttribute('aria-pressed', String(evidenceVisible));
    byId('overlaySwitch').classList.toggle('on', evidenceVisible);
    byId('overlayToggle').querySelector('span:last-child').textContent = evidenceVisible ? 'Evidence visible' : 'Evidence hidden';
    catalogue();
  });
  function update(){
    timelineData = forecastData?.years || [];
    predictionModelState = model ? 'loaded' : 'unavailable';
    renderProbabilitySimulator(timelineData, fasterBranchRange(timelineData));
    const select = byId('observationPrediction'), selected = select.value;
    select.replaceChildren(new Option(model ? 'Choose a forecast to inspect' : 'Forecast data unavailable', ''));
    for (const row of forecastRecords()) select.add(new Option(`${row.timing} / ${row.title}`, row.id));
    if (forecastRecords().some(row => row.id === selected)) select.value = selected;
    catalogue(); renderSourceOverview(); renderRevisionNotes(); renderLivingSignals();
    renderMissionControls();
    byId('exploreStatus').textContent = model
      ? 'Optional tools are ready. Original calculation rules and saved planning keys are unchanged.'
      : 'Planning tools are ready. Forecast-dependent instruments need a coherent published record.';
  }
  return {
    update,
    close(){
      for (const id of frames) window.cancelAnimationFrame(id);
      for (const id of timers) window.clearTimeout(id);
      frames.clear(); timers.clear();
    },
    reopen(){
      renderProbabilitySimulator(timelineData, fasterBranchRange(timelineData));
      renderPlanner(); renderMissionControls();
    },
  };
}
function openExplore(hash = ''){
  byId('exploreDisclosure').open = true;
  if (exploreMountFailed) return;
  if (!exploreSession) {
    try {
      exploreSession = initializeExplore();
      exploreSession.update();
      byId('exploreStatus').textContent = 'Optional tools are ready. Original calculation rules and saved planning keys are unchanged.';
    } catch (error) {
      exploreMountFailed = true;
      byId('exploreStatus').textContent = `The tools could not initialize: ${error.message}. Reload to retry. Existing saves have not been reset.`;
      throw error;
    }
  }
  if (!model) loadRecord();
  if (hash) {
    const target = byId(hash.replace(/^#/, ''));
    if (target) {
      for (let parent = target.parentElement; parent && parent !== byId('explore'); parent = parent.parentElement)
        if (parent.tagName === 'DETAILS') parent.open = true;
      if (!target.matches('input, select, button, a, summary')) target.tabIndex = -1;
      requestAnimationFrame(() => { target.scrollIntoView({ block:'start', behavior:'instant' }); target.focus({ preventScroll:true }); });
    }
  }
}
byId('exploreDisclosure').addEventListener('toggle', () => {
  if (byId('exploreDisclosure').open) {
    if (exploreSession) exploreSession.reopen(); else openExplore();
  } else exploreSession?.close();
});
function revealExploreHash(){
  const target = byId(location.hash.slice(1));
  if (target?.closest('#explore')) openExplore(location.hash);
}
addEventListener('hashchange', revealExploreHash);
addEventListener('pagehide', () => exploreSession?.close());

const domainNames = { individual:'Individual', social:'Social', technology:'Technology', economic:'Economic', geopolitical:'Geopolitical', governance:'Governance' };

const filterOptions = {
  domain:new Set(['all', ...Object.keys(domainNames)]),
  branch:new Set(['all','baseline','managed','default','ungoverned']),
  probability:new Set(['all','very-high','high','medium','low','unstated']),
  theme:new Set(['all','agents','work','robotics','compute','governance','bio','space']),
};

const themeDefinitions = {
  agents:/\b(agent|agents|agentic|agi|superintelligen|frontier model|ai r&d|expert capability|recursive self|continual-learning)\b/i,
  work:/\b(work|labor|labour|employment|jobs?|income|dividend|tax|econom|revenue|wealth|capital|gdp)\b/i,
  robotics:/\b(robot|robots|robotic|humanoid|physical tasks?|factory|manufactur|autonomous strategic weapons)\b/i,
  compute:/\b(compute|datacenter|data center|chip|semiconductor|energy|grid|power|inference|training run|cooling|radiator)\b/i,
  governance:/\b(govern|regulat|treaty|verification|audit|safety|alignment|control|inspection|policy|court|military|deception|sabotage|sandbox)\b/i,
  bio:/\b(bci|brain|neural|intracortical|connectom|bio|drug|disease|vaccine|pathogen|health|cure|longevity)\b/i,
  space:/\b(orbital|space|satellite|dyson|kardashev|transcension|ruliad|off-world|civilization)\b/i,
};

function initialForecastFilters(){
  const params = new URLSearchParams(location.search);
  const read = (key, values) => values.has(params.get(key)) ? params.get(key) : 'all';
  return {
    domain:read('fd', filterOptions.domain),
    branch:read('fb', filterOptions.branch),
    probability:read('fp', filterOptions.probability),
    theme:read('ft', filterOptions.theme),
    changed:params.get('fc') === '1',
    query:String(params.get('fq') || '').slice(0, 120),
  };
}

function eventThemes(event){
  const text = String(event && event.t || '');
  const themes = Object.entries(themeDefinitions)
    .filter(([, pattern]) => pattern.test(text))
    .map(([theme]) => theme);
  if (!themes.length && event?.d === 'governance') themes.push('governance');
  if (!themes.length && event?.d === 'economic') themes.push('work');
  if (!themes.length && event?.d === 'technology') themes.push('agents');
  return themes;
}

function probabilityBand(probability){
  if (!Number.isFinite(probability)) return 'unstated';
  if (probability >= 80) return 'very-high';
  if (probability >= 60) return 'high';
  if (probability >= 40) return 'medium';
  return 'low';
}

function branchForEvent(title){
  if (/^managed branch:/i.test(title)) return { key:'managed', label:'Managed branch' };
  if (/default branch:/i.test(title)) return { key:'default', label:'Default branch' };
  if (/\bungoverned\b/i.test(title)) return { key:'ungoverned', label:'Ungoverned branch' };
  return { key:'baseline', label:'Shared forecast' };
}
function matchesCatalogueFilters(event, filters){
  const terms = filters.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const themes = eventThemes(event), searchable = `${event.t} ${domainNames[event.d] || ''} ${themes.join(' ')}`.toLowerCase();
  return (filters.domain === 'all' || event.d === filters.domain)
    && (filters.branch === 'all' || branchForEvent(event.t).key === filters.branch)
    && (filters.probability === 'all' || probabilityBand(event.prob) === filters.probability)
    && (filters.theme === 'all' || themes.includes(filters.theme))
    && (!filters.changed || Boolean(event.revisedAt && event.revisedAt === String(forecastData?.updated || '').slice(0, 10)))
    && terms.every(term => searchable.includes(term));
}
function renderChapterSearch(query){
  const host = byId('atlasSearchResults');
  host.replaceChildren(); host.hidden = !query.trim();
  if (host.hidden) return;
  const terms = query.toLowerCase().trim().split(/\s+/);
  const found = chapters.map((chapter, index) => ({ chapter, index })).filter(({ chapter }) =>
    terms.every(term => `${chapter.title} ${chapter.body}`.toLowerCase().includes(term)));
  for (const { chapter, index } of found) host.append(action(`Read: ${chapter.title}`, () => window.openReader(index)));
  if (!found.length) host.append(node('p', 'mission-help', 'No chapter summaries match. Matching forecasts appear below.'));
}
function renderRevisionNotes(){
  if (!forecastData) { setText('forecastChangesSummary', 'The forecast revision is unavailable.'); return; }
  setText('forecastChangesSummary', `Published forecast revision: ${recorded(forecastData.updated)}. The full authored basis is retained below.`);
  const host = byId('forecastChangeLinks');
  host.replaceChildren();
  const details = node('details');
  details.append(node('summary', '', 'Read the authored revision basis'), node('p', '', forecastData.basis || 'No revision basis is recorded.'));
  host.append(details);
  const changes = forecastRecords().filter(row => row.data.revisedAt === String(forecastData.updated).slice(0, 10));
  setText('changedCount', changes.length);
  for (const row of changes) host.append(link(row.title, row.href), node('p', 'mission-help', row.data.changeNote));
}
function renderSourceOverview(){
  const host = byId('sourceOverview');
  host.replaceChildren();
  if (!model) { host.append(node('p', '', 'Source coverage is unavailable. No successful checks are inferred.')); return; }
  const data = model.bundle, refs = data.referencePoints?.coverage;
  host.append(node('p', '', `NEWS: ${Object.keys(data.embeds).length} cited forecast mappings, ${Object.keys(data.context.items).length} dated-context mappings and ${Object.keys(data.uncited.items).length} explicit gaps. The chronology deduplicates their articles.`));
  host.append(node('p', '', refs ? `Research references: ${refs.mapped} forecast mappings / ${refs.sources} canonical sources. Their health checks do not verify the NEWS layer.` : 'Research references are unavailable.'));
  host.append(node('p', '', 'METR is a scoped software-task instrument, not an AGI score. X is a separate discussion supplement, not evidence.'));
}
function renderLivingSignals(){
  const host = byId('signalsGrid');
  host.replaceChildren();
  if (!model) { setText('realityMeta', 'Published observations unavailable.'); return; }
  setText('realityMeta', `Snapshot ${recorded(model.bundle.updated)}. Collection ${recorded(model.bundle.sourceFetchedAt)}. Reporting dates and limitations remain distinct.`);
  for (const signal of model.bundle.reality) {
    const article = node('article', 'living-signal');
    article.append(node('h3', '', signal.t));
    if (signal.text || signal.note) article.append(node('p', '', signal.text || signal.note));
    else if (signal.kind !== 'news') article.append(node('p', '', 'No qualifying observation is recorded.'));
    if (signal.kind === 'news') {
      article.append(link(signal.headline || `Read at ${signal.publisher}`, engine.safeSourceUrl(signal.url), true));
      const date = engine.parsePublishedDate(signal.publishedAt || null);
      article.append(node('p', 'mission-help', `Published ${date.label}. ${engine.publicationAge(date)}. A reported source is not a whole-forecast verdict.`));
    }
    host.append(article);
  }
}


function dossierSection(title, description){
  const section = node('section', 'dossier-section');
  section.append(node('h5', '', title));
  if (description) section.append(node('p', 'dossier-note', description));
  return section;
}
function datedSourceLabel(value, period){
  return value ? recorded(value) : period ? recorded(period) : 'not recorded; publication date unknown';
}
function disclosure(title, build, id = ''){
  const details = node('details', 'dossier-disclosure');
  if (id) details.id = id;
  details.append(node('summary', '', title));
  details.addEventListener('toggle', () => {
    if (details.open && !details.dataset.rendered) {
      details.append(build()); details.dataset.rendered = 'true';
    } else if (!details.open && details.dataset.rendered) {
      while (details.children.length > 1) details.lastElementChild.remove();
      delete details.dataset.rendered;
    }
  });
  return details;
}
function reviewedNewsDossier(row){
  const data = model.bundle, record = data.embeds[row.id] || data.context.items[row.id];
  const section = dossierSection('NEWS', 'Reviewed reporting and dated context are not the same as confirmation of this forecast.');
  section.dataset.newsChannel = record ? (data.context.items[row.id] ? 'context' : 'cited') : 'uncited';
  section.dataset.newsForecast = row.id;
  if (!record) {
    const gap = data.uncited.items[row.id];
    section.append(node('p', '', gap?.statement || 'NEWS evidence is unavailable. No substitute has been inferred.'));
    if (gap) section.append(node('p', 'dossier-note', `Search recorded ${recorded(gap.searchedAt)}. Reason: ${gap.reason}.`));
    return section;
  }
  const article = model.articles.find(item => item.connections.some(connection => connection.id === row.id));
  const connection = article.connections.find(item => item.id === row.id);
  section.append(link(record.headline, engine.safeSourceUrl(record.url), true));
  section.append(node('p', 'dossier-note', `${connection.channel === 'context' ? 'Dated background' : 'Cited in this snapshot'} / ${typeLabels[connection.type]}. Published ${article.date.label}. ${engine.publicationAge(article.date)}.`));
  section.append(node('blockquote', '', record.quote || record.text));
  section.append(node('p', 'dossier-rationale', connection.rationale));
  section.append(renderProvenance(connection));
  section.append(link('Find this report in its publication-year chronology', `#${sourceId(article)}`));
  const currency = data.currency?.[row.id];
  if (Array.isArray(currency) && currency.length) {
    section.append(disclosure('Separately reviewed later references', () => {
      const host = node('div');
      for (const item of currency) {
        const reference = node('article', 'dossier-record');
        reference.append(link(item.headline || item.title || item.publisher, engine.safeSourceUrl(item.url), true));
        if (item.quote) reference.append(node('blockquote', '', item.quote));
        if (item.mappingRationale) reference.append(node('p', '', item.mappingRationale));
        reference.append(node('p', 'dossier-note', `Source quality: ${qualityLabel(item.sourceQuality)}. A later reference is not a whole-forecast verdict.`));
        reference.append(node('p', 'dossier-note', `Published ${datedSourceLabel(item.publishedAt || item.articleDate)}. Reviewed ${recorded(item.reviewedAt)}. Recorded verification ${recorded(item.lastVerifiedAt)}.`));
        host.append(reference);
      }
      return host;
    }, `currency-${row.id}`));
  }
  return section;
}
function referenceDossier(row){
  const layer = model.bundle.referencePoints, entries = layer?.items[row.id] || [];
  const section = dossierSection('Research and real-world references', 'These reviewed references concern specific facets. Their source checks do not verify NEWS articles or resolve the whole forecast.');
  if (!entries.length) {
    section.append(node('p', '', layer?.gaps[row.id] || 'Reviewed reference points are unavailable.'));
    return section;
  }
  const page = node('div');
  let offset = 0;
  function render(){
    page.replaceChildren();
    for (const entry of entries.slice(offset, offset + 6)) {
      const source = layer.sources[entry.sourceId], health = source.health;
      const stale = !health.lastCheckedAt || Date.now() - Date.parse(health.lastCheckedAt) > 7 * 86400000;
      const item = node('article', 'dossier-record');
      item.dataset.referenceDetail = row.id;
      item.append(node('p', 'dossier-note', `Limited-facet relationship: ${entry.relation} / ${entry.direction.replaceAll('-', ' ')}.`));
      item.append(node('h6', '', entry.facet), node('p', '', entry.why));
      const limits = node('p');
      limits.append(node('strong', '', 'Does not establish: '), document.createTextNode(entry.doesNotEstablish));
      item.append(limits);
      if (stale || health.status !== 'verified') item.append(node('p', 'dossier-warning',
        `Last-good reviewed reference retained. ${health.error || (stale ? 'Source check is over seven days old.' : `Recorded health: ${health.status}.`)} Availability does not determine forecast direction.`));
      item.append(disclosure(`Source, excerpt and review record: ${source.organization}`, () => {
        const body = node('div');
        body.append(link(source.title, engine.safeSourceUrl(source.url), true), node('blockquote', '', entry.excerpt));
        if (entry.metric) {
          const metric = entry.metric;
          body.append(node('p', '', `Reported value: ${metric.operator || ''}${metric.value}${metric.high == null ? '' : `–${metric.high}`} ${metric.unit}. Coverage: ${metric.coverage}`));
          body.append(node('p', 'dossier-note', `Metric evidence: ${metric.evidence}`));
        }
        const uses = Object.values(layer.items).flat().filter(value => value.sourceId === entry.sourceId).length;
        body.append(node('p', 'dossier-note', `Publication: ${datedSourceLabel(source.publishedAt, source.publishedPeriod)}. Source quality: ${source.quality}. Mapping reviewed ${recorded(entry.reviewedAt)} by ${entry.reviewedBy || 'reviewer not recorded'}.`));
        body.append(node('p', 'dossier-note', `Source retrieved ${recorded(source.retrievedAt)}. Excerpt last verified ${recorded(health.lastVerifiedAt)}. Source last checked ${recorded(health.lastCheckedAt)}. Recorded health: ${health.status}.`));
        body.append(node('p', 'dossier-note', `Used by ${uses} forecast mappings; reuse is not independent corroboration. Research checks are separate from NEWS verification.`));
        if (source.pdfPages?.length) body.append(node('p', 'dossier-note', `PDF pages checked: ${source.pdfPages.join(', ')}.`));
        const provenance = source.dateEvidenceUrl || source.revisionIndex?.url;
        if (provenance) body.append(link('Publication-date provenance / revision index', engine.safeSourceUrl(provenance), true));
        body.append(node('p', 'dossier-note', `Review SHA-256: ${source.reviewSha256}. Recorded excerpt SHA-256: ${health.textSha256 || 'not recorded'}.`));
        return body;
      }, `reference-${row.id}-${entry.sourceId}`));
      page.append(item);
    }
    if (entries.length > 6) {
      const controls = node('nav', 'more-stories');
      controls.setAttribute('aria-label', 'Reviewed reference pages');
      const previous = action('Previous references', () => { offset -= 6; render(); page.querySelector('summary').focus(); });
      const next = action('Next references', () => { offset += 6; render(); page.querySelector('summary').focus(); });
      previous.disabled = offset === 0; next.disabled = offset + 6 >= entries.length;
      controls.append(previous, node('span', '', `${offset + 1}–${Math.min(offset + 6, entries.length)} of ${entries.length}`), next);
      page.append(controls);
    }
  }
  render(); section.append(page); return section;
}
function measuredAssessmentDossier(row){
  const assessment = trajectoryFor(row.id);
  const section = dossierSection(assessment.label, assessment.detail);
  for (const record of assessment.records) {
    const item = node('article', 'dossier-record');
    item.append(node('h6', '', `${record.direction}: ${record.criterion.description}`));
    item.append(node('p', '', `${record.measurement.value} ${record.measurement.unit}. Observed ${recorded(record.measurement.observedAt)}.`));
    item.append(node('p', '', record.rationale), node('p', '', `Limitations: ${record.limitations}`));
    item.append(link(record.source.name, engine.safeSourceUrl(record.source.url), true));
    item.append(node('p', 'dossier-note', `Source published ${recorded(record.source.publishedAt)}, fetched ${recorded(record.source.fetchedAt)}; reviewed ${recorded(record.reviewedAt)} by ${record.reviewedBy}.`));
    section.append(item);
  }
  return section;
}
function metrDossier(row){
  const data = model.bundle.capabilities?.metr;
  const section = dossierSection('METR / scoped capability instrument', 'Human-expert software-task duration at a specified success rate is not agent runtime, all-job automation or an AGI score.');
  if (data?.context?.id !== row.id || data.context.forecastSha256 !== model.fingerprint) {
    section.append(node('p', '', 'This instrument is not bound as context to this forecast. No numeric claim is transferred from another forecast.'));
  } else {
    section.append(node('p', '', data.context.role));
    const record = data.current?.records?.[0];
    if (record) {
      section.append(node('p', '', `Model record: ${record.id}. Released ${recorded(record.releaseDate)}.`));
      for (const [key, label] of [['p50','50% task success'],['p80','80% task success']]) {
        const metric = record[key];
        section.append(node('p', '', `${label}: ${metric.estimate.toFixed(2)} human-expert minutes (95% interval ${metric.ci_low.toFixed(2)}–${metric.ci_high.toFixed(2)}).`));
      }
    } else section.append(node('p', '', 'No validated measurement record is available.'));
    const stale = !data.lastCheckedAt || Date.now() - Date.parse(data.lastCheckedAt) > 36 * 3600000;
    section.append(node('p', 'dossier-note', `${data.status !== 'ok' ? `${data.error || 'Collection unavailable.'} Last-good measurements, if present, are retained. ` : ''}${stale ? 'The source check is stale. ' : ''}Checked ${recorded(data.lastCheckedAt)}; last successful collection ${recorded(data.lastSuccessfulFetchAt)}.`));
    section.append(node('p', 'dossier-note', 'Evaluation/publication dates are not supplied by this dataset. Neither the model release date nor HTTP modification time substitutes for them. Estimates above 960 human-expert minutes are unreliable with the current task suite.'));
  }
  const instrument = link('Inspect model selection, intervals and dataset provenance in Explore', '#metrInstrument');
  section.append(instrument); return section;
}
function discussionDossier(row){
  const layer = model.bundle.xSignals, item = layer?.items?.[row.id];
  const section = dossierSection('X / discussion supplement', 'Posts, quotes and reposts are discussion, not NEWS evidence, research verification or forecast success.');
  if (!item) {
    section.append(node('p', '', layer ? 'No matched discussion item is recorded for this forecast in the loaded supplement.' : 'No discussion supplement is available.'));
    return section;
  }
  let url, date;
  try {
    if (!['tracked','nearest'].includes(item.tier) || !['authored','reposted'].includes(item.authorship)
      || typeof item.text !== 'string') throw new Error('Invalid discussion record.');
    url = new URL(item.url);
    if (url.protocol !== 'https:' || url.username || url.password || !/(^|\.)(x|twitter)\.com$/i.test(url.hostname)) throw new Error('Invalid X link.');
    date = engine.parsePublishedDate(item.created || null);
  } catch {
    section.append(node('p', 'dossier-warning', 'The published discussion record is invalid. No link or evidence claim has been substituted.'));
    return section;
  }
  const authored = item.authorship === 'authored';
  section.append(node('p', '', `${authored ? '@peterxing authored this' : `@peterxing reposted @${item.author || 'author not recorded'}`}. ${item.tier === 'tracked' ? 'Recorded as tracked discussion' : 'Nearest topical activity only, not tracking of the forecast'}.`));
  section.append(node('blockquote', '', item.text));
  if (item.statement) section.append(node('p', '', item.statement));
  section.append(node('p', 'dossier-note', `Post created ${date.label}. ${engine.publicationAge(date)}. Supplement collected ${recorded(layer.summary?.harvestedAt)}; assembled ${recorded(layer.summary?.builtAt)}. This may not include later activity.`));
  section.append(link('View the original discussion on X', url.href, true));
  return section;
}
function renderSourceDossier(row){
  const host = node('div', 'forecast-source-dossier');
  host.dataset.forecastDossier = row.id;
  if (!model) { host.append(node('p', '', 'The coherent source record is unavailable. No evidence is inferred.')); return host; }
  host.append(node('p', 'dossier-note', `Source snapshot ${recorded(model.bundle.updated)}. Collection ${recorded(model.bundle.sourceFetchedAt)}. Each layer retains its own publication, review and source-check dates.`));
  host.append(reviewedNewsDossier(row), referenceDossier(row), measuredAssessmentDossier(row), metrDossier(row), discussionDossier(row));
  return host;
}
function forecastDossierControl(row, prefix = 'forecast'){
  const details = disclosure('Sources, context & limitations', () => renderSourceDossier(row), `${prefix}-sources-${row.id}`);
  details.classList.add('source-inspection', 'forecast-dossier');
  details.name = 'reader-source-dossiers';
  details.addEventListener('toggle', () => {
    if (!details.open) return;
    for (const other of document.querySelectorAll('.forecast-dossier[open]')) if (other !== details) other.open = false;
    recordComparison(row.id);
  });
  return details;
}
let observationRenderedModel = null;
let observationRenderedId = '';
function renderObservationDetail(){
  const id = byId('observationPrediction').value;
  const row = forecastRecords().find(item => item.id === id), host = byId('observationDetail');
  if (!row) {
    observationRenderedModel = null;
    observationRenderedId = '';
    host.replaceChildren(node('p', 'mission-help', model
      ? 'Choose a forecast to inspect its estimate, sources and unanswered questions.'
      : 'Forecast sources are unavailable. Saved records are retained.'));
    return;
  }
  if (observationRenderedModel === model && observationRenderedId === id) return;
  const heading = node('div', 'observation-forecast');
  heading.append(node('p', 'instrument-label', 'Authored forecast / unchanged'), node('h4', '', row.title),
    node('p', '', `${row.probability} / ${row.timing}`));
  const actions = node('div', 'observation-actions');
  actions.append(link('Read this forecast in the timeline', row.href), watchControl(row.id));
  heading.append(actions);
  host.replaceChildren(heading, forecastDossierControl(row, 'desk'));
  observationRenderedModel = model;
  observationRenderedId = id;
}

/* END RESTORED EXPLORE */

loadAuthor();
revealHash();
revealExploreHash();
