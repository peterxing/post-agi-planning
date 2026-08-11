/* ---------- Theme toggle ---------- */
const root = document.documentElement;
const iconSun = document.getElementById('iconSun');
const iconMoon = document.getElementById('iconMoon');
function syncThemeIcon(){
  const dark = root.getAttribute('data-theme') === 'dark';
  iconSun.style.display = dark ? 'none' : 'block';
  iconMoon.style.display = dark ? 'block' : 'none';
  document.getElementById('themeToggle').setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
}
syncThemeIcon();
document.getElementById('themeToggle').addEventListener('click', () => {
  const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  try { localStorage.setItem('pap-theme', next); } catch(e){}
  syncThemeIcon();
});

/* ---------- Mobile nav ---------- */
const navLinks = document.getElementById('navLinks');
const navToggle = document.getElementById('navToggle');
function setNavOpen(open){
  navLinks.classList.toggle('open', open);
  navToggle.setAttribute('aria-expanded', String(open));
  navToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
}
navToggle.addEventListener('click', () => setNavOpen(!navLinks.classList.contains('open')));
navLinks.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setNavOpen(false)));

/* ---------- Data-derived observatory instrumentation ---------- */
const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const clampNumber = (value, min, max) => Math.max(min, Math.min(max, value));
function statedAverage(year){
  const probabilities = year.events.map(event => event.prob).filter(Number.isFinite);
  return probabilities.length
    ? Math.round(probabilities.reduce((sum, value) => sum + value, 0) / probabilities.length)
    : null;
}
function setText(id, value){
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}
function animateMetric(id, target, suffix){
  const element = document.getElementById(id);
  if (!element) return;
  const token = String((Number(element.dataset.animationToken) || 0) + 1);
  element.dataset.animationToken = token;
  if (motionQuery.matches || element.dataset.animated === 'true') {
    element.textContent = target + suffix;
    return;
  }
  element.dataset.animated = 'true';
  const started = performance.now();
  const duration = 520;
  function frame(now){
    if (element.dataset.animationToken !== token) return;
    const progress = clampNumber((now - started) / duration, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = Math.round(target * eased) + suffix;
    if (progress < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
function forecastCoordinate(date){
  const year = date.getFullYear();
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);
  return year + (date - start) / (end - start);
}
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
const probabilitySimulatorState = {
  anchors:null,
  values:null,
  controlsBound:false,
  updateTimer:0,
};
let predictionModelState = location.protocol === 'file:' ? 'offline' : 'loading';
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
  return {
    width:(2 + value / 16).toFixed(2),
    opacity:(.34 + value / 150).toFixed(2),
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
function setSimulatorBranch(id, value){
  const path = document.getElementById(id);
  if (!path) return;
  const style = simulatorBranchStyle(value);
  path.style.setProperty('--branch-width', style.width);
  path.style.setProperty('--branch-opacity', style.opacity);
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
  setSimulatorBranch('sim-path-managed', values.managed);
  setSimulatorBranch('sim-path-handoff', values.handoff);
  setSimulatorBranch('sim-path-default', values.default);
  setSimulatorBranch('sim-path-ungoverned', values.ungoverned);
  const branches = [
    ['Managed pause', values.managed],
    ['Default-path superintelligence', values.default],
    ['Ungoverned takeoff', values.ungoverned],
  ].sort((a, b) => b[1] - a[1]);
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
      <path id="sim-path-managed" class="sim-branch managed" d="M274 168 C322 128 352 78 412 76"/>
      <path id="sim-path-handoff" class="sim-branch managed" d="M428 75 C500 72 558 66 642 65"/>
      <path id="sim-path-default" class="sim-branch default" d="M274 170 C330 170 362 170 412 170 C500 170 558 170 650 170"/>
      <path id="sim-path-ungoverned" class="sim-branch ungoverned" d="M274 172 C324 214 356 266 412 270 C500 276 560 280 650 282"/>
      <g class="sim-node">
        <circle class="sim-node-ring" cx="43" cy="170" r="9"/><circle class="sim-node-core" cx="43" cy="170" r="3"/>
        <text class="sim-sublabel" x="43" y="194" text-anchor="middle">NOW</text>
      </g>
      <g class="sim-node">
        <circle class="sim-node-ring" cx="155" cy="170" r="11"/><circle class="sim-node-core" cx="155" cy="170" r="4"/>
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
        <circle class="sim-node-ring" cx="650" cy="65" r="10"/><circle class="sim-node-core" cx="650" cy="65" r="3"/>
        <text class="sim-label" x="650" y="36" text-anchor="middle">MANAGED HANDOFF</text>
        <text class="sim-sublabel" x="650" y="52" text-anchor="middle">2040</text>
      </g>
      <g class="sim-node">
        <circle class="sim-node-ring" cx="420" cy="170" r="11"/><circle class="sim-node-core" cx="420" cy="170" r="4"/>
        <text class="sim-label" x="420" y="140" text-anchor="middle">DEFAULT PATH</text>
        <text class="sim-sublabel" x="420" y="156" text-anchor="middle">TOP-EXPERT / ASI · 2030</text>
      </g>
      <g class="sim-node">
        <circle class="sim-node-ring" cx="420" cy="270" r="11"/><circle class="sim-node-core" cx="420" cy="270" r="4"/>
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
function renderTurningPoints(years){
  const host = document.getElementById('turningPointsRoute');
  if (!host || !years.length) return;
  const events = years.flatMap(year => year.events.map((event, index) => ({ ...event, year:year.year, index })));
  const find = predicate => events.find(predicate);
  const points = [
    { label:'Human-level AGI', item:find(event => event.simAnchor === 'agi') },
    { label:'Every-industry disruption', item:find(event => event.year === 2027 && /every major industry/i.test(event.t)) },
    { label:'Superintelligence branch', item:find(event => event.simAnchor === 'ungoverned') },
    { label:'Cognitive majority', item:find(event => /produce more cognitive labor than humans/i.test(event.t)) },
    { label:'Physical automation', item:find(event => /one third of economically valuable physical tasks/i.test(event.t)) },
    { label:'Near-total labor automation', item:find(event => event.year === 2040 && /essentially all economically relevant human labor/i.test(event.t)) },
    { label:'Undated horizon', horizon:true },
  ].filter(point => point.horizon || point.item);
  if (points.length < 7 && predictionModelState === 'loading') {
    host.innerHTML = '<span class="turning-points-loading">Loading forecast route…</span>';
    return;
  }
  host.innerHTML = points.map((point, index) => {
    const href = point.horizon ? '#post-superintelligence' : `#event-${point.item.year}-${point.item.index}`;
    const time = point.horizon ? 'Beyond 2040' : String(point.item.year);
    const detail = point.horizon
      ? 'Dependency-gated possibilities'
      : point.item.t;
    return `<a class="turning-point-link" href="${href}" aria-label="${htmlText(point.label)}: ${htmlText(detail)}">
      <span class="turning-point-step">${String(index + 1).padStart(2, '0')}</span>
      <span class="turning-point-copy"><strong>${htmlText(point.label)}</strong><small>${htmlText(time)}</small></span>
    </a>`;
  }).join('');
  host.querySelectorAll('a[href^="#event-"]').forEach(link => link.addEventListener('click', () => {
    const target = document.querySelector(link.getAttribute('href'));
    const yearBlock = target?.closest('.year-block');
    if (yearBlock) setYearDisclosure(yearBlock, false);
  }));
}
function renderRevisionTrail(){
  const summary = document.getElementById('forecastChangesSummary');
  const links = document.getElementById('forecastChangeLinks');
  if (!summary || !links) return;
  const updated = new Date(predictionRevision.updated);
  const dateLabel = isNaN(updated.getTime())
    ? 'Latest published revision'
    : updated.toLocaleDateString('en-US', { day:'numeric', month:'short', year:'numeric' });
  const changes = predictionRevision.changes || [];
  summary.textContent = changes.length
    ? `${dateLabel}: ${changes.length} material event thresholds changed. Dates and branch anchors stayed fixed; the full source basis remains in predictions.json.`
    : `${dateLabel}: no individual event threshold changed under the anti-churn rule.`;
  links.innerHTML = changes.length
    ? changes.map(change => {
      const revised = new Date(`${change.revisedAt}T00:00:00Z`);
      const revisedLabel = isNaN(revised.getTime())
        ? change.revisedAt
        : revised.toLocaleDateString('en-US', { timeZone:'UTC', day:'numeric', month:'short', year:'numeric' });
      return `<a class="revision-link" href="#event-${change.id}">
        <time datetime="${htmlText(change.revisedAt)}">${htmlText(revisedLabel)}</time>
        <span><strong>${htmlText(change.title)}</strong><small>${htmlText(change.note)}</small></span>
        <span aria-hidden="true">→</span>
      </a>`;
    }).join('')
    : '<p>No additions, removals or material event revisions in this publication.</p>';
  setText('changedCount', changes.length);
}
function renderObservatory(){
  if (!Array.isArray(timelineData) || !timelineData.length) return;
  const years = timelineData;
  const events = years.flatMap(year => year.events);
  const today = new Date();
  const coordinate = forecastCoordinate(today);
  const boundedCoordinate = clampNumber(coordinate, years[0].year, years[years.length - 1].year);
  const dayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / 86400000);
  const agiAnchor = events.find(event => event.simAnchor === 'agi');
  const fasterBranch = fasterBranchRange(years);
  setText('heroCoordinate', boundedCoordinate.toFixed(2));
  setText('heroCurrentPosition', boundedCoordinate.toFixed(2));
  setText('heroCurrentContext', `Day ${dayOfYear} of ${today.getFullYear()} · the forecast begins here`);
  animateMetric('heroEventCount', events.length, '');
  setText('heroYearCount', years.length);
  setText('heroHorizonCount', horizonData && Array.isArray(horizonData.items) ? horizonData.items.length : '—');
  setText('heroBranchWindow', fasterBranch ? fasterBranch.label : 'Undated');
  if (agiAnchor && Number.isFinite(agiAnchor.prob)) animateMetric('heroAgiProbability', agiAnchor.prob, '%');
  renderProbabilitySimulator(years, fasterBranch);
  renderTurningPoints(years);
}

/* ---------- Forecast Atlas sidecar state ---------- */
let timelineData = [];
let horizonData = {
  title:'Post-superintelligence horizon',
  summary:'Horizon data is loading from predictions.json.',
  items:[],
};
const domainNames = { individual:'Individual', social:'Social', technology:'Technology', economic:'Economic', geopolitical:'Geopolitical', governance:'Governance' };
const filterOptions = {
  domain:new Set(['all', ...Object.keys(domainNames)]),
  branch:new Set(['all','baseline','managed','default','ungoverned']),
  probability:new Set(['all','very-high','high','medium','low','unstated']),
  theme:new Set(['all','agents','work','robotics','compute','governance','bio','space']),
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
const forecastFilters = initialForecastFilters();
let activeDomain = forecastFilters.domain;
let overlayOn = true;
let predictionRevision = { updated:null, basis:'', changes:[] };
function latestRevisionDate(){
  return String(predictionRevision.updated || '').slice(0, 10);
}
function revisedInLatestRevision(event){
  const revisionDate = latestRevisionDate();
  return !!event.revisedAt && !!revisionDate && event.revisedAt === revisionDate;
}
const themeDefinitions = {
  agents:/\b(agent|agents|agentic|agi|superintelligen|frontier model|ai r&d|expert capability|recursive self|continual-learning)\b/i,
  work:/\b(work|labor|labour|employment|jobs?|income|dividend|tax|econom|revenue|wealth|capital|gdp)\b/i,
  robotics:/\b(robot|robots|robotic|humanoid|physical tasks?|factory|manufactur|autonomous strategic weapons)\b/i,
  compute:/\b(compute|datacenter|data center|chip|semiconductor|energy|grid|power|inference|training run|cooling|radiator)\b/i,
  governance:/\b(govern|regulat|treaty|verification|audit|safety|alignment|control|inspection|policy|court|military|deception|sabotage|sandbox)\b/i,
  bio:/\b(bci|brain|neural|intracortical|connectom|bio|drug|disease|vaccine|pathogen|health|cure|longevity)\b/i,
  space:/\b(orbital|space|satellite|dyson|kardashev|transcension|ruliad|off-world|civilization)\b/i,
};
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

/* ---------- @peterxing X signals mapped to predictions ---------- */
const NEWS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h13a1 1 0 0 1 1 1v13a2 2 0 0 0 2 2H5a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1zm2 3v4h9V7zm0 6v1.5h9V13zm0 3.5V18h9v-1.5zM19 9h1.5a.5.5 0 0 1 .5.5V18a1 1 0 0 1-2 0z"/></svg>';
const X_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
/* Inline fallback. The live site overrides this from signals.json (regenerated hourly from verified
   X activity and matched to each prediction). We keep NO embedded posts inline, so if signals.json
   is unavailable the UI reports unavailable evidence rather than fabricating or searching. */
let xSignals = {};
let currencySignals = {};
let signalCoverageReady = false;
const HTML_ENTITIES = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", '#39':"'", nbsp:' ' };
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
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}
function safeXHandle(value){
  return String(value || 'peterxing').replace(/[^a-z0-9_]/gi, '') || 'peterxing';
}
function safeTweetId(value){
  return String(value || '').replace(/\D/g, '');
}

const SIG_KIND = {
  post:     { noun:'post',     icon:'',         verb:'' },
  repost:   { noun:'repost',   icon:'\u21bb',   verb:'reposted' },
  external: { noun:'evidence', icon:'',         verb:'' },
  like:     { noun:'like',     icon:'\u2665',   verb:'liked' },
  bookmark: { noun:'bookmark', icon:'\uD83D\uDD16', verb:'bookmarked' },
  quote:    { noun:'quote',    icon:'\u201c',   verb:'quoted' },
};
/* Badge text reflects BOTH kind and recency: a past-week item is labelled "Past-week …", otherwise
   it is his "Most recent …" post/repost on that topic (honestly dated below). */
function sigBadge(kind, recency, evidenceType){
  if (kind === 'news') {
    if (evidenceType === 'scenario') return 'News evidence \u00b7 scenario source';
    if (evidenceType === 'leading-indicator') return 'News evidence \u00b7 leading indicator';
    return 'News evidence';
  }
  if (kind === 'external') {
    if (evidenceType === 'scenario') return 'Scenario source';
    if (evidenceType === 'leading-indicator') return 'Leading indicator';
    return 'External evidence';
  }
  const noun = (SIG_KIND[kind] || SIG_KIND.post).noun;
  const when = recency === 'week' ? 'Past-week' : recency === 'historical' ? 'Historical' : 'Most recent';
  return when + ' ' + noun;
}

/* A prediction is identified by "YEAR-INDEX" (index = its position in that year's events array). The same
   id is computed by refresh-signals.js, so each prediction's signals.json embed lines up 1:1 here. */
function signalCard(sig){
  /* Tier-3 verified news evidence renders as news and never borrows any X affordance: no handle,
     no status ID, no "load live post" embed, and the link goes to the resolved article URL. */
  if (sig && (sig.evidenceOwner === 'news' || sig.kind === 'news')) return newsSignalCard(sig);
  const kind = SIG_KIND[sig.kind] ? sig.kind : 'post';
  const author = safeXHandle(sig.author);
  const tweetId = safeTweetId(sig.id);
  const K = SIG_KIND[kind] || SIG_KIND.post;
  const externalEvidence = sig.evidenceOwner === 'external' || kind === 'external';
  const peterAuthored = !externalEvidence && (sig.authorship === 'authored' || kind === 'post');
  const dispName = externalEvidence
    ? htmlText(sig.displayName || ('@' + author))
    : peterAuthored ? 'Peter Xing' : ('@' + author);
  const actionLine = externalEvidence
    ? `External evidence &middot; @${author}`
    : peterAuthored ? 'Peter wrote this' : `${K.icon} Peter reposted this &middot; @${author}`;
  const method = htmlText(sig.matchMethod || 'verified');
  const date = htmlText(sig.date);
  const directUrl = safeHttpUrl(sig.url) || `https://x.com/${author}/status/${tweetId}`;
  const likes = Number.isFinite(Number(sig.likes)) ? Number(sig.likes) : 0;
  const reposts = Number.isFinite(Number(sig.rts)) ? Number(sig.rts) : 0;
  const maps = sig.maps ? `<div class="tl-signal-maps"><b>Observed against:</b> ${htmlText(sig.maps)}</div>` : '';
  const rationale = externalEvidence && sig.mappingRationale
    ? `<div class="tl-signal-maps"><b>${sig.evidenceType === 'scenario' ? 'Scenario relevance' : 'Evidence relevance'}:</b> ${htmlText(sig.mappingRationale)}</div>`
    : '';
  const evidenceLabel = externalEvidence
    ? sig.evidenceType === 'scenario' ? 'scenario source' : sig.evidenceType === 'leading-indicator' ? 'leading indicator' : 'direct evidence'
    : `${peterAuthored ? 'reviewed Peter-authored' : 'reviewed Peter-reposted'} ${sig.evidenceType === 'leading-indicator' ? 'leading indicator' : sig.evidenceType === 'scenario' ? 'scenario source' : 'direct evidence'}`;
  const reviewDate = sig.lastVerifiedAt || sig.reviewedAt || '';
  const reuse = Number(sig.reuseCount) > 1 ? ` · reviewed reuse across ${Number(sig.reuseCount)} related predictions` : ' · unique mapping';
  const provenanceLine = `<div class="tl-signal-maps"><b>Provenance:</b> ${htmlText(evidenceLabel)}${reviewDate ? ` · verified ${htmlText(reviewDate)}` : ''}${reuse}</div>`;
  const metrics = likes || reposts
    ? `<span class="tl-signal-metrics"><span>&#9829; ${likes}</span><span>&#8635; ${reposts}</span></span>`
    : '';
  return `
    <details class="tl-signal" data-kind="${kind}">
      <summary>
        <span class="tl-x">${X_SVG}</span>
        <span class="tl-signal-summary-text">
          <strong>${htmlText(sigBadge(kind, sig.recency, sig.evidenceType))} · ${dispName}</strong>
          ${date} · ${actionLine}
        </span>
        <span class="tl-signal-method">${method}</span>
      </summary>
      <div class="tl-signal-detail">
        ${provenanceLine}
        ${maps}
        ${rationale}
        <div class="tl-signal-text">${htmlText(sig.text)}</div>
        <div class="tl-signal-foot">
          <span class="tl-signal-date">${date}</span>
          ${metrics}
          <span class="tl-signal-actions">
            <button class="tl-signal-load" data-tweet="${tweetId}">Load live post &#8635;</button>
            <a class="tl-signal-link" href="${htmlText(directUrl)}" target="_blank" rel="noopener">View direct post on X &rarr;</a>
          </span>
        </div>
        <div class="tl-embed"></div>
      </div>
    </details>`;
}
function newsSignalCard(sig){
  const publisher = htmlText(sig.publisher || sig.publisherHost || 'Publisher');
  const date = htmlText(sig.date || '');
  const headline = htmlText(sig.headline || '');
  const byline = sig.byline ? ` &middot; by ${htmlText(sig.byline)}` : '';
  const method = htmlText(sig.matchMethod || 'reviewed-news');
  const articleUrl = safeHttpUrl(sig.url) || '';
  const maps = sig.maps ? `<div class="tl-signal-maps"><b>Observed against:</b> ${htmlText(sig.maps)}</div>` : '';
  const rationale = sig.mappingRationale
    ? `<div class="tl-signal-maps"><b>${sig.evidenceType === 'scenario' ? 'Scenario relevance' : 'Evidence relevance'}:</b> ${htmlText(sig.mappingRationale)}</div>`
    : '';
  const evidenceLabel = sig.evidenceType === 'scenario' ? 'verified news scenario source'
    : sig.evidenceType === 'leading-indicator' ? 'verified news leading indicator'
      : 'verified news direct evidence';
  const reviewDate = sig.lastVerifiedAt || sig.reviewedAt || '';
  const reuse = Number(sig.reuseCount) > 1 ? ` · reviewed reuse across ${Number(sig.reuseCount)} related predictions` : ' · unique mapping';
  const provenanceLine = `<div class="tl-signal-maps"><b>Provenance:</b> ${htmlText(evidenceLabel)}${reviewDate ? ` · verified ${htmlText(reviewDate)}` : ''}${reuse}</div>`;
  const quote = sig.quote
    ? `<blockquote class="tl-signal-quote">${htmlText(sig.quote)}</blockquote>`
    : `<div class="tl-signal-text">${htmlText(sig.text)}</div>`;
  const link = articleUrl
    ? `<a class="tl-signal-link" href="${htmlText(articleUrl)}" target="_blank" rel="noopener">Read the article at ${publisher} &rarr;</a>`
    : '';
  return `
    <details class="tl-signal" data-kind="news" data-evidence-medium="news">
      <summary>
        <span class="tl-x tl-news" aria-hidden="true">${NEWS_SVG}</span>
        <span class="tl-signal-summary-text">
          <strong>${htmlText(sigBadge('news', sig.recency, sig.evidenceType))} &mdash; ${publisher}, ${date}</strong>
          ${headline}${byline}
        </span>
        <span class="tl-signal-method">${method}</span>
      </summary>
      <div class="tl-signal-detail">
        ${provenanceLine}
        ${maps}
        ${rationale}
        ${headline ? `<div class="tl-signal-headline">${headline}</div>` : ''}
        ${quote}
        <div class="tl-signal-foot">
          <span class="tl-signal-date">Published ${date}</span>
          <span class="tl-signal-actions">${link}</span>
        </div>
      </div>
    </details>`;
}
/* CURRENCY EVIDENCE — the additive "where this stands now" layer.
   This is deliberately NOT an X card and must never be mistakable for one: no handle, no
   status id, no live-post embed, no x.com link. It is a dated reference to a live-verified
   article, shown BENEATH the prediction's origin evidence and clearly labelled as a later,
   independent observation rather than as Peter's own post. */
function currencyCard(entry){
  const publisher = htmlText(entry.publisherShort || entry.publisher || entry.publisherHost || 'Publisher');
  const headline = htmlText(entry.headline || '');
  const byline = entry.author ? ` &middot; ${htmlText(entry.author)}` : '';
  const url = safeHttpUrl(entry.url) || '';
  const published = entry.publishedAt ? new Date(entry.publishedAt) : null;
  const dateText = published && !isNaN(published.getTime())
    ? published.toLocaleDateString('en-US', { day:'numeric', month:'short', year:'numeric' })
    : '';
  const age = Number(entry.ageDays);
  /* Plain language, because "27d" is jargon. The age is computed from the captured
     publication date, so it degrades honestly rather than claiming false freshness. */
  const ageText = !Number.isFinite(age) ? ''
    : age <= 1 ? 'today'
      : age <= 7 ? `${age} days ago`
        : age <= 14 ? 'this fortnight'
          : age <= 31 ? 'this month'
            : age <= 92 ? 'this quarter'
              : `${Math.round(age / 30)} months ago`;
  /* A peer-reviewed paper and a company blog post are not the same kind of claim, and the
     reader is entitled to see which one they are looking at. */
  const QUALITY = {
    'peer-reviewed-journal': 'Peer-reviewed journal',
    'primary-news-organization': 'Primary news organisation',
    'established-technology-press': 'Established technology press',
    'named-expert-analysis': 'Named expert analysis',
    'official-ai-lab': 'Frontier lab, first-party',
    'industry-primary-source': 'Industry primary source',
    'government': 'Government source',
  };
  const quality = QUALITY[entry.sourceQuality] || 'Verified publication';
  const provenance = entry.provenance
    ? `<div class="tl-signal-maps"><b>Provenance:</b> ${htmlText(entry.provenance)}</div>` : '';
  const rationale = entry.rationale
    ? `<div class="tl-signal-maps"><b>Why this is current evidence:</b> ${htmlText(entry.rationale)}</div>` : '';
  const quote = entry.quote ? `<blockquote class="tl-signal-quote">${htmlText(entry.quote)}</blockquote>` : '';
  const link = url
    ? `<a class="tl-signal-link" href="${htmlText(url)}" target="_blank" rel="noopener">Read the article at ${publisher} &rarr;</a>`
    : '';
  return `
    <details class="tl-signal tl-currency" data-kind="currency" data-evidence-medium="currency" data-freshness="${htmlText(entry.freshness || '')}">
      <summary>
        <span class="tl-x tl-news" aria-hidden="true">${NEWS_SVG}</span>
        <span class="tl-signal-summary-text">
          <strong>Current reference &mdash; ${publisher}, ${htmlText(dateText)}</strong>
          ${headline}${byline}
        </span>
        <span class="tl-signal-method">${htmlText(ageText)}</span>
      </summary>
      <div class="tl-signal-detail">
        <div class="tl-signal-maps"><b>Source type:</b> ${htmlText(quality)}${entry.publisherHost ? ` &middot; ${htmlText(entry.publisherHost)}` : ''}</div>
        ${provenance}
        ${rationale}
        ${quote}
        <div class="tl-signal-foot">
          <span class="tl-signal-date">Published ${htmlText(dateText)}</span>
          <span class="tl-signal-actions">${link}</span>
        </div>
      </div>
    </details>`;
}
/* ESTIMATED TIMING.
   Every dated prediction carries m (1-12), mBand (± months) and mPrecision. The precision is
   the honest part: only 9 of 96 estimates are confident to a named month, so printing
   "May 2026" for all of them would assert precision we explicitly decided we do not have and
   would contradict the band. Each precision tier therefore gets wording it can actually
   support. The month is NEVER written into the prediction text itself — that text is the
   sticky binding key for every evidence approval and currency pin. */
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
function timingHtml(e, year){
  const t = estimatedTiming(e, year);
  if (!t) return '';
  const PRECISION_NOTE = {
    month: 'Estimated to a specific month',
    quarter: 'Estimated to a quarter',
    half: 'Estimated to a half-year',
    year: 'Estimated only to within the year',
  };
  /* Value and band are one string, not two elements: "Mid 2030 ±6 months" is a single
     phrase, and splitting it made screen readers announce three disconnected fragments.
     The basis sits as a text node inside <details> rather than in a wrapped <p>, which
     renders and reads identically while costing four fewer elements per prediction. */
  const value = t.bandText ? `${t.label} ${t.bandText}` : t.label;
  const note = PRECISION_NOTE[t.precision] || '';
  return `
    <div class="event-timing" data-precision="${htmlText(t.precision)}"${t.elapsed ? ' data-elapsed="true"' : ''}>
      <span class="event-timing-label">Estimated timing</span>
      <span class="event-timing-value">${htmlText(value)}</span>
      ${t.elapsed ? '<span class="event-timing-elapsed">window elapsed</span>' : ''}
      ${t.basis ? `<details class="event-timing-basis"><summary>Why this timing</summary>${htmlText(note ? `${note}. ${t.basis}` : t.basis)}</details>` : ''}
    </div>`;
}
function predictionEvidence(key, match, title){
  if (!(signalCoverageReady && xSignals[key])) return evidenceUnavailable();
  const origin = signalCard(xSignals[key]);
  const current = Array.isArray(currencySignals[key]) ? currencySignals[key] : [];
  if (!current.length) return origin;
  /* Origin and current evidence answer different questions, so they are labelled rather
     than stacked anonymously: the origin card is why this prediction exists, the current
     reference is where the world stands on it now. */
  return `
    <div class="tl-evidence-group">
      <div class="tl-evidence-band"><span class="tl-evidence-band-label">Origin evidence</span></div>
      ${origin}
      <div class="tl-evidence-band tl-evidence-band-current">
        <span class="tl-evidence-band-label">Current reference${current.length > 1 ? `s &middot; ${current.length}` : ''}</span>
      </div>
      ${current.map(currencyCard).join('')}
    </div>`;
}
function evidenceUnavailable(){
  return '<div class="tl-signal-unavailable" role="status">Prediction evidence is temporarily unavailable.</div>';
}

function branchForEvent(title){
  if (/^managed branch:/i.test(title)) return { key:'managed', label:'Managed branch' };
  if (/default branch:/i.test(title)) return { key:'default', label:'Default branch' };
  if (/\bungoverned\b/i.test(title)) return { key:'ungoverned', label:'Ungoverned branch' };
  return { key:'baseline', label:'Shared forecast' };
}
function setYearDisclosure(block, collapsed, notify = true){
  if (!block) return;
  block.classList.toggle('is-collapsed', collapsed);
  const button = block.querySelector('.year-toggle');
  if (button) {
    button.setAttribute('aria-expanded', String(!collapsed));
    button.textContent = collapsed ? 'Open year' : 'Collapse';
  }
  if (notify) window.dispatchEvent(new Event('resize'));
}
let yearObserver = null;
function setActiveYear(year){
  document.querySelectorAll('.year-block').forEach(block =>
    block.classList.toggle('is-active', block.dataset.year === String(year)));
}
function observeTimelineYears(){
  if (yearObserver) yearObserver.disconnect();
  const blocks = [...document.querySelectorAll('.year-block')];
  if (!blocks.length) return;
  if (!('IntersectionObserver' in window)) {
    setActiveYear(blocks[0].dataset.year);
    return;
  }
  yearObserver = new IntersectionObserver(entries => {
    const visible = entries
      .filter(entry => entry.isIntersecting)
      .sort((a, b) => Math.abs(a.boundingClientRect.top - 240) - Math.abs(b.boundingClientRect.top - 240));
    if (visible[0]) setActiveYear(visible[0].target.dataset.year);
  }, { rootMargin:'-25% 0px -58% 0px', threshold:[0, .01, .25] });
  blocks.forEach(block => yearObserver.observe(block));
  setActiveYear(blocks[0].dataset.year);
}
function updateFilterUrl(){
  if (location.protocol === 'file:') return;
  const url = new URL(location.href);
  const write = (key, value, fallback = 'all') => value === fallback
    ? url.searchParams.delete(key)
    : url.searchParams.set(key, value);
  write('fd', forecastFilters.domain);
  write('fb', forecastFilters.branch);
  write('fp', forecastFilters.probability);
  write('ft', forecastFilters.theme);
  write('fq', forecastFilters.query, '');
  write('fc', forecastFilters.changed ? '1' : '0', '0');
  history.replaceState(null, '', url);
}
function updateFilterControls(){
  activeDomain = forecastFilters.domain;
  document.querySelectorAll('[data-domain]').forEach(button => {
    const active = button.dataset.domain === forecastFilters.domain;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const controls = {
    branchFilter:forecastFilters.branch,
    probabilityFilter:forecastFilters.probability,
    themeFilter:forecastFilters.theme,
    atlasSearch:forecastFilters.query,
  };
  Object.entries(controls).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element && element.value !== value) element.value = value;
  });
  const changes = document.getElementById('changesOnlyToggle');
  if (changes) changes.setAttribute('aria-pressed', String(forecastFilters.changed));
}
function setSelectCounts(id, counts){
  const select = document.getElementById(id);
  if (!select) return;
  [...select.options].forEach(option => {
    if (!option.dataset.label) option.dataset.label = option.textContent;
    option.textContent = `${option.dataset.label} · ${counts[option.value] || 0}`;
  });
}
function updateFilterCounts(){
  const events = timelineData.flatMap(year => year.events.map(event => ({
    ...event,
    branch:branchForEvent(event.t).key,
    probability:probabilityBand(event.prob),
    themes:eventThemes(event),
  })));
  const domainCounts = { all:events.length };
  const branchCounts = { all:events.length };
  const probabilityCounts = { all:events.length };
  const themeCounts = { all:events.length };
  for (const event of events) {
    domainCounts[event.d] = (domainCounts[event.d] || 0) + 1;
    branchCounts[event.branch] = (branchCounts[event.branch] || 0) + 1;
    probabilityCounts[event.probability] = (probabilityCounts[event.probability] || 0) + 1;
    for (const theme of event.themes) themeCounts[theme] = (themeCounts[theme] || 0) + 1;
  }
  document.querySelectorAll('[data-domain-count]').forEach(element => {
    element.textContent = domainCounts[element.dataset.domainCount] || 0;
  });
  setSelectCounts('branchFilter', branchCounts);
  setSelectCounts('probabilityFilter', probabilityCounts);
  setSelectCounts('themeFilter', themeCounts);
  setText('changedCount', events.filter(revisedInLatestRevision).length);
}
function matchesForecastFilters(event){
  const branch = branchForEvent(event.t).key;
  const themes = eventThemes(event);
  const queryTerms = forecastFilters.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const searchable = `${event.t} ${domainNames[event.d] || ''} ${themes.join(' ')}`.toLowerCase();
  return (forecastFilters.domain === 'all' || event.d === forecastFilters.domain)
    && (forecastFilters.branch === 'all' || branch === forecastFilters.branch)
    && (forecastFilters.probability === 'all' || probabilityBand(event.prob) === forecastFilters.probability)
    && (forecastFilters.theme === 'all' || themes.includes(forecastFilters.theme))
    && (!forecastFilters.changed || revisedInLatestRevision(event))
    && queryTerms.every(term => searchable.includes(term));
}
function applyForecastFilters(syncUrl = true){
  let visibleCount = 0;
  timelineData.forEach(year => {
    const block = document.getElementById('year-' + year.year);
    if (!block) return;
    const filtered = year.events.filter(matchesForecastFilters);
    visibleCount += filtered.length;
    year.events.forEach((event, index) => {
      const node = document.getElementById(`event-${year.year}-${index}`);
      if (node) node.hidden = !matchesForecastFilters(event);
    });
    const high = filtered.filter(event => event.high).length;
    const average = statedAverage({ events:filtered });
    const meta = block.querySelector('.year-meta');
    if (meta) meta.innerHTML = `${filtered.length} shown · ${high} high${average == null ? '' : `<br>${average}% avg probability`}`;
    const empty = block.querySelector('.tl-empty');
    if (empty) empty.hidden = filtered.length > 0;
    block.classList.toggle('is-filter-empty', filtered.length === 0);
    block.hidden = filtered.length === 0;
  });
  setText('filterResultCount', `${visibleCount} of ${timelineData.reduce((sum, year) => sum + year.events.length, 0)} dated predictions shown`);
  updateFilterControls();
  if (syncUrl) updateFilterUrl();
  requestAnimationFrame(observeTimelineYears);
}
function atlasSearchEntries(){
  const entries = timelineData.flatMap(year => year.events.map((event, index) => ({
    kind:'Prediction',
    meta:String(year.year),
    title:event.t,
    href:`#event-${year.year}-${index}`,
  })));
  for (const item of horizonData.items || []) {
    entries.push({ kind:'Horizon', meta:item.epistemic, title:item.t, href:`#horizon-${item.id}` });
  }
  chapters.forEach((chapter, index) => {
    const text = document.createElement('div');
    text.innerHTML = chapter.body;
    entries.push({
      kind:'Chapter',
      meta:chapter.idx,
      title:chapter.title,
      text:text.textContent,
      href:'#book',
      chapterIndex:index,
    });
  });
  return entries;
}
function renderAtlasSearchResults(){
  const host = document.getElementById('atlasSearchResults');
  const input = document.getElementById('atlasSearch');
  if (!host || !input) return;
  const terms = forecastFilters.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) {
    host.hidden = true;
    host.innerHTML = '';
    return;
  }
  const results = atlasSearchEntries()
    .map(entry => ({
      ...entry,
      haystack:`${entry.title} ${entry.meta} ${entry.kind} ${entry.text || ''}`.toLowerCase(),
    }))
    .filter(entry => terms.every(term => entry.haystack.includes(term)))
    .sort((a, b) => Number(b.title.toLowerCase().startsWith(terms[0])) - Number(a.title.toLowerCase().startsWith(terms[0])))
    .slice(0, 10);
  host.innerHTML = results.length
    ? results.map(entry => `<a class="search-result" href="${entry.href}"${entry.chapterIndex == null ? '' : ` data-search-chapter="${entry.chapterIndex}"`}>
        <span>${htmlText(entry.kind)} · ${htmlText(entry.meta)}</span><strong>${htmlText(entry.title)}</strong>
      </a>`).join('')
    : '<div class="search-result"><span>No match</span><strong>Try a broader term or reset filters.</strong></div>';
  host.hidden = false;
}
function resetForecastFilters(){
  Object.assign(forecastFilters, {
    domain:'all',
    branch:'all',
    probability:'all',
    theme:'all',
    changed:false,
    query:'',
  });
  applyForecastFilters();
  renderAtlasSearchResults();
}
function revealHashTarget(){
  const hash = location.hash;
  if (!/^#(?:event-|year-|horizon-)/.test(hash)) return;
  let targetId;
  try { targetId = decodeURIComponent(hash.slice(1)); } catch { return; }
  const target = document.getElementById(targetId);
  if (!target) return;
  const event = target.closest('.event');
  const year = target.closest('.year-block');
  if ((event && event.hidden) || (year && year.hidden)) resetForecastFilters();
  if (year) setYearDisclosure(year, false, false);
  const horizon = target.closest('.horizon-item');
  if (horizon) setHorizonDisclosure(horizon, false);
  target.classList.add('is-selected');
  requestAnimationFrame(() => {
    target.scrollIntoView({ behavior:motionQuery.matches ? 'auto' : 'smooth', block:'center' });
    target.focus({ preventScroll:true });
  });
  setTimeout(() => target.classList.remove('is-selected'), 1800);
}
function renderTimeline(){
  const body = document.getElementById('timelineBody');
  if (!body) return;
  if (!timelineData.length) {
    body.innerHTML = '<div class="tl-empty">Forecast data is loading from predictions.json.</div>';
    setText('filterResultCount', 'Forecast data loading…');
    return;
  }
  const previousYearState = new Map([...body.querySelectorAll('.year-block')]
    .map(block => [block.dataset.year, block.classList.contains('is-collapsed')]));
  const openEvidence = new Set([...body.querySelectorAll('.event .tl-signal[open]')]
    .map(details => details.closest('.event')?.id).filter(Boolean));
  const compactTimeline = window.matchMedia('(max-width: 720px)').matches;
  const expandedThrough = timelineData[0].year + (compactTimeline ? 2 : 4);
  body.innerHTML = timelineData.map(yr => {
    const high = yr.events.filter(e => e.high).length;
    const evCount = yr.events.length;
    const average = statedAverage(yr);
    const rows = yr.events.map((e, idx) => {
      const id = yr.year + '-' + idx;                      // 1:1 with signals.json
      const sigHtml = predictionEvidence(id, e.match, e.t);
      const branch = branchForEvent(e.t);
      const themes = eventThemes(e);
      const probability = Number.isFinite(e.prob) ? `
        <div class="event-probability" aria-label="${e.prob} percent stated probability">
          <span class="event-probability-track" aria-hidden="true"><i style="--prob:${e.prob}%"></i></span>
          <span>${e.prob}%</span>
        </div>` : '';
      return `
        <article class="event ${e.signal ? 'signal' : (e.high ? 'high' : '')} branch-${branch.key} ${e.revisedAt ? 'event-revised' : ''}" id="event-${id}" data-domain="${e.d}" data-branch="${branch.key}" data-probability="${probabilityBand(e.prob)}" data-themes="${themes.join(' ')}" data-revised="${e.revisedAt || ''}" tabindex="-1">
          <div class="event-body">
            <div class="event-heading">
              <span class="event-dot">${e.signal ? 'PETER’S CALL' : domainNames[e.d]}</span>
              ${branch.key === 'baseline' ? '' : `<span class="event-branch">${branch.label}</span>`}
              ${e.revisedAt ? `<span class="event-branch">Revised ${htmlText(e.revisedAt)}</span>` : ''}
              <a class="deep-link" href="#event-${id}" aria-label="Link to ${htmlText(e.t)}" title="Link to this prediction">#</a>
            </div>
            <div class="event-title">${htmlText(e.t)}</div>
            <div class="event-tags">
              ${e.high ? '<span class="tag impact">High impact</span>' : ''}
              ${e.signal ? '<span class="tag">Peter Xing anchor</span>' : ''}
            </div>
            ${probability}
            ${timingHtml(e, yr.year)}
            ${e.revisedAt && e.changeNote ? `<p class="event-change"><strong>What changed:</strong> ${htmlText(e.changeNote)}</p>` : ''}
            ${sigHtml}
          </div>
        </article>`;
    }).join('');
    const eventsHtml = rows + `<div class="tl-empty" hidden>No events in this domain for ${yr.year}.</div>`;
    const defaultCollapsed = yr.year > expandedThrough;
    const collapsed = previousYearState.has(String(yr.year))
      ? previousYearState.get(String(yr.year))
      : defaultCollapsed;
    return `
      <section class="year-block ${collapsed ? 'is-collapsed' : ''}" id="year-${yr.year}" data-year="${yr.year}" aria-labelledby="year-label-${yr.year}" tabindex="-1">
        <div class="year-dot"></div>
        <div class="year-row">
          <div class="year-tag">
            <div class="year-title-row">
              <div class="year-num" id="year-label-${yr.year}">${yr.year}</div>
              <a class="deep-link" href="#year-${yr.year}" aria-label="Link to forecast year ${yr.year}" title="Link to ${yr.year}">#</a>
            </div>
            <div class="year-meta">${evCount} events · ${high} high${average == null ? '' : `<br>${average}% avg probability`}</div>
            <button type="button" class="year-toggle" aria-expanded="${!collapsed}" aria-controls="year-events-${yr.year}">${collapsed ? 'Open year' : 'Collapse'}</button>
          </div>
          <div>
            <div class="year-summary">${htmlText(yr.summary)}</div>
            <div class="events" id="year-events-${yr.year}">${eventsHtml}</div>
          </div>
        </div>
      </section>`;
  }).join('');
  body.querySelectorAll('.year-toggle').forEach(button => button.addEventListener('click', () => {
    const block = button.closest('.year-block');
    setYearDisclosure(block, !block.classList.contains('is-collapsed'));
  }));
  openEvidence.forEach(id => {
    const details = document.querySelector('#' + id + ' .tl-signal');
    if (details) details.open = true;
  });
  document.getElementById('timelineAtlas').classList.toggle('evidence-off', !overlayOn);
  updateFilterCounts();
  applyForecastFilters(false);
}
function validHorizon(h){
  if (!h || typeof h !== 'object' || typeof h.title !== 'string' || typeof h.summary !== 'string' || !Array.isArray(h.items) || !h.items.length) return false;
  const summary = h.summary.toLowerCase();
  if (!summary.includes('aligned superintelligence') || !summary.includes('not a probability by 2040') || !summary.includes('mutually exclusive')) return false;
  const validLists = item => ['dependencies','indicators'].every(k =>
    Array.isArray(item[k]) && item[k].length >= 2 && item[k].length <= 4 && item[k].every(v => typeof v === 'string' && v.trim()));
  if (!h.items.every(item => item && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id)
      && typeof item.t === 'string' && domainNames[item.d]
      && ['conditional','speculative'].includes(item.epistemic)
      && typeof item.conditionalProb === 'number' && item.conditionalProb >= 0 && item.conditionalProb <= 100
      && validLists(item) && typeof item.caveat === 'string' && item.caveat.trim()
      && item.match && /\bfrom:peterxing\b/i.test(item.match.search || ''))) return false;
  const text = h.items.map(item => `${item.t} ${item.caveat} ${item.dependencies.join(' ')} ${item.indicators.join(' ')}`).join(' ').toLowerCase();
  return text.includes('endovascular bcis are minimally invasive, not non-invasive')
    && text.includes('chatbot or digital replica')
    && text.includes('small orbital clusters are not a dyson swarm')
    && text.includes('energy-use classification')
    && text.includes('no empirical confirmation')
    && text.includes('not an established physical theory');
}
function horizonList(items){
  return `<ul class="horizon-list">${items.map(item => `<li>${htmlText(item)}</li>`).join('')}</ul>`;
}
const horizonBranches = [
  { key:'neural', label:'Neural symbiosis', detail:'Implanted and genuinely non-invasive routes', ids:['implantable-neural-symbiosis','non-invasive-neural-symbiosis'] },
  { key:'digital', label:'Digital minds', detail:'Emulation and identity continuity', ids:['whole-brain-emulation-and-uploading'] },
  { key:'outward', label:'Outward expansion', detail:'Orbital compute and energy capture', exclusive:true, ids:['orbital-compute-to-proto-dyson','kardashev-energy-scaling'] },
  { key:'inward', label:'Inward transcension', detail:'Compression and testable foundations', exclusive:true, ids:['transcension-hypothesis','ruliad-testable-physics'] },
];
function horizonBranchFor(id){
  return horizonBranches.find(branch => branch.ids.includes(id)) || horizonBranches[1];
}
function setHorizonDisclosure(card, collapsed){
  if (!card) return;
  card.classList.toggle('is-collapsed', collapsed);
  const button = card.querySelector('.horizon-toggle');
  if (button) {
    button.setAttribute('aria-expanded', String(!collapsed));
    button.textContent = collapsed ? 'Open evidence ladder' : 'Collapse evidence ladder';
  }
  window.dispatchEvent(new Event('resize'));
}
function renderHorizonMap(){
  const map = document.getElementById('horizonMap');
  if (!map) return;
  const byId = Object.fromEntries(horizonData.items.map(item => [item.id, item]));
  map.innerHTML = horizonBranches.map(branch => {
    const nodes = branch.ids.map(id => byId[id]).filter(Boolean).map(item => `
      <button type="button" class="horizon-node" data-horizon-target="${item.id}" aria-controls="horizon-${item.id}">
        <span class="instrument-label">${item.epistemic} · ${item.conditionalProb}% conditional</span>
        <span class="horizon-node-title">${htmlText(item.t)}</span>
        <span class="horizon-node-meter" aria-hidden="true"><i style="--prob:${item.conditionalProb}%"></i></span>
      </button>`).join('');
    return `<section class="horizon-branch" data-branch="${branch.key}" data-exclusive="${branch.exclusive ? 'true' : 'false'}">
      <div class="horizon-branch-head">
        <span class="instrument-label">${branch.exclusive ? 'Mutually exclusive candidate' : 'Conditional pathway'}</span>
        <strong>${branch.label}</strong>
        <small>${branch.detail}</small>
      </div>
      ${nodes}
    </section>`;
  }).join('');
  map.querySelectorAll('.horizon-node').forEach(node => node.addEventListener('click', () => {
    map.querySelectorAll('.horizon-node').forEach(item => item.classList.remove('active'));
    document.querySelectorAll('.horizon-item').forEach(item => item.classList.remove('is-selected'));
    node.classList.add('active');
    const card = document.getElementById('horizon-' + node.dataset.horizonTarget);
    if (!card) return;
    setHorizonDisclosure(card, false);
    card.classList.add('is-selected');
    card.scrollIntoView({ behavior: motionQuery.matches ? 'auto' : 'smooth', block:'center' });
    card.focus({ preventScroll:true });
  }));
}
function renderHorizon(){
  const title = document.getElementById('horizonTitle');
  const summary = document.getElementById('horizonSummary');
  const body = document.getElementById('horizonBody');
  if (!body) return;
  if (!Array.isArray(horizonData.items) || !horizonData.items.length) {
    body.innerHTML = '<div class="tl-empty">Horizon data is loading from predictions.json.</div>';
    const map = document.getElementById('horizonMap');
    if (map) map.innerHTML = '';
    return;
  }
  const previousDisclosure = new Map([...body.querySelectorAll('.horizon-item')]
    .map(card => [card.dataset.horizonId, card.classList.contains('is-collapsed')]));
  const selectedId = body.querySelector('.horizon-item.is-selected')?.dataset.horizonId || null;
  const openEvidence = new Set([...body.querySelectorAll('.horizon-item .tl-signal[open]')]
    .map(details => details.closest('.horizon-item')?.dataset.horizonId).filter(Boolean));
  if (title) title.textContent = horizonData.title;
  if (summary) summary.textContent = horizonData.summary;
  const compactHorizon = window.matchMedia('(max-width: 720px)').matches;
  body.innerHTML = horizonData.items.map(item => {
    const key = 'horizon-' + item.id;
    const sigHtml = predictionEvidence(key, item.match, item.t);
    const branch = horizonBranchFor(item.id);
    const collapsed = previousDisclosure.has(item.id) ? previousDisclosure.get(item.id) : compactHorizon;
    return `<article class="horizon-item ${collapsed ? 'is-collapsed' : ''} ${selectedId === item.id ? 'is-selected' : ''}" id="horizon-${item.id}" data-horizon-id="${item.id}" data-branch="${branch.key}" tabindex="-1">
      <div class="horizon-item-head">
        <span class="horizon-epistemic" data-label="${item.epistemic}">${item.epistemic}</span>
        <span class="horizon-prob">${item.conditionalProb}% conditional plausibility</span>
        <span class="horizon-domain">${domainNames[item.d]}</span>
        <span class="horizon-domain">${branch.label}</span>
      </div>
      <!-- Every dated prediction carries an estimated month. These seven deliberately do not,
           and that absence is a claim in itself, so it is stated rather than left blank. -->
      <div class="event-timing horizon-timing" data-precision="undated">
        <span class="event-timing-label">Estimated timing</span>
        <span class="event-timing-value">Deliberately undated</span>
        <details class="event-timing-basis">
          <summary><span>Why there is no date</span></summary>
          <p>These possibilities are gated on aligned superintelligence existing first, not on a
          calendar. Their timing depends entirely on when — and whether — that gate opens, so any
          month or year here would be invented precision. They are ordered by dependency and
          conditional plausibility instead, and each states the evidence that would move it.</p>
        </details>
      </div>
      <div class="horizon-item-title">
        <h3>${htmlText(item.t)}</h3>
        <a class="deep-link" href="#horizon-${item.id}" aria-label="Link to ${htmlText(item.t)}" title="Link to this horizon item">#</a>
        <div class="horizon-meter" aria-label="${item.conditionalProb} percent conditional plausibility">
          <span class="horizon-meter-track" aria-hidden="true"><i style="--prob:${item.conditionalProb}%"></i></span>
          <span>${item.conditionalProb}%</span>
        </div>
        <button type="button" class="horizon-toggle" aria-expanded="${!collapsed}">${collapsed ? 'Open evidence ladder' : 'Collapse evidence ladder'}</button>
      </div>
      <div class="horizon-columns">
        <div class="horizon-block"><h4>Dependencies</h4>${horizonList(item.dependencies)}</div>
        <div class="horizon-block"><h4>Observable indicators</h4>${horizonList(item.indicators)}</div>
      </div>
      <p class="horizon-caveat"><strong>Caveat:</strong> ${htmlText(item.caveat)}</p>
      <div class="horizon-signal">${sigHtml}</div>
    </article>`;
  }).join('');
  body.querySelectorAll('.horizon-toggle').forEach(button => button.addEventListener('click', () => {
    const card = button.closest('.horizon-item');
    setHorizonDisclosure(card, !card.classList.contains('is-collapsed'));
  }));
  openEvidence.forEach(id => {
    const details = document.querySelector(`#horizon-${id} .tl-signal`);
    if (details) details.open = true;
  });
  renderHorizonMap();
  if (selectedId) document.querySelector(`[data-horizon-target="${selectedId}"]`)?.classList.add('active');
}
renderTimeline();
renderHorizon();
renderObservatory();
renderRevisionTrail();
setText('heroPredFreshness', 'Forecast data · loading');

/* Daily-revised predictions live in predictions.json. If it cannot load, the page keeps an explicit
   unavailable state rather than displaying a stale duplicate forecast. */
const predictionsReady = (function loadPredictions(){
  if (location.protocol === 'file:') {
    predictionModelState = 'offline';
    setText('heroPredFreshness', 'Forecast data requires the local server');
    return Promise.resolve(false);
  }
  return fetch('predictions.json', { cache:'no-cache' })
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (!d || !Array.isArray(d.years) || !d.years.length) {
        predictionModelState = 'unavailable';
        setText('heroPredFreshness', 'Forecast data unavailable');
        renderTimeline();
        renderProbabilitySimulator(timelineData, null);
        return false;
      }
      const clean = d.years.filter(y => y && typeof y.year === 'number' && Array.isArray(y.events) && typeof y.summary === 'string');
      if (!clean.length) {
        predictionModelState = 'unavailable';
        setText('heroPredFreshness', 'Forecast data unavailable');
        renderTimeline();
        renderProbabilitySimulator(timelineData, null);
        return false;
      }
      clean.sort((a, b) => a.year - b.year);
      timelineData = clean;
      predictionModelState = 'loaded';
      const revisionDate = String(d.updated || '').slice(0, 10);
      predictionRevision = {
        updated:d.updated || null,
        basis:d.basis || '',
        changes:clean.flatMap(year => year.events.map((event, index) => ({
          id:`${year.year}-${index}`,
          year:year.year,
          title:event.t,
          revisedAt:event.revisedAt,
          note:event.changeNote,
        }))).filter(change => change.revisedAt && change.revisedAt === revisionDate && change.note),
      };
      if (validHorizon(d.postSuperintelligence)) {
        horizonData = d.postSuperintelligence;
      } else {
        horizonData = {
          title:'Post-superintelligence horizon',
          summary:'Horizon data is unavailable because its dependency contract failed validation.',
          items:[],
        };
        console.error('Invalid or misleading postSuperintelligence data; hiding the horizon rather than displaying stale data.');
      }
      renderTimeline();
      renderHorizon();
      renderObservatory();
      renderRevisionTrail();
      renderAtlasSearchResults();
      requestAnimationFrame(revealHashTarget);
      const stamp = document.getElementById('predStamp');
      if (stamp && d.updated){
        const dt = new Date(d.updated);
        if (!isNaN(dt.getTime())){
          setText('heroPredFreshness', 'Forecast revised · '
            + dt.toLocaleDateString('en-US', { day:'numeric', month:'short', year:'numeric' }));
          stamp.textContent = '\u25C8 Predictions revised from the latest news & @peterxing\u2019s X activity \u00b7 last revised '
            + dt.toLocaleDateString('en-US', { day:'numeric', month:'short', year:'numeric' });
          stamp.hidden = false;
        }
      }
      return true;
    })
    .catch(() => {
      predictionModelState = 'unavailable';
      setText('heroPredFreshness', 'Forecast data unavailable');
      renderTimeline();
      renderHorizon();
      renderRevisionTrail();
      renderProbabilitySimulator(timelineData, null);
      return false;
    });
})();

/* Hourly-refreshed signals prioritize reviewed @peterxing activity and retain reviewed authoritative
   external direct, scenario, or leading-indicator evidence. */
const SIGNAL_SOURCE_LABELS = {
  'x-api': 'X API realtime',
  'archive-verified': 'archive-verified X statuses',
  'public-rss': 'live public X profile feed',
  'public-rss-cache': 'recent public X profile snapshot',
  'x-api-cache': 'recent X API snapshot',
  'syndication': 'live X public syndication'
};
function renderSignalMetadata(data){
  const newsMappings = Number(data.coverage?.byEvidenceMedium?.news)
    || Number(data.coverage?.byEvidenceOwner?.news) || 0;
  /* The provenance stamp must stay literally true: it may name an all-X corpus only while one exists. */
  const sourceLabel = (SIGNAL_SOURCE_LABELS[data.source] || 'verified X activity')
    + (newsMappings ? ` + ${newsMappings} live-verified news article${newsMappings === 1 ? '' : 's'}` : '');
  const sourceStatus = data.sourceStatus || {};
  const updated = new Date(data.updated);
  const newest = new Date(data.newestItemAt);
  const updatedLabel = isNaN(updated.getTime())
    ? 'update time unavailable'
    : updated.toLocaleDateString('en-US', { day:'numeric', month:'short', year:'numeric' });
  const newestLabel = isNaN(newest.getTime())
    ? 'newest-item time unavailable'
    : newest.toLocaleString('en-US', { day:'numeric', month:'short', hour:'numeric', minute:'2-digit' });
  const freshness = data.sourceFresh === true ? 'fresh source' : 'source freshness unverified';
  const archiveVerified = sourceStatus.mode === 'archive-verified';
  const sourceQualifier = archiveVerified
    ? ` · ${sourceStatus.reason || 'direct status verification'}`
    : sourceStatus.mode === 'degraded' ? ' · source degraded' : '';
  setText('heroSignalFreshness', `Evidence · ${sourceLabel}${sourceQualifier} · ${updatedLabel}`);
  setText('realityMeta', `${freshness} · ${sourceLabel}${sourceQualifier} · newest known activity ${newestLabel} · six verified observations`);
  renderEvidenceDashboard(data, sourceLabel, freshness);
}
function renderEvidenceDashboard(data, sourceLabel, freshness){
  const coverage = data.coverage || {};
  const owners = coverage.byEvidenceOwner || {};
  const types = coverage.byEvidenceType || {};
  const total = Number(coverage.total) || 0;
  const external = Number(owners.external) || 0;
  const peterAuthorship = coverage.byPeterAuthorship || {};
  const authored = Number(peterAuthorship.authored) || 0;
  const reposted = Number(peterAuthorship.reposted) || 0;
  const embeds = Object.values(data.embeds || {});
  const media = coverage.byEvidenceMedium || {};
  const newsCount = Number(media.news) || Number(owners.news) || 0;
  const xCount = Number(media.x) || (total - newsCount);
  const peterStatuses = new Set(embeds.filter(embed => embed.evidenceOwner === 'peterxing').map(embed => embed.id)).size;
  const externalStatuses = new Set(embeds.filter(embed => embed.evidenceOwner === 'external').map(embed => embed.id)).size;
  const newsArticles = new Set(embeds.filter(embed => embed.evidenceOwner === 'news').map(embed => embed.id)).size;
  const percentage = value => total ? (value / total * 100).toFixed(1) : '0.0';
  setText('evidenceDirectStat', `${coverage.direct || 0}/${total}`);
  setText('evidenceAuthoredStat', String(authored));
  setText('evidenceRepostedStat', String(reposted));
  setText('evidenceExternalStat', String(external));
  setText('evidenceReuseStat', String(coverage.uniquePosts || 0));
  setText('evidenceMaxReuseStat', `${coverage.maxReuse || 0}×`);
  setText('evidenceAuthoredShare', `${percentage(authored)}%`);
  setText('evidenceRepostedShare', `${percentage(reposted)}%`);
  setText('evidenceExternalShare', `${percentage(external)}%`);
  document.getElementById('evidenceAuthoredBar')?.style.setProperty('--share', `${percentage(authored)}%`);
  document.getElementById('evidenceRepostedBar')?.style.setProperty('--share', `${percentage(reposted)}%`);
  document.getElementById('evidenceExternalBar')?.style.setProperty('--share', `${percentage(external)}%`);
  const typeMix = document.getElementById('evidenceTypeMix');
  if (typeMix) {
    typeMix.innerHTML = [
      ['Peter mappings', authored + reposted],
      ['Peter wrote', authored],
      ['Peter reposted', reposted],
      ['Leading indicators', types['leading-indicator'] || 0],
      ['Scenario sources', types.scenario || 0],
      ['Peter unique statuses', peterStatuses],
      ['External unique statuses', externalStatuses],
      ...(newsCount ? [
        ['X statuses vs verified news', `${xCount} X · ${newsCount} news`],
        ['News unique articles', newsArticles],
      ] : []),
      ['Maximum reviewed reuse', `${coverage.maxReuse || 0} of ${coverage.reuseCeiling || 0}`],
    ].map(([label, count]) => `<span>${htmlText(label)} · ${count}</span>`).join('');
  }
  const health = document.getElementById('evidenceSourceHealth');
  if (health) {
    const status = data.sourceStatus || {};
    const archiveVerified = status.mode === 'archive-verified';
    const degraded = status.mode === 'degraded' || status.mode === 'unavailable';
    health.classList.toggle('is-degraded', degraded);
    const title = archiveVerified
      ? `Archive-verified source chain · ${sourceLabel}`
      : degraded ? `Degraded source · ${sourceLabel}` : `Primary source · ${sourceLabel}`;
    const detail = archiveVerified
      ? `${status.message || 'Status IDs are hydrated and cross-checked directly.'} ${status.actionRequired ? `API note: ${status.actionRequired}` : ''}`
      : degraded
        ? `${status.message || 'The evidence source is unavailable.'} ${status.actionRequired ? `Action: ${status.actionRequired}` : ''}`
        : `${freshness}. Reviewed evidence age is tracked separately from source freshness.`;
    health.innerHTML = `<strong>${htmlText(title)}</strong><span>${htmlText(detail)}</span>`;
  }
}
function expectedSignalIds(){
  return [
    ...timelineData.flatMap(year => year.events.map((_, index) => `${year.year}-${index}`)),
    ...horizonData.items.map(item => `horizon-${item.id}`),
  ];
}
function hasCompleteSignalCoverage(data){
  if (!data || data.sourceFresh !== true || !data.embeds || typeof data.embeds !== 'object') return false;
  const expected = expectedSignalIds();
  const directIds = Object.keys(data.embeds);
  const searchIds = data.search && typeof data.search === 'object' ? Object.keys(data.search) : [];
  if (searchIds.length
      || expected.length !== directIds.length
      || expected.some(id => !data.embeds[id])
      || directIds.some(id => !expected.includes(id))) return false;
  const usesByPost = directIds.reduce((uses, id) => {
    const postId = String(data.embeds[id] && data.embeds[id].id || '');
    if (!uses[postId]) uses[postId] = [];
    uses[postId].push(data.embeds[id]);
    return uses;
  }, {});
  const reuseValid = Object.values(usesByPost).every(uses => {
    const owner = uses[0].evidenceOwner;
    const expectedMode = owner === 'external' ? 'external-reuse'
      : owner === 'news' ? 'news-reuse' : 'family-reuse';
    const groups = new Set(uses.map(signal =>
      signal.evidenceOwner === 'peterxing' ? signal.evidenceFamily : signal.reuseFamily));
    const owners = new Set(uses.map(signal => signal.evidenceOwner));
    return uses.length === 1
      ? uses[0].assignmentMode === 'unique' && Number(uses[0].reuseCount) === 1
      : owners.size === 1 && groups.size === 1
        && uses.every(signal => signal.assignmentMode === expectedMode
          && Number(signal.reuseCount) === uses.length);
  });
  if (!reuseValid) return false;
  const directValid = directIds.every(id => {
    const signal = data.embeds[id];
    const provenance = signal && signal.provenance || {};
    const isNews = signal && signal.evidenceOwner === 'news';
    const common = (isNews
      ? /^news:[a-z0-9][a-z0-9-]*$/.test(String(signal.id || ''))
        && /^https:\/\/[^\s/]+\.[^\s/]+\/\S*$/.test(String(signal.url || ''))
      : /^\d{15,}$/.test(String(signal && signal.id || ''))
        && /^https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d{15,}$/.test(String(signal && signal.url || '')))
      && signal.reviewed === true
      && !!signal.evidenceFamily
      && !!signal.mappingRationale;
    if (!common) return false;
    if (isNews) {
      return signal.kind === 'news'
        && signal.activityKind === 'news'
        && provenance.evidenceOwner === 'news'
        && provenance.activityKind === 'news'
        && !!provenance.publisher
        && !!provenance.publisherHost
        && !!provenance.publishedAt
        && !!provenance.retrievedAt
        && !!provenance.sourceQuality
        && !!provenance.textSha256
        && provenance.verifiedThrough === 'live-fetch+quote-match'
        && Array.isArray(provenance.sourceChain)
        && provenance.sourceChain.includes('quote-match')
        && !!signal.headline
        && !!signal.quote
        && !!signal.publisher
        && signal.matchMethod === 'reviewed-news'
        && ['direct', 'scenario', 'leading-indicator'].includes(signal.evidenceType)
        && ['unique', 'news-reuse'].includes(signal.assignmentMode)
        && !!signal.reuseFamily;
    }
    if (signal.evidenceOwner === 'peterxing') {
      return ['post', 'repost'].includes(signal.kind)
        && provenance.evidenceOwner === 'peterxing'
        && provenance.account === 'peterxing'
        && ['authored', 'reposted'].includes(provenance.relationship)
        && /^\d{15,}$/.test(String(provenance.activityId || ''))
        && !!provenance.observedIn
        && !!provenance.lastVerifiedAt
        && provenance.verifiedThrough === 'archive-verified'
        && Array.isArray(provenance.sourceChain)
        && provenance.sourceChain.includes('tweet-result')
        && signal.authorship === (provenance.relationship === 'authored' ? 'authored' : 'reposted')
        && signal.matchMethod === 'reviewed-sticky'
        && ['unique', 'family-reuse'].includes(signal.assignmentMode);
    }
    return signal.evidenceOwner === 'external'
      && signal.kind === 'external'
      && provenance.evidenceOwner === 'external'
      && provenance.activityKind === 'external'
      && provenance.account === signal.author
      && !!provenance.displayName
      && !!provenance.sourceQuality
      && !!provenance.retrievedAt
      && provenance.verifiedThrough === 'first-party-status+oembed'
      && Array.isArray(provenance.sourceChain)
      && provenance.sourceChain.includes('tweet-result')
      && ['direct', 'scenario', 'leading-indicator'].includes(signal.evidenceType)
      && ['unique', 'external-reuse'].includes(signal.assignmentMode)
      && !!signal.reuseFamily;
  });
  const maxReuse = Math.max(0, ...Object.values(usesByPost).map(uses => uses.length));
  return directValid
    && data.coverage && data.coverage.complete === true
    && data.coverage.direct === directIds.length
    && data.coverage.searches === 0
    && data.coverage.total === expected.length
    && data.coverage.maxReuse === maxReuse
    && data.coverage.stickyPeterFloor >= 24
    && data.coverage.stickyPeterAuthoredFloor >= 10
    && Number(data.coverage.byEvidenceOwner?.peterxing || 0) >= data.coverage.stickyPeterFloor
    && data.coverage.reuseCeiling >= 1 && data.coverage.reuseCeiling <= 10
    && maxReuse <= data.coverage.reuseCeiling
    && data.sourceStatus
    && data.sourceStatus.activeSource === data.source
    && data.source === 'archive-verified'
    && data.sourceStatus.mode === 'archive-verified'
    && data.sourceStatus.primarySource === 'first-party-status'
    && Number(data.sourceStatus.hydratedThisRun) > 0
    && Array.isArray(data.sourceAttempts)
    && ['wayback-cdx','tweet-result','x-oembed'].every(source =>
      data.sourceAttempts.some(attempt => attempt.source === source))
    && Number(data.coverage.byPeterAuthorship?.authored || 0)
      + Number(data.coverage.byPeterAuthorship?.reposted || 0)
      === Number(data.coverage.byEvidenceOwner?.peterxing || 0);
}
/* Daily-refreshed About-the-Author: a sidecar author.json (regenerated daily from Peter Xing's
   LinkedIn profile + his latest talks) overrides the inline fallback markup above. */
(function loadAuthor(){
  if (location.protocol === 'file:') return; // offline file:// — keep inline fallback
  fetch('author.json', { cache:'no-cache' })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(d){
      if (!d) return;
      if (d.name)     { var n = document.getElementById('authorName');     if (n) n.textContent = d.name; }
      if (d.headline) { var h = document.getElementById('authorHeadline'); if (h) h.textContent = d.headline; }
      if (d.linkedin) {
        var lk = document.getElementById('authorLink');
        var linkedIn = safeHttpUrl(d.linkedin);
        if (lk && linkedIn) lk.href = linkedIn;
      }
      if (Array.isArray(d.bio) && d.bio.length) {
        var bioEl = document.getElementById('authorBio');
        if (bioEl) {
          var link = bioEl.querySelector('.author-link');
          bioEl.innerHTML = d.bio.map(function(p){ return '<p>' + htmlText(p) + '</p>'; }).join('') + (link ? link.outerHTML : '');
        }
      }
      if (Array.isArray(d.roles) && d.roles.length) {
        var rolesEl = document.getElementById('authorRoles');
        if (rolesEl) rolesEl.innerHTML = d.roles.map(function(r){
          return '<li><strong>' + htmlText(r.org) + '</strong><span>' + htmlText(r.detail) + '</span></li>';
        }).join('');
      }
      if (Array.isArray(d.talks) && d.talks.length) {
        var talksEl = document.getElementById('authorTalks');
        if (talksEl) talksEl.innerHTML = d.talks.map(function(t){
          var meta = htmlText(t.venue) + (t.year ? ' · ' + htmlText(t.year) : '');
          var talkUrl = safeHttpUrl(t.url);
          return '<a class="card author-talk" href="' + htmlText(talkUrl) + '" target="_blank" rel="noopener">' +
                 '<span class="talk-venue">' + meta + '</span>' +
                 '<h5>' + htmlText(t.title) + '</h5>' +
                 '<p>' + htmlText(t.blurb) + '</p>' +
                 '<span class="talk-go">Watch / listen →</span></a>';
        }).join('');
      }
    })
    .catch(function(){});
})();

(function loadSignals(){
  if (location.protocol === 'file:') return; // offline file:// — keep inline fallback
  Promise.all([
    predictionsReady,
    fetch('signals.json', { cache:'no-cache' }).then(r => r.ok ? r.json() : null),
  ])
    .then(([, d]) => {
      if (!d) return;
      if (Array.isArray(d.reality) && d.reality.length) renderReality(d.reality);
      renderSignalMetadata(d);
      signalCoverageReady = hasCompleteSignalCoverage(d);
      xSignals = signalCoverageReady ? d.embeds : {};
      /* The currency layer is additive and independent: it is only ever shown next to an
         origin card, so it is gated on the same coverage check. If the bundle is degraded
         we show nothing rather than implying a reference we cannot stand behind. */
      currencySignals = signalCoverageReady && d.currency ? d.currency : {};
      renderTimeline();
      renderHorizon();
      requestAnimationFrame(revealHashTarget);
      const stamp = document.getElementById('sigStamp');
      if (!signalCoverageReady) {
        setText('heroSignalFreshness', 'Prediction evidence unavailable');
        const health = document.getElementById('evidenceSourceHealth');
        if (health) {
          health.classList.add('is-degraded');
          health.innerHTML = '<strong>Evidence bundle unavailable</strong><span>Direct cards are hidden because provenance, source freshness or coverage validation failed.</span>';
        }
        if (stamp) {
          stamp.textContent = 'Evidence bundle unavailable · direct evidence hidden';
          stamp.hidden = false;
        }
      } else if (stamp && d.updated){
        const dt = new Date(d.updated);
        if (!isNaN(dt.getTime())){
         const sourceLabel = SIGNAL_SOURCE_LABELS[d.source] || 'verified X activity';
         const owners = d.coverage && d.coverage.byEvidenceOwner || {};
         const authorship = d.coverage && d.coverage.byPeterAuthorship || {};
         const sourceState = d.sourceStatus && d.sourceStatus.mode === 'archive-verified'
           ? ' · first-party hydrated + oEmbed cross-check'
           : d.sourceStatus && d.sourceStatus.reason ? ` · ${d.sourceStatus.reason}` : '';
         stamp.textContent = `Prediction evidence · ${d.coverage.direct}/${d.coverage.total} direct · zero searches · ${authorship.authored || 0} Peter wrote · ${authorship.reposted || 0} Peter reposted · ${owners.external || 0} external · max reuse ${d.coverage.maxReuse} · ${sourceLabel}${sourceState} · checked `
           + dt.toLocaleDateString('en-US',{day:'numeric',month:'short',year:'numeric'});
         stamp.hidden = false;
       }
      }
    })
    .catch(() => {
      signalCoverageReady = false;
      xSignals = {};
      currencySignals = {};
      renderTimeline();
      renderHorizon();
      requestAnimationFrame(revealHashTarget);
      setText('heroSignalFreshness', 'Prediction evidence unavailable');
      const health = document.getElementById('evidenceSourceHealth');
      if (health) {
        health.classList.add('is-degraded');
        health.innerHTML = '<strong>Evidence bundle unavailable</strong><span>signals.json could not be loaded; no fallback match is being implied.</span>';
      }
    });
})();
let twPromise = null;
function loadTwitter(){
  if (twPromise) return twPromise;
  twPromise = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://platform.twitter.com/widgets.js';
    s.async = true; s.charset = 'utf-8';
    s.onload = () => res(window.twttr); s.onerror = rej;
    document.head.appendChild(s);
  });
  return twPromise;
}
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.tl-signal-load');
  if (!btn) return;
  const id = btn.dataset.tweet;
  const wrap = btn.closest('.tl-signal').querySelector('.tl-embed');
  btn.disabled = true; btn.textContent = 'Loading\u2026';
  try {
    const tw = await loadTwitter();
    const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    wrap.innerHTML = '';
    const el = await tw.widgets.createTweet(id, wrap, { theme, conversation: 'none', dnt: true, align: 'center' });
    if (!el) throw new Error('unavailable');
    btn.remove();
  } catch (err) {
    const link = btn.closest('.tl-signal').querySelector('.tl-signal-link');
    const href = link ? link.getAttribute('href') : ('https://x.com/peterxing/status/' + id);
    wrap.innerHTML = '<a class="tl-signal-link" href="' + href + '" target="_blank" rel="noopener">Open on X &rarr;</a>';
    btn.disabled = false; btn.textContent = 'Load live post \u21bb';
  }
});

document.querySelectorAll('[data-domain]').forEach(button => button.addEventListener('click', () => {
  forecastFilters.domain = button.dataset.domain;
  applyForecastFilters();
}));
[
  ['branchFilter','branch'],
  ['probabilityFilter','probability'],
  ['themeFilter','theme'],
].forEach(([id, key]) => document.getElementById(id).addEventListener('change', event => {
  forecastFilters[key] = event.target.value;
  applyForecastFilters();
}));
document.getElementById('changesOnlyToggle').addEventListener('click', event => {
  forecastFilters.changed = event.currentTarget.getAttribute('aria-pressed') !== 'true';
  applyForecastFilters();
});
document.getElementById('filterReset').addEventListener('click', resetForecastFilters);
document.getElementById('atlasSearch').addEventListener('input', event => {
  forecastFilters.query = event.target.value.slice(0, 120);
  applyForecastFilters();
  renderAtlasSearchResults();
});
document.getElementById('atlasSearch').addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    forecastFilters.query = '';
    applyForecastFilters();
    renderAtlasSearchResults();
  } else if (event.key === 'ArrowDown') {
    const first = document.querySelector('#atlasSearchResults .search-result[href]');
    if (first) {
      event.preventDefault();
      first.focus();
    }
  }
});
document.getElementById('searchClear').addEventListener('click', () => {
  forecastFilters.query = '';
  applyForecastFilters();
  renderAtlasSearchResults();
  document.getElementById('atlasSearch').focus();
});
document.getElementById('atlasSearchResults').addEventListener('click', event => {
  const result = event.target.closest('.search-result[href]');
  if (!result) return;
  const chapterIndex = result.dataset.searchChapter;
  if (chapterIndex != null) {
    event.preventDefault();
    window.openReader?.(Number(chapterIndex));
  }
  document.getElementById('atlasSearchResults').hidden = true;
  setTimeout(revealHashTarget, 0);
});
document.addEventListener('click', event => {
  if (event.target.closest('.atlas-search, .atlas-search-results')) return;
  document.getElementById('atlasSearchResults').hidden = true;
});
window.addEventListener('hashchange', revealHashTarget);
updateFilterControls();
document.getElementById('overlayToggle').addEventListener('click', () => {
  overlayOn = !overlayOn;
  document.getElementById('overlaySwitch').classList.toggle('on', overlayOn);
  document.getElementById('overlayToggle').setAttribute('aria-pressed', String(overlayOn));
  document.getElementById('overlayToggle').querySelector('span:last-child').textContent =
    overlayOn ? 'Evidence visible' : 'Evidence hidden';
  document.getElementById('timelineAtlas').classList.toggle('evidence-off', !overlayOn);
});

/* ---------- Six Ds ---------- */
const sixDs = [
  ['Digitised', 'Once intelligence is represented as data, it inherits the exponential. Models, weights and tokens replace handcrafted expertise.'],
  ['Deceptive', 'Early progress looks underwhelming — chatbots that hallucinate — so most people dismiss the curve right before it bends.'],
  ['Disruptive', 'Cheaper, better AI undercuts incumbents: search, coding, translation, tutoring, diagnosis, design — all reorganised.'],
  ['Demonetised', 'The marginal cost of intelligence falls toward zero. What cost a salary now costs an API call.'],
  ['Dematerialised', 'Whole product categories collapse into software — the studio, the office, the call centre, the analyst all fit on a phone.'],
  ['Democratised', 'Finally, the capability is everywhere and cheap. A teenager with a laptop wields what nations once couldn\'t buy.'],
];
document.getElementById('sixDs').innerHTML = sixDs.map((d,i) => `
  <div class="drow">
    <div class="dword"><span>${String(i+1).padStart(2,'0')}</span> &nbsp;${d[0]}</div>
    <div class="ddesc">${d[1]}</div>
  </div>`).join('');

/* ---------- Five Futures, One Portfolio ---------- */
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

/* ---------- Chapters ---------- */
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
document.getElementById('chapters').innerHTML = chapters.map((c,i) => `
  <article class="chapter" data-ch="${c.idx}">
    <button type="button" class="ch-head" aria-expanded="false" aria-controls="chapter-body-${i}">
      <span class="ch-idx">${c.idx}</span>
      <span class="ch-title">${c.title}</span>
      <span class="ch-route" style="color:${c.rc};border-color:${c.rc}">${c.route}</span>
      <svg class="ch-caret" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>
    </button>
    <div class="ch-body" id="chapter-body-${i}" hidden><div class="ch-inner">${c.body}<button class="ch-read" data-open="${i}">Read full chapter →</button></div></div>
  </article>`).join('');
document.querySelectorAll('.chapter .ch-head').forEach(h => h.addEventListener('click', () => {
  const open = h.parentElement.classList.toggle('open');
  h.setAttribute('aria-expanded', String(open));
  h.parentElement.querySelector('.ch-body').hidden = !open;
}));
function openChapter(idx){
  const ch = document.querySelector(`.chapter[data-ch="${idx}"]`);
  if(!ch) return;
  ch.classList.add('open');
  ch.querySelector('.ch-head').setAttribute('aria-expanded', 'true');
  ch.querySelector('.ch-body').hidden = false;
  ch.scrollIntoView({behavior:motionQuery.matches ? 'auto' : 'smooth', block:'center'});
}
document.querySelectorAll('.sysnode').forEach(n => {
  const openSystem = () => {
    const map = { op:1,'01':2,'02':3,'03':4,'04':5,'05':6,'06':7 };
    const idx = map[n.dataset.sys];
    if(idx != null && window.openReader) window.openReader(idx);
  };
  n.addEventListener('click', openSystem);
  n.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openSystem();
    }
  });
});

/* ---------- 1000-Day Moonshot planner ---------- */
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

/* ---------- Reality signals grid ---------- */
/* Inline fallback (shown offline / before signals.json loads). The live site OVERRIDES this hourly from
   signals.json's reality[] — @peterxing's most notable recent real post/repost per theme. */
const realitySignals = [
  { tag:'CODE', t:'Open the latest @peterxing observations on frontier coding agents.', kind:'search', search:'AI coding agents' },
  { tag:'ROBOTS', t:'Open the latest @peterxing observations on humanoid robotics.', kind:'search', search:'humanoid robots' },
  { tag:'ABUNDANCE', t:'Open the latest @peterxing observations on energy and abundance.', kind:'search', search:'energy abundance' },
  { tag:'CAPABILITY', t:'Open the latest @peterxing observations on frontier capability.', kind:'search', search:'frontier AI capability' },
  { tag:'MARKETS', t:'Open the latest @peterxing observations on AI economics and markets.', kind:'search', search:'AI markets economy' },
  { tag:'GOVERNANCE', t:'Open the latest @peterxing observations on AI governance.', kind:'search', search:'AI governance safety' },
];
function realityCard(s, index){
  const tag = htmlText(s.tag || 'SIGNAL');
  const recency = ['week','recent','historical','search'].includes(s.recency) ? s.recency : 'observed';
  let srcHtml;
  if (s.kind === 'search' && s.search){
    const q = encodeURIComponent('from:peterxing ' + s.search);
    srcHtml = `<a class="signal-src signal-src-link" data-recency="search" href="https://x.com/search?q=${q}&src=typed_query&f=live" target="_blank" rel="noopener"><span class="sig-dot"></span>Search latest @peterxing posts &rarr;</a>`;
  } else if (s.id){
    const author = safeXHandle(s.author);
    const tweetId = safeTweetId(s.id);
    const kind = SIG_KIND[s.kind] ? s.kind : 'post';
    const K = SIG_KIND[kind];
    const via = kind !== 'post' ? `${K.icon} @peterxing ${K.verb} &middot; @${author}` : '@peterxing';
    srcHtml = `<a class="signal-src signal-src-link" data-recency="${recency}" href="https://x.com/${author}/status/${tweetId}" target="_blank" rel="noopener"><span class="sig-dot"></span>${via} &middot; ${htmlText(s.date || '')} &rarr;</a>`;
  } else {
    srcHtml = `<div class="signal-src">${htmlText(String(s.src || '').toUpperCase())}</div>`;
  }
  return `
    <article class="card observation-card" data-recency="${recency}">
      <div class="observation-head">
        <div class="card-num">${tag}</div>
        <span class="observation-index">OBS ${String(index + 1).padStart(2, '0')}</span>
      </div>
      <p>${htmlText(s.t)}</p>
      ${srcHtml}
    </article>`;
}
function renderReality(list){
  const grid = document.getElementById('signalsGrid');
  if (!grid || !Array.isArray(list) || !list.length) return;
  grid.innerHTML = list.map(realityCard).join('');
}
renderReality(realitySignals);
setText('realityMeta', 'Offline baseline · live observation metadata loads with signals.json');

/* ---------- Immersive book reader ---------- */
(function(){
  const reader = document.getElementById('reader');
  const rdBody = document.getElementById('rdBody');
  const rdScroll = document.getElementById('rdScroll');
  const rdBar = document.getElementById('rdBar');
  const rdProgress = document.getElementById('rdProgress');
  const rdPrev = document.getElementById('rdPrev');
  const rdNext = document.getElementById('rdNext');
  const rdPrevT = document.getElementById('rdPrevT');
  const rdNextT = document.getElementById('rdNextT');
  const rdToc = document.getElementById('rdToc');
  const source = document.getElementById('bookSource');
  const total = chapters.length;
  let current = -1;
  let lastFocus = null;
  const backgroundNodes = [...document.querySelectorAll('.content > :not(#reader)')];

  rdToc.innerHTML = chapters.map((chapter, index) =>
    `<button type="button" class="rd-toc-item" data-reader-chapter="${index}">
      ${chapter.idx} · ${chapter.title}
    </button>`).join('');

  function chapterContext(chapter){
    if (/1000-Day/i.test(chapter.title)) {
      return { href:'#moonshot', label:'Open the 1000-day planner', note:'Turn this chapter into a concrete starting vector.' };
    }
    if (/Five Futures/i.test(chapter.title)) {
      return { href:'#futures', label:'Open the scenario portfolio', note:'Compare the five futures and adjust the hedge portfolio.' };
    }
    if (chapter.route === 'Risk') {
      return { href:'#post-superintelligence', label:'Inspect the dependency-gated horizon', note:'Separate dated risk from conditional post-superintelligence possibilities.' };
    }
    if (chapter.route === 'Capability') {
      return { href:'#timeline', label:'Return to the dated forecast', note:'Compare capability, deployment, and impact against the 2026–2040 field.' };
    }
    return { href:'#engine', label:'Trace the abundance engine', note:'Connect the chapter’s argument to the six forces already in motion.' };
  }

  function updateBar(){
    const max = rdScroll.scrollHeight - rdScroll.clientHeight;
    const pct = max > 8 ? (rdScroll.scrollTop / max) * 100 : 0;
    rdBar.style.width = Math.max(0, Math.min(100, pct)).toFixed(1) + '%';
  }

  window.openReader = function(n){
    n = Math.max(0, Math.min(total - 1, n | 0));
    const art = source.querySelector('article[data-idx="' + n + '"]');
    if(!art) return;
    if (reader.hidden) lastFocus = document.activeElement;
    current = n;
    const context = chapterContext(chapters[n]);
    rdBody.innerHTML = art.innerHTML + `
      <aside class="reader-context">
        <span class="instrument-label">Contextual instrument</span>
        <p>${context.note}</p>
        <a href="${context.href}" data-reader-context>${context.label} →</a>
      </aside>`;
    rdProgress.textContent = String(n + 1).padStart(2, '0') + ' / ' + total + ' · ' + chapters[n].title;
    rdPrev.disabled = n === 0;
    rdNext.disabled = n === total - 1;
    rdPrevT.textContent = n > 0 ? chapters[n - 1].title : '';
    rdNextT.textContent = n < total - 1 ? chapters[n + 1].title : '';
    rdToc.querySelectorAll('.rd-toc-item').forEach((button, index) => {
      button.classList.toggle('active', index === n);
      if (index === n) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    reader.hidden = false;
    backgroundNodes.forEach(node => { node.inert = true; });
    document.body.style.overflow = 'hidden';
    rdScroll.scrollTop = 0;
    rdBar.style.width = '0%';
    document.getElementById('rdClose').focus();
  };

  function closeReader(){
    reader.hidden = true;
    backgroundNodes.forEach(node => { node.inert = false; });
    document.body.style.overflow = '';
    current = -1;
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
    lastFocus = null;
  }

  rdScroll.addEventListener('scroll', updateBar, { passive: true });
  document.getElementById('rdClose').addEventListener('click', closeReader);
  rdPrev.addEventListener('click', () => { if(current > 0) window.openReader(current - 1); });
  rdNext.addEventListener('click', () => { if(current < total - 1) window.openReader(current + 1); });
  rdToc.addEventListener('click', event => {
    const button = event.target.closest('[data-reader-chapter]');
    if (button) window.openReader(Number(button.dataset.readerChapter));
  });
  rdBody.addEventListener('click', event => {
    if (event.target.closest('[data-reader-context]')) closeReader();
  });
  document.addEventListener('keydown', (e) => {
    if(reader.hidden) return;
    if(e.key === 'Tab') {
      const focusable = [...reader.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter(element => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    } else if(e.key === 'Escape') closeReader();
    else if(e.key === 'ArrowLeft' && current > 0) window.openReader(current - 1);
    else if(e.key === 'ArrowRight' && current < total - 1) window.openReader(current + 1);
  });

  const rb = document.getElementById('readBookBtn');
  if(rb) rb.addEventListener('click', () => window.openReader(0));

  document.getElementById('chapters').addEventListener('click', (e) => {
    const btn = e.target.closest('.ch-read');
    if(!btn) return;
    e.stopPropagation();
    window.openReader(parseInt(btn.dataset.open, 10));
  });
})();

/* ---------- One-shot editorial figure motion ---------- */
(function(){
  const figures = [...document.querySelectorAll('[data-editorial-figure]')];
  if (!figures.length) return;
  if (motionQuery.matches || !('IntersectionObserver' in window)) {
    figures.forEach(figure => figure.classList.add('is-visible'));
    return;
  }
  root.classList.add('figure-motion-ready');
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { rootMargin:'0px 0px -10% 0px', threshold:.12 });
  figures.forEach(figure => {
    figure.addEventListener('focusin', () => {
      figure.classList.add('is-visible');
      observer.unobserve(figure);
    }, { once:true });
    observer.observe(figure);
  });
})();

/* ---------- Reading and forecast position ---------- */
(function(){
  const progress = document.getElementById('pageProgress');
  let progressFrame = 0;
  function updatePageProgress(){
    progressFrame = 0;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const value = max > 0 ? clampNumber(window.scrollY / max, 0, 1) : 0;
    progress.style.transform = `scaleX(${value.toFixed(4)})`;
  }
  function requestProgress(){
    if (!progressFrame) progressFrame = requestAnimationFrame(updatePageProgress);
  }
  window.addEventListener('scroll', requestProgress, { passive:true });
  window.addEventListener('resize', requestProgress, { passive:true });
  updatePageProgress();

  const linkedSections = [...document.querySelectorAll('#timeline, #post-superintelligence, #engine, #futures, #book, #moonshot, #signals, #author')];
  if ('IntersectionObserver' in window) {
    const navObserver = new IntersectionObserver(entries => {
      const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (!visible[0]) return;
      const id = visible[0].target.id;
      const navId = id === 'futures' ? 'engine' : id;
      navLinks.querySelectorAll('a').forEach(link =>
        link.classList.toggle('active', link.getAttribute('href') === '#' + navId));
    }, { rootMargin:'-25% 0px -60% 0px', threshold:[.01, .2, .5] });
    linkedSections.forEach(section => navObserver.observe(section));
  }
})();

/* APP-JS-DONE */
