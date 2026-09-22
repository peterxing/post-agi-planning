const PAGE_SIZE = 12;
const CONNECTION_PAGE_SIZE = 6;
const TYPES = {
  direct: 'Reporting / observation',
  'leading-indicator': 'Partial leading indicator',
  scenario: 'Scenario reporting',
};
const dateFormat = new Intl.DateTimeFormat('en-GB', { day:'numeric', month:'short', year:'numeric', timeZone:'UTC' });
const monthFormat = new Intl.DateTimeFormat('en-GB', { month:'long', year:'numeric', timeZone:'UTC' });
const timeFormat = new Intl.DateTimeFormat('en-GB', { hour:'2-digit', minute:'2-digit', hourCycle:'h23', timeZone:'UTC' });
const instances = new WeakMap();
let stylesheet;

function invalid(message){
  throw new Error(`NEWS integrity: ${message}`);
}
function object(value){
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function required(value, name){
  if (typeof value !== 'string' || !value.trim() || value.length > 24000) invalid(`invalid ${name}.`);
  return value;
}
export function safeSourceUrl(value){
  if (typeof value !== 'string' || value.length > 4096 || /[\s\\\u0000-\u001f\u007f]/.test(value)) invalid('unsafe source URL.');
  let url;
  try { url = new URL(value); } catch { invalid('invalid source URL.'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password
    || /(^|\.)(x|twitter)\.com$/i.test(url.hostname)) invalid('source must be an HTTPS NEWS article, not an X post.');
  return url.href;
}
function urlIdentity(value){
  const url = new URL(safeSourceUrl(value));
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.href;
}
function host(value){
  return String(value).toLowerCase().replace(/^www\./, '');
}
export function parsePublishedDate(value){
  if (value == null) return { precision:'unknown', year:null, month:null, day:null, at:null, value:null, label:'Publication date not recorded', group:'Undated' };
  if (typeof value !== 'string') invalid('invalid publication date.');
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2}))?)?)?$/.exec(value);
  if (!match) invalid(`ambiguous or invalid publication date: ${value}.`);
  let year = Number(match[1]), month = match[2] ? Number(match[2]) : null, day = match[3] ? Number(match[3]) : null;
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1000 || month !== null && (month < 1 || month > 12)
    || day !== null && (day < 1 || day > days[month - 1])) invalid(`invalid calendar date: ${value}.`);
  let at = null, precision = day ? 'day' : month ? 'month' : 'year';
  if (match[4] !== undefined) {
    if (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) invalid(`invalid publication time: ${value}.`);
    at = Date.parse(value);
    if (!Number.isFinite(at)) invalid(`invalid publication offset: ${value}.`);
    const utc = new Date(at);
    year = utc.getUTCFullYear(); month = utc.getUTCMonth() + 1; day = utc.getUTCDate();
    precision = 'instant';
  }
  const calendar = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  const label = precision === 'instant' ? `${dateFormat.format(at)}, ${timeFormat.format(at)} UTC`
    : precision === 'day' ? `${dateFormat.format(calendar)} (date only)`
      : precision === 'month' ? `${monthFormat.format(calendar)} (month only)` : `${year} (year only)`;
  return { precision, year, month, day, at, value, label,
    group:month ? monthFormat.format(calendar) : `${year} / month not recorded` };
}
function compatibleDates(a, b){
  return ['year','month','day'].every(k => a[k] == null || b[k] == null || a[k] === b[k])
    && (a.at == null || b.at == null || a.at === b.at);
}
function mergeDates(a, b){
  if (!compatibleDates(a, b)) invalid('conflicting publication dates for one article.');
  const rank = ['unknown','year','month','day','instant'];
  return rank.indexOf(a.precision) >= rank.indexOf(b.precision) ? a : b;
}
function publication(record){
  return [record.provenance?.publishedAt, record.publishedAt, record.articleDate, record.publishedPeriod]
    .filter(value => value != null).map(parsePublishedDate).reduce(mergeDates, parsePublishedDate(null));
}
function recorded(value){
  return value == null ? 'not recorded' : parsePublishedDate(value).label;
}
function stamp(value, name){
  const date = parsePublishedDate(value);
  if (date.at === null) invalid(`${name} must include a recorded timezone.`);
  return date.at;
}
export function compareArticles(a, b, order = 'newest'){
  if (!['newest','oldest'].includes(order)) invalid('invalid chronological order.');
  const direction = order === 'oldest' ? 1 : -1;
  // Partial dates occupy labelled buckets; no invented day-one publication timestamps.
  for (const part of ['year','month','day','at']) {
    const left = a.date[part], right = b.date[part];
    if (left == null && right != null) return 1;
    if (right == null && left != null) return -1;
    if (left !== right) return (left - right) * direction;
  }
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}
export function projectNews(records, bundle, fingerprint){
  if (!Array.isArray(records) || !records.length || records.length > 2000 || !object(bundle)
    || !/^[a-f0-9]{64}$/.test(fingerprint) || bundle.forecastVersion?.schemaVersion !== 1
    || bundle.forecastVersion.sha256 !== fingerprint) invalid('forecast and NEWS versions do not match.');
  const updated = stamp(bundle.updated, 'Snapshot publication');
  const fetched = stamp(bundle.sourceFetchedAt, 'Source collection');
  const rows = new Map();
  for (const row of records) {
    if (!object(row) || !/^(?:\d{4}-\d+|horizon-[a-z0-9-]+)$/.test(row.id) || rows.has(row.id)) invalid('invalid or duplicated forecast ID.');
    required(row.title, 'forecast text');
    required(row.timing, 'forecast timing');
    required(row.data?.d, 'forecast domain');
    if (row.href !== (row.id.startsWith('horizon-') ? `#${row.id}` : `#event-${row.id}`)) invalid(`invalid forecast target ${row.id}.`);
    rows.set(row.id, row);
  }
  const channels = [['cited', bundle.embeds], ['context', bundle.context?.items], ['uncited', bundle.uncited?.items]];
  if (channels.some(([, items]) => !object(items))) invalid('missing NEWS coverage channel.');
  const seen = new Set(), articles = new Map(), identities = new Map();
  for (const [channel, items] of channels) {
    for (const [id, record] of Object.entries(items)) {
      if (!rows.has(id) || seen.has(id)) invalid(`orphan or duplicated forecast binding ${id}.`);
      seen.add(id);
      if (channel === 'uncited') continue;
      const row = rows.get(id), p = record?.provenance;
      if (!object(record) || record.kind !== 'news' || record.evidenceOwner !== 'news'
        || record.evidenceMedium !== 'news' || record.reviewed !== true || record.matchMethod !== 'reviewed-news'
        || !Object.hasOwn(TYPES, record.evidenceType) || !object(p) || p.evidenceOwner !== 'news'
        || !/^[a-f0-9]{64}$/.test(p.textSha256)) invalid(`unreviewed or non-NEWS record for ${id}.`);
      if (record.maps !== row.title) invalid(`forecast text mismatch for ${id}.`);
      const url = safeSourceUrl(record.url);
      const key = record.sourceKey ? urlIdentity(record.sourceKey) : urlIdentity(url);
      const identity = urlIdentity(url);
      if (identities.has(identity) && identities.get(identity) !== key) invalid('conflicting identities for one article URL.');
      identities.set(identity, key);
      const title = required(record.headline, 'headline'), publisher = required(record.publisher, 'publisher');
      const quality = required(record.sourceQuality, 'NEWS source quality');
      required(record.mappingRationale, 'reviewed mapping rationale');
      const publisherHost = host(required(p.publisherHost, 'publisher host')), sourceHost = host(new URL(url).hostname);
      if (p.publisher !== publisher || p.sourceQuality !== quality
        || sourceHost !== publisherHost && !sourceHost.endsWith(`.${publisherHost}`)
        || host(record.publisherHost) !== host(p.publisherHost)
        || record.byline != null && p.byline != null && record.byline !== p.byline) invalid(`conflicting NEWS provenance for ${id}.`);
      for (const value of [record.reviewedAt, record.lastVerifiedAt, p.lastVerifiedAt, p.retrievedAt,
        record.health?.lastCheckedAt, record.health?.lastVerifiedAt]) if (value != null) parsePublishedDate(value);
      const date = publication(record), existing = articles.get(key);
      if (existing && (urlIdentity(existing.url) !== urlIdentity(url) || existing.title !== title
        || existing.publisher !== publisher || existing.quality !== quality))
        invalid(`conflicting source identity or provenance for ${publisher}.`);
      const article = existing || { key, url, title, publisher, quality, date, connections:[] };
      article.date = mergeDates(article.date, date);
      article.connections.push({ id, forecast:row, channel, type:record.evidenceType,
        rationale:record.mappingRationale, quality, textSha256:p.textSha256, reviewedAt:record.reviewedAt,
        verifiedAt:record.lastVerifiedAt || p.lastVerifiedAt, retrievedAt:p.retrievedAt, health:record.health || null });
      articles.set(key, article);
    }
  }
  if (seen.size !== rows.size || bundle.coverage?.total !== rows.size
    || bundle.coverage.cited !== Object.keys(bundle.embeds).length
    || bundle.context.count !== Object.keys(bundle.context.items).length
    || bundle.uncited.count !== Object.keys(bundle.uncited.items).length) invalid('incomplete NEWS coverage accounting.');
  const items = [...articles.values()];
  for (const article of items) {
    article.connections.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric:true }));
    article.search = [article.title, article.publisher, ...article.connections.map(c => c.forecast.title)].join('\n').normalize('NFKC').toLowerCase();
  }
  return { articles:items, records:[...rows.values()], updated, fetched, fingerprint, bundle,
    connections:items.reduce((sum, article) => sum + article.connections.length, 0) };
}
export function selectArticles(articles, filters){
  const query = (filters.query || '').normalize('NFKC').toLowerCase().trim();
  return articles.filter(article => (!query || article.search.includes(query))
    && (!filters.domain || article.connections.some(c => c.forecast.data.d === filters.domain))
    && (!filters.forecast || article.connections.some(c => c.id === filters.forecast)))
    .sort((a, b) => compareArticles(a, b, filters.order));
}
function make(tag, className, text){
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function button(text, action, className = 'nt-button btn btn-ghost'){
  const node = make('button', className, text);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
function link(text, href, external = false){
  const node = make('a', '', text);
  node.href = href;
  if (external) { node.target = '_blank'; node.rel = 'noopener noreferrer'; }
  return node;
}
function label(value){
  return value.replace(/-/g, ' ').replace(/^\w/, char => char.toUpperCase());
}
export function publicationAge(date, now = Date.now()){
  if (date.at === null) return 'Exact publication age not recorded';
  const days = Math.floor((now - date.at) / 86400000);
  return days < 0 ? 'Publication date is in the future'
    : days === 0 ? 'Published in the last 24 hours' : `${days.toLocaleString('en')} day${days === 1 ? '' : 's'} ago`;
}
export function publicationRange(articles){
  const dated = articles.filter(a => a.date.year).sort((a, b) => compareArticles(a, b, 'oldest'));
  const depth = dated.some(a => !a.date.month) ? 1 : dated.some(a => !a.date.day) ? 2 : 3;
  const part = ({ date }) => [date.year, date.month, date.day].slice(0, depth).map(n => String(n).padStart(2, '0')).join('-');
  return dated.length ? `${part(dated[0])} to ${part(dated.at(-1))}` : 'No recorded publication range';
}
function loadStyles(){
  if (!stylesheet) stylesheet = new Promise((resolve, reject) => {
    const sheet = make('link');
    sheet.rel = 'stylesheet';
    sheet.href = new URL('./news-timeline.css', import.meta.url).href;
    const timeout = setTimeout(() => finish(new Error('News timeline stylesheet timed out.')), 8000);
    function finish(error){
      clearTimeout(timeout);
      sheet.onload = sheet.onerror = null;
      if (error) { sheet.remove(); stylesheet = null; reject(error); } else resolve();
    }
    sheet.onload = () => finish();
    sheet.onerror = () => finish(new Error('News timeline stylesheet unavailable.'));
    document.head.append(sheet);
  });
  return stylesheet;
}
export function mount(panel, read){
  if (!instances.has(panel)) {
    const ready = loadStyles().then(() => createView(panel, read)).catch(error => {
      instances.delete(panel);
      throw error;
    });
    instances.set(panel, ready);
  }
  return instances.get(panel);
}
function createView(panel, read){
  const status = panel.querySelector('p');
  status.id = 'newsStatus';
  status.className = 'nt-status';
  const view = make('div', 'nt-view');
  const intro = make('p', 'nt-intro', 'Reviewed NEWS and dated context in this published snapshot. Curated, not exhaustive; reporting is not forecast confirmation.');
  const totals = make('p', 'nt-totals');
  const dates = make('p', 'nt-dates');
  const updates = make('p', 'nt-updates');
  const reviewUpdate = link('Review pending updates at the observation desk', '#applyObservations');
  updates.append(reviewUpdate);
  const form = make('form', 'nt-controls');
  form.setAttribute('role', 'search');
  form.setAttribute('aria-label', 'Search and filter reviewed news');
  form.addEventListener('submit', event => event.preventDefault());
  const fields = make('fieldset');
  const legend = make('legend', 'nt-sr-only', 'Find an article or forecast');
  fields.append(legend);
  const filters = { query:'', domain:'', forecast:'', order:'newest' };
  let model = null, raw = null, page = 0, selected = null, connectionPage = 0, projectionError = '';
  let rootError = '', rootPending = false;
  function field(caption, name, input){
    const wrapper = make('label', `nt-field nt-field-${name}`);
    input.id = `news-${name}`;
    input.dataset.newsFocus = name;
    wrapper.htmlFor = input.id;
    wrapper.append(make('span', '', caption), input);
    fields.append(wrapper);
    return input;
  }
  const query = field('Search news, publishers or forecasts', 'query', make('input'));
  query.type = 'search'; query.maxLength = 200; query.autocomplete = 'off';
  query.placeholder = 'For example: robotics, governance, energy';
  const domain = field('Forecast domain', 'domain', make('select'));
  const order = field('Publication order', 'order', make('select'));
  const forecast = field('Connected forecast', 'forecast', make('select'));
  for (const [value, text] of [['newest','Newest first'],['oldest','Oldest first']]) order.add(new Option(text, value));
  const reset = button('Reset filters', () => {
    Object.assign(filters, { query:'', domain:'', forecast:'', order:'newest' });
    query.value = domain.value = forecast.value = '';
    order.value = 'newest'; page = 0; selected = null;
    renderList(); query.focus({ preventScroll:true });
  });
  fields.append(reset); form.append(fields);
  const results = make('p', 'nt-results');
  results.id = 'newsResults'; results.tabIndex = -1;
  results.setAttribute('role', 'status');
  results.setAttribute('aria-live', 'polite');
  const list = make('div', 'nt-list');
  const pager = make('nav', 'nt-pager');
  pager.setAttribute('aria-label', 'News article pages');
  const previous = button('Previous articles', () => changePage(-1));
  const next = button('Next articles', () => changePage(1));
  const pageLabel = make('span', 'nt-page-label');
  pager.append(previous, pageLabel, next);
  view.append(intro, totals, dates, updates, form, results, list, pager);
  panel.append(view);
  for (const [name, input, event] of [['query',query,'input'],['domain',domain,'change'],['forecast',forecast,'change'],['order',order,'change']]) {
    input.addEventListener(event, () => {
      filters[name] = input.value;
      page = 0; selected = null; connectionPage = 0;
      renderList();
    });
  }
  function options(select, values, text){
    const value = select.value;
    select.replaceChildren(new Option(text, ''), ...values.map(([key, caption]) => new Option(caption, key)));
    select.value = value;
  }
  function capture(){
    const active = document.activeElement;
    const anchor = [...list.querySelectorAll('[data-news-article]')].find(node => {
      const bounds = node.getBoundingClientRect();
      return bounds.bottom > 80 && bounds.top < innerHeight;
    });
    return { focus:panel.contains(active) ? active.dataset.newsFocus : null,
      key:anchor?.dataset.newsArticle, top:anchor?.getBoundingClientRect().top };
  }
  function restore(position){
    if (position.focus) ([...panel.querySelectorAll('[data-news-focus]')]
      .find(node => node.dataset.newsFocus === position.focus && !node.disabled) || results).focus({ preventScroll:true });
    if (position.key && panel.open) {
      const anchor = [...list.querySelectorAll('[data-news-article]')].find(node => node.dataset.newsArticle === position.key);
      if (anchor) scrollBy({ top:anchor.getBoundingClientRect().top - position.top, behavior:'instant' });
    }
  }
  function changePage(delta){
    page += delta; selected = null; connectionPage = 0;
    renderList(); results.focus({ preventScroll:true });
    results.scrollIntoView({ block:'start', behavior:'instant' });
  }
  function renderHealth(){
    const retained = model ? `Last good NEWS view retained (${dateFormat.format(model.updated)} snapshot).` : 'No coherent NEWS snapshot is available.';
    const error = projectionError || rootError;
    status.textContent = error ? `${retained} ${error}`
      : model ? `${Date.now() - Math.min(model.updated, model.fetched) > 36 * 3600000 ? 'Stale published snapshot. ' : ''}Reviewed NEWS snapshot, not a live feed.`
        : 'No coherent NEWS snapshot yet. Check updates at the observation desk.';
    status.dataset.state = error ? 'error' : 'info';
    updates.hidden = !rootPending;
    fields.disabled = !model;
    if (model) {
      totals.textContent = `${model.articles.length} articles / ${model.connections} forecast connections / ${model.records.length} loaded forecasts.`;
      dates.textContent = `Known-date range: ${publicationRange(model.articles)}. Snapshot: ${recorded(model.bundle.updated)}. Collected: ${recorded(model.bundle.sourceFetchedAt)}. Recorded checks are not live.`;
    } else { totals.textContent = 'Article counts unavailable'; dates.textContent = ''; }
  }
  function renderConnection(connection){
    const item = make('article', 'nt-mapping');
    const kind = connection.channel === 'context' ? 'Dated context' : 'Cited in this snapshot (not a freshness claim)';
    item.append(make('p', 'nt-kind', `${kind} / ${TYPES[connection.type]}`));
    const heading = make('h5');
    const target = link(connection.forecast.title, connection.forecast.href);
    target.dataset.newsFocus = `forecast-${connection.id}`;
    target.addEventListener('click', () => {
      if (location.hash === connection.forecast.href) dispatchEvent(new HashChangeEvent('hashchange'));
    });
    heading.append(target);
    item.append(heading, make('p', 'nt-timing', `${connection.forecast.timing} / ${label(connection.forecast.data.d)} / ${connection.forecast.probability}`));
    const rationale = make('p', 'nt-rationale');
    rationale.append(make('strong', '', 'Reviewed relevance and limits: '), document.createTextNode(connection.rationale));
    item.append(rationale);
    item.append(make('p', 'nt-provenance', `NEWS source quality: ${label(connection.quality)}. Mapping reviewed: ${recorded(connection.reviewedAt)}. Recorded source verification: ${recorded(connection.verifiedAt)}. Retrieved: ${recorded(connection.retrievedAt)}. Source text SHA-256: ${connection.textSha256}.`));
    const health = connection.health;
    item.append(make('p', 'nt-provenance', health
      ? `NEWS source health: ${health.status || 'not recorded'}. Last check: ${recorded(health.lastCheckedAt)}. Last verified: ${recorded(health.lastVerifiedAt)}.`
      : 'NEWS health: not recorded. Reference-point checks are a separate layer.'));
    const inspect = button('Inspect at the observation desk', () => {});
    inspect.dataset.inspect = connection.id;
    inspect.dataset.newsFocus = `inspect-${connection.id}`;
    item.append(inspect);
    return item;
  }
  function renderConnections(article){
    const detail = make('div', 'nt-connections');
    detail.id = `news-connections-${encodeURIComponent(article.key)}`;
    if (selected !== article.key) { detail.hidden = true; return detail; }
    const max = Math.max(1, Math.ceil(article.connections.length / CONNECTION_PAGE_SIZE));
    connectionPage = Math.min(connectionPage, max - 1);
    detail.append(make('p', 'nt-detail-note', 'All reviewed connections are retained, including those outside your filter. No probabilities are changed.'));
    for (const connection of article.connections.slice(connectionPage * CONNECTION_PAGE_SIZE, (connectionPage + 1) * CONNECTION_PAGE_SIZE)) detail.append(renderConnection(connection));
    if (max > 1) {
      const controls = make('nav', 'nt-pager');
      controls.setAttribute('aria-label', 'Article forecast connections');
      const back = button('Previous connections', () => changeConnections(-1));
      const forward = button('Next connections', () => changeConnections(1));
      back.dataset.newsFocus = 'connections-back'; forward.dataset.newsFocus = 'connections-next';
      back.disabled = connectionPage === 0; forward.disabled = connectionPage + 1 === max;
      controls.append(back, make('span', '', `${connectionPage + 1} / ${max}`), forward);
      detail.append(controls);
    }
    return detail;
  }
  function changeConnections(delta){
    connectionPage += delta; renderList();
    const first = list.querySelector('.nt-mapping h5 a');
    first.focus();
    first.scrollIntoView({ block:'nearest', behavior:'instant' });
  }
  function renderArticle(article){
    const item = make('li', 'nt-event');
    item.dataset.newsArticle = article.key;
    const grid = make('div', 'nt-event-grid');
    const meta = make('div', 'nt-meta');
    const date = make(article.date.value ? 'time' : 'span', 'nt-publication mono', article.date.label);
    if (article.date.value) date.dateTime = article.date.value;
    meta.append(date, make('span', 'nt-age', publicationAge(article.date)));
    const body = make('div', 'nt-story');
    body.append(make('p', 'nt-publisher', article.publisher));
    const heading = make('h4', 'nt-headline');
    const source = link(article.title, article.url, true);
    source.dataset.newsFocus = `source-${article.key}`;
    heading.append(source);
    const context = article.connections.every(c => c.channel === 'context');
    const cited = article.connections.every(c => c.channel === 'cited');
    const category = context ? 'Dated context' : cited ? 'Cited in this snapshot' : 'Cited and context connections';
    const toggle = button(`${selected === article.key ? 'Hide' : 'Explore'} ${article.connections.length} forecast connection${article.connections.length === 1 ? '' : 's'}`, () => {
      const position = capture();
      selected = selected === article.key ? null : article.key;
      const match = article.connections.findIndex(c => c.id === filters.forecast);
      connectionPage = match < 0 ? 0 : Math.floor(match / CONNECTION_PAGE_SIZE);
      renderList(); restore(position);
    });
    toggle.dataset.newsFocus = `toggle-${article.key}`;
    toggle.setAttribute('aria-expanded', String(selected === article.key));
    toggle.setAttribute('aria-controls', `news-connections-${encodeURIComponent(article.key)}`);
    body.append(heading, make('p', 'nt-category', `${category} / Original article opens in a new tab`), toggle);
    grid.append(meta, body); item.append(grid, renderConnections(article));
    return item;
  }
  function renderList(){
    if (!model) { results.textContent = 'No article results can be shown until a valid snapshot is available.'; pager.hidden = true; return; }
    const position = capture();
    const articles = selectArticles(model.articles, filters), pages = Math.max(1, Math.ceil(articles.length / PAGE_SIZE));
    page = Math.max(0, Math.min(page, pages - 1));
    const visible = articles.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const fragment = document.createDocumentFragment();
    let group = null, items;
    for (const article of visible) {
      if (article.date.group !== group) {
        group = article.date.group;
        const section = make('section', 'nt-month');
        const heading = make('h3', 'mono', group);
        items = make('ol', 'nt-events');
        section.append(heading, items); fragment.append(section);
      }
      items.append(renderArticle(article));
    }
    if (!articles.length) fragment.append(make('p', 'nt-empty', model.articles.length
      ? 'No articles match these filters. Reset filters to see the currently reviewed NEWS history.'
      : 'This valid snapshot contains no reviewed NEWS articles. Uncited forecasts are not turned into events.'));
    list.replaceChildren(fragment);
    results.textContent = `${articles.length} of ${model.articles.length} articles. ${filters.order === 'oldest' ? 'Oldest' : 'Newest'} publication first. ${articles.length ? `Showing ${page * PAGE_SIZE + 1}-${page * PAGE_SIZE + visible.length}.` : ''}`;
    pageLabel.textContent = `Page ${page + 1} of ${pages}`;
    previous.disabled = page === 0; next.disabled = page + 1 >= pages;
    pager.hidden = articles.length <= PAGE_SIZE;
    restore(position);
  }
  function refresh(){
    const position = capture();
    const [records, data, error, pending, fingerprint] = read();
    rootError = typeof error === 'string' ? error : '';
    rootPending = Boolean(pending);
    if (data && data !== raw) {
      try {
        const candidate = projectNews(records, data, fingerprint);
        if (model && (candidate.updated < model.updated || candidate.fetched < model.fetched)) invalid('older snapshot returned.');
        model = candidate; raw = data; projectionError = '';
        options(domain, [...new Set(records.map(row => row.data.d))].sort().map(d => [d, label(d)]), 'All domains');
        options(forecast, records.map(row => [row.id, `${row.timing} / ${row.title}`]), 'All forecasts');
        const filtered = selectArticles(model.articles, filters);
        const anchorIndex = filtered.findIndex(article => article.key === position.key);
        if (anchorIndex >= 0) page = Math.floor(anchorIndex / PAGE_SIZE);
        if (selected && !model.articles.some(article => article.key === selected)) selected = null;
        renderList();
      } catch (failure) {
        projectionError = failure.message;
      }
    }
    renderHealth();
    if (!model) renderList();
    restore(position);
    panel.dataset.newsReady = 'true';
  }
  addEventListener('newsupdate', refresh);
  panel.addEventListener('toggle', () => { if (panel.open) refresh(); });
  refresh();
}
