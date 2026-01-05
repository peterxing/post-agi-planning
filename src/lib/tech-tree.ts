import type { TechTreeNode, TechTreeState, TechTreeStatus } from './types';

export const TECH_TREE_NODES: TechTreeNode[] = [
  {
    id: 'IND-AI-01',
    category: 'individual',
    subcategory: 'Personal AI & Agency',
    title: 'Default AI copilot for most knowledge workers',
    windowStart: { year: 2026, month: 0 },
    windowEnd: { year: 2028, month: 11 },
    indicators: ['% of orgs standardizing AI tools', 'workforce training programs'],
    tags: ['work', 'routines'],
  },
  {
    id: 'IND-AI-02',
    category: 'individual',
    subcategory: 'Personal AI & Agency',
    title: 'Personal AI agent becomes common',
    windowStart: { year: 2027, month: 0 },
    windowEnd: { year: 2030, month: 11 },
    dependsOn: ['IND-AI-01'],
    indicators: ['consumer adoption rates', 'app store rankings'],
    tags: ['morning-planning', 'routines', 'work'],
  },
  {
    id: 'IND-AI-03',
    category: 'individual',
    subcategory: 'Personal AI & Agency',
    title: 'AI-mediated personal knowledgebase (life OS)',
    windowStart: { year: 2028, month: 0 },
    windowEnd: { year: 2033, month: 11 },
    dependsOn: ['IND-AI-02'],
    indicators: ['consumer adoption', 'integration depth'],
    tags: ['morning-planning', 'routines', 'relationships'],
  },
  {
    id: 'IND-AI-04',
    category: 'individual',
    subcategory: 'Personal AI & Agency',
    title: 'Autonomous delegation becomes normal',
    windowStart: { year: 2029, month: 0 },
    windowEnd: { year: 2035, month: 11 },
    dependsOn: ['IND-AI-03', 'GOV-LAW-03'],
    indicators: ['transaction volume', 'legal framework adoption'],
    tags: ['work', 'finance', 'routines'],
  },
  {
    id: 'IND-H-01',
    category: 'individual',
    subcategory: 'Health & Longevity',
    title: 'Continuous health monitoring becomes normal',
    windowStart: { year: 2026, month: 0 },
    windowEnd: { year: 2029, month: 11 },
    indicators: ['wearable adoption', 'insurance integration'],
    tags: ['health', 'privacy'],
  },
  {
    id: 'IND-H-02',
    category: 'individual',
    subcategory: 'Health & Longevity',
    title: 'AI triage & diagnosis becomes first-line',
    windowStart: { year: 2027, month: 0 },
    windowEnd: { year: 2032, month: 11 },
    dependsOn: ['IND-AI-01'],
    indicators: ['regulator approvals', 'malpractice precedents', 'hospital workflows'],
    tags: ['health', 'safety'],
  },
  {
    id: 'IND-H-03',
    category: 'individual',
    subcategory: 'Health & Longevity',
    title: 'Personalized preventive protocol managed by agent',
    windowStart: { year: 2027, month: 0 },
    windowEnd: { year: 2033, month: 11 },
    dependsOn: ['IND-AI-03', 'IND-H-01'],
    indicators: ['outcome studies', 'employer programs'],
    tags: ['meals', 'sleep', 'health'],
  },
  {
    id: 'IND-H-04',
    category: 'individual',
    subcategory: 'Health & Longevity',
    title: 'Gene/cell therapies broaden beyond rare diseases',
    windowStart: { year: 2028, month: 0 },
    windowEnd: { year: 2038, month: 11 },
    indicators: ['approvals', 'pricing', 'reimbursement'],
    tags: ['health', 'family'],
  },
  {
    id: 'IND-H-05',
    category: 'individual',
    subcategory: 'Health & Longevity',
    title: 'Longevity interventions shift to medical standard',
    windowStart: { year: 2032, month: 0 },
    windowEnd: { year: 2045, month: 11 },
    dependsOn: ['IND-H-04'],
    indicators: ['guideline changes', 'lifespan/healthspan stats'],
    tags: ['health', 'family'],
  },
  {
    id: 'IND-HM-01',
    category: 'individual',
    subcategory: 'Home Automation',
    title: 'Household automation: cleaning, laundry, basic chores',
    windowStart: { year: 2026, month: 0 },
    windowEnd: { year: 2030, month: 11 },
    indicators: ['robot vacuum evolution', 'home assistant integration'],
    tags: ['routines'],
  },
  {
    id: 'IND-HM-02',
    category: 'individual',
    subcategory: 'Home Automation',
    title: 'General-purpose home robot becomes plausible',
    windowStart: { year: 2028, month: 0 },
    windowEnd: { year: 2035, month: 11 },
    dependsOn: ['ECO-ROB-02'],
    indicators: ['unit sales', 'subscription labor models', 'safety incidents'],
    tags: ['meals', 'routines', 'relationships'],
  },
  {
    id: 'IND-HM-03',
    category: 'individual',
    subcategory: 'Home Automation',
    title: 'Smart home integration becomes seamless',
    windowStart: { year: 2027, month: 0 },
    windowEnd: { year: 2031, month: 11 },
    indicators: ['protocol standards', 'security incidents'],
    tags: ['privacy', 'routines'],
  },
  {
    id: 'SOC-T-01',
    category: 'society',
    subcategory: 'Transportation',
    title: 'Self-driving cars reach L4 in major cities',
    windowStart: { year: 2026, month: 0 },
    windowEnd: { year: 2032, month: 11 },
    indicators: ['unit shipments', 'enterprise standards'],
    tags: ['commute', 'entertainment', 'work', 'social-life'],
  },
  {
    id: 'SOC-I-01',
    category: 'society',
    subcategory: 'Information',
    title: 'Credential collapse: deepfakes become indistinguishable',
    windowStart: { year: 2026, month: 0 },
    windowEnd: { year: 2029, month: 11 },
    indicators: ['detection failure rates', 'verification demand'],
    tags: ['trust', 'relationships', 'privacy'],
  },
  {
    id: 'ECO-AI-01',
    category: 'economy',
    subcategory: 'Automation & Productivity',
    title: 'AI-native company playbooks dominate startups',
    windowStart: { year: 2026, month: 0 },
    windowEnd: { year: 2030, month: 11 },
    indicators: ['revenue/employee stats', 'VC memos', 'layoffs + newco formation'],
    tags: ['work', 'income-model'],
  },
  {
    id: 'ECO-AI-02',
    category: 'economy',
    subcategory: 'Automation & Productivity',
    title: 'Coding automation crosses critical threshold',
    windowStart: { year: 2028, month: 0 },
    windowEnd: { year: 2032, month: 11 },
    dependsOn: ['IND-AI-02'],
    indicators: ['% of production code written by agents', 'manager of agents roles'],
    tags: ['work', 'income-model'],
  },
  {
    id: 'ECO-AI-03',
    category: 'economy',
    subcategory: 'Automation & Productivity',
    title: 'Research automation accelerates AI progress',
    windowStart: { year: 2029, month: 0 },
    windowEnd: { year: 2035, month: 11 },
    dependsOn: ['ECO-AI-02'],
    indicators: ['automated experiment throughput', 'model improvement rate changes'],
    tags: ['governance', 'politics', 'safety', 'work'],
  },
  {
    id: 'ECO-ROB-01',
    category: 'economy',
    subcategory: 'Physical Automation',
    title: 'Warehouses + delivery become heavily autonomous',
    windowStart: { year: 2026, month: 0 },
    windowEnd: { year: 2032, month: 11 },
    indicators: ['cost curves', 'accident rates', 'labor demand shifts'],
    tags: ['meals', 'routines', 'commute'],
  },
  {
    id: 'ECO-ROB-02',
    category: 'economy',
    subcategory: 'Physical Automation',
    title: 'General-purpose robots economically viable in industries',
    windowStart: { year: 2028, month: 0 },
    windowEnd: { year: 2038, month: 11 },
    dependsOn: ['ECO-AI-02'],
    indicators: ['robot-hours sold', 'insurance frameworks', 'union responses'],
    tags: ['work', 'safety', 'routines'],
  },
  {
    id: 'ECO-ROB-03',
    category: 'economy',
    subcategory: 'Physical Automation',
    title: 'Food system automation: vertical farming / precision fermentation',
    windowStart: { year: 2028, month: 0 },
    windowEnd: { year: 2045, month: 11 },
    indicators: ['cost per calorie', 'regulation', 'consumer acceptance'],
    tags: ['meals', 'health'],
  },
  {
    id: 'ECO-F-01',
    category: 'economy',
    subcategory: 'Money & Markets',
    title: 'Tokenized assets and on-chain settlement expand',
    windowStart: { year: 2026, month: 0 },
    windowEnd: { year: 2034, month: 11 },
    indicators: ['institutional settlement pilots', 'regulatory clarity'],
    tags: ['finance', 'governance'],
  },
  {
    id: 'ECO-F-02',
    category: 'economy',
    subcategory: 'Money & Markets',
    title: 'CBDC or state-backed digital cash becomes mainstream',
    windowStart: { year: 2027, month: 0 },
    windowEnd: { year: 2038, month: 11 },
    indicators: ['rollout milestones', 'privacy guarantees', 'adoption rates'],
    tags: ['privacy', 'finance', 'governance'],
  },
  {
    id: 'ECO-F-03',
    category: 'economy',
    subcategory: 'Money & Markets',
    title: 'New social contract instruments (UBI, wage subsidies)',
    windowStart: { year: 2028, month: 0 },
    windowEnd: { year: 2045, month: 11 },
    dependsOn: ['ECO-AI-02'],
    indicators: ['pilots', 'election platforms', 'fiscal capacity'],
    tags: ['income-model', 'work', 'safety'],
  },
  {
    id: 'ECO-EN-01',
    category: 'economy',
    subcategory: 'Energy & Compute',
    title: 'Grid constraint becomes first-order limiter',
    windowStart: { year: 2026, month: 0 },
    windowEnd: { year: 2032, month: 11 },
    indicators: ['power prices', 'permitting', 'data center siting'],
    tags: ['energy', 'politics'],
  },
  {
    id: 'ECO-EN-02',
    category: 'economy',
    subcategory: 'Energy & Compute',
    title: 'Nuclear buildout and/or SMRs accelerate',
    windowStart: { year: 2026, month: 0 },
    windowEnd: { year: 2040, month: 11 },
    indicators: ['approvals', 'costs', 'deployment rate'],
    tags: ['energy', 'politics'],
  },
  {
    id: 'ECO-EN-03',
    category: 'economy',
    subcategory: 'Energy & Compute',
    title: 'Fusion: pilot plants to early commercial',
    windowStart: { year: 2030, month: 0 },
    windowEnd: { year: 2045, month: 11 },
    indicators: ['net energy milestones', 'financing', 'grid contracts'],
    tags: ['energy', 'politics'],
  },
  {
    id: 'GOV-ID-01',
    category: 'governance',
    subcategory: 'Identity & Civil Infrastructure',
    title: 'Digital ID wallets expand, interoperability fights',
    windowStart: { year: 2026, month: 0 },
    windowEnd: { year: 2032, month: 11 },
    indicators: ['legislation', 'adoption', 'major breaches'],
    tags: ['trust', 'privacy'],
  },
  {
    id: 'GOV-ID-02',
    category: 'governance',
    subcategory: 'Identity & Civil Infrastructure',
    title: 'Proof-of-personhood / anti-bot credentials become normal',
    windowStart: { year: 2027, month: 0 },
    windowEnd: { year: 2035, month: 11 },
    dependsOn: ['GOV-ID-01'],
    indicators: ['platform enforcement', 'black markets for IDs'],
    tags: ['trust', 'relationships', 'politics'],
  },
  {
    id: 'GOV-AI-01',
    category: 'governance',
    subcategory: 'AI Regulation & State Use',
    title: 'Mandatory model audits for frontier systems',
    windowStart: { year: 2026, month: 0 },
    windowEnd: { year: 2032, month: 11 },
    indicators: ['compliance regimes', 'incident reporting'],
    tags: ['safety', 'governance'],
  },
  {
    id: 'GOV-AI-02',
    category: 'governance',
    subcategory: 'AI Regulation & State Use',
    title: 'Compute governance: licensing, reporting, export controls',
    windowStart: { year: 2026, month: 0 },
    windowEnd: { year: 2035, month: 11 },
    indicators: ['chip controls', 'cluster registration', 'enforcement actions'],
    tags: ['politics', 'governance'],
  },
  {
    id: 'GOV-AI-03',
    category: 'governance',
    subcategory: 'AI Regulation & State Use',
    title: 'Government becomes AI operator: benefits, taxes, services automated',
    windowStart: { year: 2027, month: 0 },
    windowEnd: { year: 2038, month: 11 },
    dependsOn: ['IND-AI-02'],
    indicators: ['procurement', 'service KPIs', 'public backlash'],
    tags: ['routines', 'finance', 'governance'],
  },
  {
    id: 'GOV-LAW-01',
    category: 'governance',
    subcategory: 'Law & Liability',
    title: 'AI liability norms emerge (who pays when agents cause harm)',
    windowStart: { year: 2026, month: 0 },
    windowEnd: { year: 2032, month: 11 },
    indicators: ['landmark cases', 'insurance products'],
    tags: ['safety', 'governance'],
  },
  {
    id: 'GOV-LAW-02',
    category: 'governance',
    subcategory: 'Law & Liability',
    title: 'Synthetic media law (consent, likeness, attribution)',
    windowStart: { year: 2026, month: 0 },
    windowEnd: { year: 2033, month: 11 },
    indicators: ['enforcement', 'takedown systems'],
    tags: ['trust', 'relationships'],
  },
  {
    id: 'GOV-LAW-03',
    category: 'governance',
    subcategory: 'Law & Liability',
    title: 'Agent contracts recognized for limited domains',
    windowStart: { year: 2029, month: 0 },
    windowEnd: { year: 2038, month: 11 },
    dependsOn: ['GOV-LAW-01', 'GOV-ID-02'],
    indicators: ['legal precedents', 'contract templates', 'enforcement'],
    tags: ['morning-planning', 'work', 'finance'],
  },
  {
    id: 'GOV-W-01',
    category: 'governance',
    subcategory: 'Welfare & Stability',
    title: 'Automation shock becomes central political issue',
    windowStart: { year: 2027, month: 0 },
    windowEnd: { year: 2035, month: 11 },
    dependsOn: ['ECO-AI-02'],
    indicators: ['unemployment/underemployment', 'strikes', 'populism'],
    tags: ['work', 'safety', 'governance'],
  },
  {
    id: 'GOV-W-02',
    category: 'governance',
    subcategory: 'Welfare & Stability',
    title: 'Redistribution mechanism chosen (UBI vs job guarantees)',
    windowStart: { year: 2028, month: 0 },
    windowEnd: { year: 2045, month: 11 },
    dependsOn: ['GOV-W-01', 'ECO-F-03'],
    indicators: ['policy adoption', 'funding mechanisms', 'outcomes'],
    tags: ['income-model', 'routines', 'family'],
  },
  {
    id: 'GOV-S-01',
    category: 'governance',
    subcategory: 'Surveillance & Security',
    title: 'Surveillance expands via AI (cameras, finance, comms)',
    windowStart: { year: 2026, month: 0 },
    windowEnd: { year: 2045, month: 11 },
    indicators: ['procurement', 'lawful access debates'],
    tags: ['privacy', 'safety'],
  },
  {
    id: 'GOV-S-02',
    category: 'governance',
    subcategory: 'Surveillance & Security',
    title: 'Cybersecurity becomes partially autonomous',
    windowStart: { year: 2026, month: 0 },
    windowEnd: { year: 2034, month: 11 },
    dependsOn: ['IND-AI-02'],
    indicators: ['defense systems deployed', 'offensive capabilities'],
    tags: ['safety', 'politics'],
  },
  {
    id: 'GEO-P-01',
    category: 'geopolitics',
    subcategory: 'Great Power Competition',
    title: 'AI capability becomes explicit national power metric',
    windowStart: { year: 2026, month: 0 },
    windowEnd: { year: 2032, month: 11 },
    indicators: ['national compute programs', 'industrial policy'],
    tags: ['governance', 'safety'],
  },
  {
    id: 'GEO-P-02',
    category: 'geopolitics',
    subcategory: 'Great Power Competition',
    title: 'Compute blocs form (aligned supply chains)',
    windowStart: { year: 2027, month: 0 },
    windowEnd: { year: 2035, month: 11 },
    dependsOn: ['GEO-P-01'],
    indicators: ['alliance agreements', 'export-control harmonization'],
    tags: ['governance', 'politics'],
  },
  {
    id: 'GEO-C-01',
    category: 'geopolitics',
    subcategory: 'Conflict & Deterrence',
    title: 'Drone/robot warfare diffusion accelerates',
    windowStart: { year: 2026, month: 0 },
    windowEnd: { year: 2035, month: 11 },
    indicators: ['battlefield footage', 'procurement', 'treaty attempts'],
    tags: ['safety', 'politics'],
  },
  {
    id: 'GEO-C-02',
    category: 'geopolitics',
    subcategory: 'Conflict & Deterrence',
    title: 'AI-accelerated cyber conflict becomes chronic',
    windowStart: { year: 2026, month: 0 },
    windowEnd: { year: 2045, month: 11 },
    dependsOn: ['GOV-S-02'],
    indicators: ['incident frequency', 'attribution challenges'],
    tags: ['safety', 'politics'],
  },
  {
    id: 'GEO-C-03',
    category: 'geopolitics',
    subcategory: 'Conflict & Deterrence',
    title: 'AI incident becomes geopolitical crisis class',
    windowStart: { year: 2026, month: 0 },
    windowEnd: { year: 2035, month: 11 },
    indicators: ['emergency summits', 'hotline creation'],
    tags: ['trust', 'safety', 'governance'],
  },
  {
    id: 'GEO-CD-01',
    category: 'geopolitics',
    subcategory: 'Coordination & Controls',
    title: 'Partial frontier AI treaties (testing, reporting)',
    windowStart: { year: 2028, month: 0 },
    windowEnd: { year: 2040, month: 11 },
    dependsOn: ['GEO-C-03', 'GOV-AI-01'],
    indicators: ['verification schemes', 'signatories', 'compliance'],
    tags: ['governance', 'safety', 'politics'],
  },
  {
    id: 'GEO-CL-01',
    category: 'geopolitics',
    subcategory: 'Resources & Migration',
    title: 'Climate disasters reshape geopolitics',
    windowStart: { year: 2026, month: 0 },
    windowEnd: { year: 2045, month: 11 },
    indicators: ['commodity spikes', 'migration', 'failed infrastructure'],
    tags: ['meals', 'safety', 'governance'],
  },
  {
    id: 'GEO-S-01',
    category: 'geopolitics',
    subcategory: 'Space as Strategic Domain',
    title: 'Space infrastructure grows (mega-constellations)',
    windowStart: { year: 2026, month: 0 },
    windowEnd: { year: 2035, month: 11 },
    indicators: ['launches', 'debris events', 'military doctrines'],
    tags: ['governance', 'politics'],
  },
  {
    id: 'GEO-S-02',
    category: 'geopolitics',
    subcategory: 'Space as Strategic Domain',
    title: 'Space security regime: debris enforcement / anti-sat norms',
    windowStart: { year: 2030, month: 0 },
    windowEnd: { year: 2045, month: 11 },
    indicators: ['treaties', 'enforcement mechanisms'],
    tags: ['safety', 'politics'],
  },
];

export function getNodesActiveInMonth(year: number, month: number): TechTreeNode[] {
  return TECH_TREE_NODES.filter((node) => {
    const isAfterStart =
      year > node.windowStart.year ||
      (year === node.windowStart.year && month >= node.windowStart.month);
    const isBeforeEnd =
      year < node.windowEnd.year ||
      (year === node.windowEnd.year && month <= node.windowEnd.month);
    return isAfterStart && isBeforeEnd;
  });
}

export function getNodesUpToMonth(upToYear: number, upToMonth: number): TechTreeNode[] {
  const startedBefore = TECH_TREE_NODES.filter((node) => {
    return (
      node.windowStart.year < upToYear ||
      (node.windowStart.year === upToYear && node.windowStart.month <= upToMonth)
    );
  });

  startedBefore.sort((a, b) => {
    if (a.windowStart.year !== b.windowStart.year) {
      return a.windowStart.year - b.windowStart.year;
    }
    return a.windowStart.month - b.windowStart.month;
  });

  return startedBefore;
}

export function getAllNodesGroupedByCategory() {
  const grouped: Record<string, TechTreeNode[]> = {
    individual: [],
    society: [],
    economy: [],
    governance: [],
    geopolitics: [],
  };

  TECH_TREE_NODES.forEach((node) => {
    grouped[node.category].push(node);
  });

  return grouped;
}

export function getCumulativeTechNodes(year: number, month: number): TechTreeNode[] {
  return getNodesUpToMonth(year, month);
}

const toMonthIndex = (year: number, month: number) => year * 12 + month;

export function getNodeStatusForDate(
  states: TechTreeState[] | undefined,
  nodeId: string,
  year: number,
  month: number,
  fallback: TechTreeStatus = 'not-started'
): TechTreeStatus {
  const targetIndex = toMonthIndex(year, month);

  const applicableStates = (states || []).filter((state) => {
    if (state.nodeId !== nodeId) return false;
    if (state.effectiveYear == null || state.effectiveMonth == null) return true;

    return toMonthIndex(state.effectiveYear, state.effectiveMonth) <= targetIndex;
  });

  if (!applicableStates.length) return fallback;

  const latest = applicableStates.sort((a, b) => {
    const aIndex =
      a.effectiveYear == null || a.effectiveMonth == null
        ? -Infinity
        : toMonthIndex(a.effectiveYear, a.effectiveMonth);
    const bIndex =
      b.effectiveYear == null || b.effectiveMonth == null
        ? -Infinity
        : toMonthIndex(b.effectiveYear, b.effectiveMonth);

    if (aIndex !== bIndex) return aIndex - bIndex;
    return (a.updatedAt || 0) - (b.updatedAt || 0);
  })[applicableStates.length - 1];

  return latest.status;
}
