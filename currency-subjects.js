// currency-subjects.js — the curated subject gate for the currency layer.
//
// WHY THIS FILE EXISTS
//
// The first two matcher generations scored candidates lexically: shared tokens, then
// IDF-weighted shared tokens. Both produced keyword COLLISIONS rather than relevance —
// a career-advice article topped five predictions, a post about AI figure generation was
// the best match for a vertebrate connectome because both contained "peer review", and a
// grid-modernisation course matched Kardashev energy scaling because both said "power".
//
// Statistics cannot fix that, because the failure is semantic, not distributional. An
// article is relevant when it is ABOUT the prediction's subject entity. So the gate is
// hand-curated: each prediction declares the distinctive subjects that an article must
// actually be about. Generic tokens (ai, model, agent, compute, energy, power, review,
// research, safety, data, system) are on a hard banlist and contribute exactly zero — they
// cannot satisfy the gate and they cannot add score.
//
// A candidate that matches no curated subject is INADMISSIBLE at any score. Low coverage
// is the correct outcome for predictions with no genuine recent coverage; an empty slot is
// strictly better than a plausible-looking collision on a public forecast.
//
// Matching is case-insensitive substring matching against the candidate's title and
// summary. Multi-word subjects are preferred because they are far harder to collide with;
// single-word subjects appear here only where the word is itself distinctive (connectome,
// humanoid, kardashev, ruliad, intracortical, terawatt).

/*
 * Tokens that can never satisfy the gate and never score. These are the exact words that
 * produced the observed collisions.
 */
const GENERIC_BANLIST = new Set([
  'ai', 'artificial', 'intelligence', 'model', 'models', 'agent', 'agents', 'agentic',
  'compute', 'computing', 'computer', 'research', 'researcher', 'researchers', 'safety',
  'safe', 'energy', 'power', 'review', 'reviews', 'data', 'system', 'systems', 'technology',
  'tech', 'human', 'humans', 'work', 'working', 'worker', 'workers', 'labor', 'labour',
  'new', 'study', 'studies', 'learning', 'machine', 'neural', 'network', 'networks',
  'training', 'train', 'tool', 'tools', 'use', 'using', 'team', 'science', 'scientific',
  'scientists', 'report', 'world', 'global', 'future', 'digital', 'online', 'company',
  'companies', 'industry', 'market', 'government', 'policy', 'law', 'rules', 'regulation',
  'peer', 'solar', 'space', 'control', 'home', 'move', 'live', 'thousands', 'self',
  'support', 'clinical', 'patients', 'patient', 'quality', 'complete', 'require',
]);

/*
 * Curated subjects per prediction. The key is the same `<year>-<index>` / `horizon-<id>`
 * identifier used by the evidence ledger, so a drift against predictions.json is a hard
 * validation failure rather than a silent mismatch.
 */
const SUBJECTS = {
  // ---- 2026 --------------------------------------------------------------------------
  '2026-0': ['computer-use agent', 'computer use agent', 'task horizon', 'long-horizon', 'long horizon task', 'autonomous coding', 'agent benchmark', 'metr', 'multi-hour task', 'agent reliability'],
  '2026-1': ['ai r&d', 'research compute', 'compute allocation', 'internal deployment', 'automating ai research', 'ai for ai research'],
  '2026-2': ['trillion', 'valuation', 'market capitalisation', 'market capitalization', 'funding round', 'lobbying', 'political influence'],
  '2026-3': ['humanoid', 'factory line', 'production line', 'optimus', 'unitree', 'figure ai', 'robot deployment', 'assembly line'],
  '2026-4': ['release review', 'preparedness framework', 'responsible scaling', 'frontier safety framework', 'ai act', 'pre-deployment evaluation', 'pre-deployment testing', 'dangerous capability evaluation', 'bioweapon uplift', 'cyber capability evaluation'],
  '2026-5': ['compute tracking', 'compute governance', 'chip tracking', 'location verification', 'on-chip', 'hardware-enabled mechanism', 'export control', 'chip smuggling'],
  '2026-6': ['artificial general intelligence', 'human-level ai', 'agi timeline', 'agi arrival', 'superintelligence'],
  '2026-7': ['intracortical', 'brain-computer interface', 'brain–computer interface', 'brain computer interface', 'neuralink', 'braingate', 'speech neuroprosthes', 'cursor control', 'neural implant', 'implanted electrode'],
  '2026-8': ['orbital data cent', 'orbital compute', 'data cent in space', 'space data cent', 'space-based compute', 'satellite gpu', 'starcloud', 'compute in orbit'],

  // ---- 2027 --------------------------------------------------------------------------
  '2027-0': ['digital labor', 'digital labour', 'agent revenue', 'annualized revenue', 'annualised revenue', 'revenue run rate', 'agent workforce', 'paid agent'],
  '2027-1': ['ai-written code', 'ai-generated code', 'share of code', 'software engineering agent', 'swe-bench', 'coding agent', 'code generation', 'copilot'],
  '2027-2': ['ai research automation', 'automating ai research', 'research acceleration', 'ai-generated research', 'recursive self-improvement', 'self-improving'],
  '2027-3': ['workforce redesign', 'business model disruption', 'enterprise adoption', 'job displacement', 'occupational exposure', 'reskilling'],
  // Jurisdiction is load-bearing here: the prediction is about UNITED STATES legislative
  // progress, so EU AI Act enforcement is a comparable development, not evidence the US
  // claim is on track. Every subject term therefore names the US polity explicitly.
  '2027-4': ['congress', 'senate', 'house of representatives', 'federal ai law', 'us ai legislation', 'american ai act', 'white house executive order', 'federal preemption'],
  '2027-5': ['data cent', 'grid capacity', 'interconnection queue', 'electricity demand', 'water usage', 'power purchase agreement', 'transmission constraint', 'grid operator'],

  // ---- 2028 --------------------------------------------------------------------------
  '2028-0': ['election', 'campaign', 'voters', 'ballot', 'electorate'],
  // Real labour-market coverage says "layoffs", "job cuts" and "hiring"; it does not say
  // "employment survey". The AI qualifier is kept on the generic terms so an ordinary
  // corporate layoff story cannot satisfy this — only AI-attributed workforce change can.
  '2028-1': ['white-collar', 'white collar', 'occupation', 'labor market', 'labour market', 'employment survey', 'supervising ai', 'job task', 'ai leads for', 'ai-attributed job cuts', 'job cuts', 'layoffs', 'workforce reduction', 'challenger report'],
  '2028-2': ['expert interview', 'training environment', 'rl environment', 'domain expert', 'professional benchmark', 'reinforcement learning environment'],
  '2028-3': ['export control', 'chip ban', 'concentration of power', 'national champion', 'state control', 'chip restriction'],
  '2028-4': ['capital expenditure', 'capex', 'data cent', 'defense budget', 'defence budget', 'construction commitment'],
  '2028-5': ['superintelligence', 'recursive self-improvement', 'intelligence explosion', 'takeoff'],
  '2028-6': ['international negotiation', 'treaty', 'compute audit', 'multilateral', 'ai summit', 'governance regime', 'international agreement'],
  '2028-7': ['connectome', 'connectomics', 'synapse-resolution', 'whole-brain map', 'zebrafish', 'drosophila', 'electron microscopy reconstruction', 'neural circuit reconstruction'],

  // ---- 2029 --------------------------------------------------------------------------
  '2029-0': ['cognitive labor', 'cognitive labour', 'labor input', 'labour input', 'productivity statistics', 'share of tasks'],
  '2029-1': ['us-china', 'u.s.-china', 'china talks', 'compute declaration', 'inspection', 'training limit', 'bilateral talks'],
  '2029-2': ['training pause', 'moratorium', 'halt training', 'pause frontier', 'training run limit'],
  '2029-3': ['inference-only', 'verification hardware', 'confidential computing', 'attestation', 'trusted execution', 'hardware verification'],
  '2029-4': ['multilateral', 'treaty framework', 'international agency', 'consortium', 'international body'],
  '2029-5': ['ai dividend', 'sovereign wealth', 'compute rent', 'tax base', 'windfall tax', 'revenue erosion'],
  '2029-6': ['market volatility', 'selloff', 'sell-off', 'polarization', 'polarisation', 'political backlash'],

  // ---- 2030 --------------------------------------------------------------------------
  '2030-0': ['fully automated research', 'ai research automation', 'automated ai r&d', 'self-improving', 'automating ai research'],
  '2030-1': ['superintelligence', 'top human expert', 'expert-level ai', 'superhuman ai'],
  '2030-2': ['research transparency', 'cross-border verification', 'resume training', 'transparency regime'],
  // "open weights" alone is satisfiable by any product launch that ships open weights, which
  // is how an NVIDIA text-to-speech blog became the top match here. The load-bearing claim is
  // GOVERNANCE of weights, so each phrase names a policy or audit stance rather than a release.
  '2030-3': ['algorithmic audit', 'auditability', 'weight security', 'weight governance', 'position on open-weight', 'open-weight policy', 'open weights models', 'frontier model governance', 'model weight controls', 'secure model weights', 'weight exfiltration'],
  '2030-4': ['ai-designed drug', 'ai-discovered drug', 'drug approval', 'fda approval', 'clinical trial', 'alphafold', 'de novo design', 'generative chemistry', 'molecule design'],
  '2030-5': ['manufacturing capacity', 'supply chain bottleneck', 'industrial capacity', 'robotics bottleneck', 'production constraint'],

  // ---- 2031 --------------------------------------------------------------------------
  '2031-0': ['research speedup', 'research productivity', 'discovery rate', 'acceleration of science', 'scientific throughput'],
  '2031-1': ['cognitive labor', 'cognitive labour', 'physical labor', 'physical labour', 'robot density', 'automation share'],
  '2031-2': ['annual revenue', 'revenue run rate', 'government budget', 'gdp comparison'],
  '2031-3': ['safety case', 'external review', 'third-party audit', 'assurance argument', 'independent evaluation'],
  // Written in NEWS vocabulary, not forecast vocabulary. Real coverage of this subject says
  // "malicious code", "real-world incidents" and "cybersecurity evaluations"; it does not say
  // "sandbox-escape". Every phrase still names agent misbehaviour specifically, so a routine
  // security product launch cannot satisfy it.
  '2031-4': ['sandbox escape', 'circumvention', 'sabotage', 'deceptive behavior', 'deceptive behaviour', 'scheming', 'unsanctioned', 'incident report', 'specification gaming', 'reward hacking', 'exfiltration', 'social engineer', 'jailbreak', 'malicious code', 'real-world incident', 'cybersecurity evaluation', 'agent misbehaviour', 'agent misbehavior', 'attacked real', 'unsanctioned action'],
  '2031-5': ['continual learning', 'online learning', 'post-deployment update', 'model drift', 'continuous learning'],

  // ---- 2032 --------------------------------------------------------------------------
  '2032-0': ['cognitive labor', 'cognitive labour', 'labor share', 'labour share', 'automation crossover'],
  '2032-1': ['humanoid', 'robot deployment', 'physical task', 'manipulation benchmark', 'warehouse robot', 'industrial robot', 'dexterous manipulation'],
  '2032-2': ['gdp growth', 'economic growth', 'growth rate'],
  '2032-3': ['actuator', 'fab construction', 'mining investment', 'rare earth', 'capital expenditure', 'factory investment'],
  '2032-4': ['compute cap', 'compute quota', 'permit', 'auction', 'licensing regime'],
  '2032-5': ['robot tax', 'compute tax', 'tax reform', 'capital tax', 'tax base'],

  // ---- 2033 --------------------------------------------------------------------------
  '2033-0': ['economic output', 'value added', 'labor share', 'labour share'],
  '2033-1': ['basic income', 'citizen dividend', 'cash transfer', 'guaranteed income'],
  '2033-2': ['wealth distribution', 'development finance', 'global south', 'redistribution'],
  '2033-3': ['persuasion', 'influence operation', 'targeted advertising', 'disclosure requirement', 'manipulation'],
  '2033-4': ['personal assistant', 'ai advisor', 'search interface', 'recommendation feed', 'personalized assistant'],
  '2033-5': ['doubling time', 'economic doubling', 'explosive growth'],
  '2033-6': ['biodefense', 'biodefence', 'biosecurity', 'pathogen surveillance', 'wastewater surveillance', 'rapid vaccine', 'pandemic preparedness'],

  // ---- 2034 --------------------------------------------------------------------------
  '2034-0': ['semiconductor', 'chip design', 'lithography', 'process node', 'eda tool', 'foundry'],
  '2034-1': ['agent fleet', 'concurrent agents', 'inference capacity', 'agent population'],
  '2034-2': ['terawatt', 'gigawatt', 'installed compute', 'h100', 'gpu shipment', 'electricity consumption'],
  '2034-3': ['compute cap', 'arms control', 'mutually assured', 'deterrence'],
  '2034-4': ['offshore data cent', 'neutral jurisdiction', 'sovereign data cent', 'floating data cent', 'undersea data cent'],
  '2034-5': ['autonomous weapon', 'military ai', 'arms control treaty', 'lethal autonomous'],

  // ---- 2035 --------------------------------------------------------------------------
  '2035-0': ['top human expert', 'expert-level', 'superhuman performance', 'benchmark saturation'],
  '2035-1': ['capability pause', 'halt scaling', 'control problem', 'scalable oversight'],
  '2035-2': ['labor share', 'labour share', 'task automation', 'employment share'],
  '2035-3': ['universal basic income', 'universal high income', 'permanent dividend'],
  '2035-4': ['persuasion', 'influence operation', 'international control'],
  '2035-5': ['ai welfare', 'model welfare', 'legal personhood', 'ai rights', 'moral status'],
  '2035-6': ['mechanistic interpretability', 'interpretability', 'sparse autoencoder', 'circuit analysis', 'deception detection', 'linear probe'],

  // ---- 2036 --------------------------------------------------------------------------
  '2036-0': ['installed base', 'robot population', 'agent population'],
  '2036-1': ['task coverage', 'task automation', 'automation of tasks'],
  '2036-2': ['employment rate', 'employment-population', 'unemployment', 'labor force participation', 'labour force participation'],
  '2036-3': ['gdp growth', 'explosive growth'],
  '2036-4': ['commodity price', 'land value', 'resource scarcity', 'critical mineral'],
  '2036-5': ['civic participation', 'ownership stake', 'shareholder', 'voting power'],
  '2036-6': ['curriculum', 'education reform', 'lifelong learning'],

  // ---- 2037 --------------------------------------------------------------------------
  '2037-0': ['scientific discovery', 'research productivity', 'ai for science', 'automated science', 'self-driving lab'],
  '2037-1': ['ai-discovered drug', 'ai-designed drug', 'ai-driven discovery', 'ai-designed molecule', 'machine-learning drug discovery', 'fusion net energy', 'fusion power plant'],
  '2037-2': ['privacy-preserving', 'zero-knowledge', 'differential privacy', 'secure multiparty', 'homomorphic'],
  '2037-3': ['lie detection', 'deception detection', 'polygraph', 'truthfulness'],
  '2037-4': ['paradigm shift', 'scientific revolution', 'political realignment'],
  '2037-5': ['verification protocol', 'zero-knowledge', 'treaty compliance', 'inspection regime'],

  // ---- 2038 --------------------------------------------------------------------------
  '2038-0': ['alignment research', 'value formation', 'goal misgeneralization', 'goal misgeneralisation', 'experimental alignment'],
  '2038-1': ['interpretability', 'chain of thought', 'faithfulness', 'reasoning trace'],
  '2038-2': ['honesty', 'obedience', 'corrigibility', 'constitutional ai', 'character training'],
  '2038-3': ['autonomous organization', 'autonomous organisation', 'ai judge', 'algorithmic governance', 'ai-run'],
  '2038-4': ['safety spending', 'alignment funding', 'research budget'],
  '2038-5': ['capability pause', 'handoff', 'irreversible'],

  // ---- 2039 --------------------------------------------------------------------------
  '2039-0': ['ai advisor', 'decision support', 'institutional adoption'],
  '2039-1': ['safety case', 'independent evaluation', 'assurance argument'],
  '2039-2': ['decision authority', 'delegation', 'autonomous decision'],
  '2039-3': ['universal high income', 'dividend payment'],
  '2039-4': ['orbital data cent', 'orbital compute', 'space data cent', 'megawatt in orbit', 'radiator', 'space-based solar power', 'compute in orbit'],
  '2039-5': ['compute cap', 'handoff negotiation', 'loosen restrictions'],

  // ---- 2040 --------------------------------------------------------------------------
  '2040-0': ['full automation', 'all human labor', 'all human labour', 'complete automation'],
  '2040-1': ['lift the pause', 'superhuman ai', 'scaling resumption'],
  '2040-2': ['critical infrastructure', 'kill switch', 'shutdown', 'systemic dependency'],

  // ---- Post-superintelligence horizon -------------------------------------------------
  // These seven are deliberately undated and deliberately hard to support. A currency link
  // attaches only when the article is squarely about that specific horizon, never merely
  // about an adjacent technology.
  // Invasiveness is LOAD-BEARING on both neural horizon items, so a non-invasive EEG study
  // must not be admissible here and an intracortical result must not be admissible there.
  // Without this split a scalp-EEG motor-imagery paper matched the IMPLANTABLE horizon.
  'horizon-implantable-neural-symbiosis': ['intracortical', 'neuralink', 'neural implant', 'implanted electrode', 'neuroprosthes', 'cortical implant', 'braingate', 'implanted brain-computer interface', 'invasive brain-computer interface'],
  'horizon-non-invasive-neural-symbiosis': ['non-invasive brain', 'noninvasive brain', 'non-invasive neural', 'eeg', 'magnetoencephalograph', 'fnirs', 'functional ultrasound', 'wearable brain', 'scalp recording', 'motor imagery'],
  'horizon-whole-brain-emulation-and-uploading': ['whole-brain emulation', 'whole brain emulation', 'mind uploading', 'brain emulation', 'connectome', 'brain preservation', 'digital mind'],
  'horizon-orbital-compute-to-proto-dyson': ['dyson', 'orbital data cent', 'orbital compute', 'space-based solar power', 'in-space manufacturing', 'space manufacturing', 'asteroid mining', 'self-replicating'],
  'horizon-kardashev-energy-scaling': ['kardashev', 'space-based solar power', 'civilizational energy', 'civilisational energy', 'type i civilization', 'energy capture'],
  'horizon-transcension-hypothesis': ['transcension', 'seti', 'femtotechnology', 'landauer', 'reversible computing', 'computational density', 'black hole computer'],
  'horizon-ruliad-testable-physics': ['ruliad', 'wolfram physics', 'hypergraph', 'computational irreducibility', 'discrete spacetime'],
};

/*
 * A single article may back at most this many predictions. Eight was prima facie evidence
 * of a keyword collision rather than genuine multi-prediction relevance.
 */
const CURRENCY_REUSE_CEILING = 3;

/* A subject phrase must survive the banlist to count. */
function admissibleSubject(subject) {
  const words = String(subject).toLowerCase().split(/[^a-z0-9&+–-]+/).filter(Boolean);
  if (!words.length) return false;
  return words.some(word => !GENERIC_BANLIST.has(word));
}

/*
 * Score a candidate against one prediction's curated subjects. Returns null when the
 * candidate matches no subject at all — inadmissible at any score.
 */
function subjectScore(predictionId, title, summary) {
  const subjects = SUBJECTS[predictionId];
  if (!subjects) return null;
  const lowerTitle = String(title || '').toLowerCase();
  const lowerBody = `${lowerTitle} ${String(summary || '').toLowerCase()}`;
  const matched = [];
  let value = 0;
  for (const subject of subjects) {
    if (!admissibleSubject(subject)) continue;
    const needle = subject.toLowerCase();
    const inTitle = lowerTitle.includes(needle);
    const inBody = lowerBody.includes(needle);
    if (!inBody) continue;
    const words = needle.split(/\s+/).length;
    // Multi-word subjects are much harder to collide with, and a title match means the
    // article is about the subject rather than mentioning it in passing.
    const weight = (words >= 2 ? 4 + words : 3) * (inTitle ? 2 : 1);
    value += weight;
    matched.push(`${subject}${inTitle ? '*' : ''}`);
  }
  if (!matched.length) return null;
  return { value, matched };
}

module.exports = {
  CURRENCY_REUSE_CEILING,
  GENERIC_BANLIST,
  SUBJECTS,
  admissibleSubject,
  subjectScore,
};
