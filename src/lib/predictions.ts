import type { Domain, Prediction, MonthData, PredictionSource } from './types';

export const DOMAIN_COLORS: Record<Domain, string> = {
  individual: 'oklch(0.70 0.18 60)',
  social: 'oklch(0.68 0.17 20)',
  tech: 'oklch(0.65 0.22 230)',
  economic: 'oklch(0.72 0.16 145)',
  geopolitical: 'oklch(0.58 0.21 25)',
  governance: 'oklch(0.55 0.20 295)',
};

export const DOMAIN_LABELS: Record<Domain, string> = {
  individual: 'Individual',
  social: 'Social',
  tech: 'Technology',
  economic: 'Economic',
  geopolitical: 'Geopolitical',
  governance: 'Governance',
};

export function getMonthName(month: number): string {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];
  return months[month];
}

const RAW_PREDICTIONS: Prediction[] = [
  {
    id: 'tech-2026-01-1',
    domain: 'tech',
    month: 0,
    year: 2026,
    probability: 0.78,
    title: 'AR glasses achieve mainstream form factor',
    description: 'Lightweight AR devices from Apple, Meta reach consumer-friendly designs.',
    impact: 'high',
    sources: [
      { name: 'Consumer Electronics Trends', confidence: 0.75 },
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2026.htm', confidence: 0.81 },
    ],
  },
  {
    id: 'individual-2026-02-1',
    domain: 'individual',
    month: 1,
    year: 2026,
    probability: 0.71,
    title: 'Personalized nutrition via microbiome analysis',
    description: 'Gut sequencing enables customized diet plans for optimal health.',
    impact: 'medium',
    sources: [
      { name: 'Nutritional Science Report', confidence: 0.68 },
      { name: 'Precision Medicine Institute', confidence: 0.74 },
    ],
  },
  {
    id: 'tech-2026-03-1',
    domain: 'tech',
    month: 2,
    year: 2026,
    probability: 0.84,
    title: 'Autonomous taxis approved in 20+ cities',
    description: 'Self-driving vehicles receive regulatory approval for unsupervised operation.',
    impact: 'high',
    sources: [
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2026.htm', confidence: 0.87 },
      { name: 'Automotive Regulation Report', confidence: 0.81 },
    ],
  },
  {
    id: 'geopolitical-2026-04-1',
    domain: 'geopolitical',
    month: 3,
    year: 2026,
    probability: 0.77,
    title: 'Arctic territorial disputes intensify',
    description: 'Melting ice triggers competing claims over shipping routes and resources.',
    impact: 'medium',
    sources: [
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2026.htm', confidence: 0.80 },
      { name: 'Geopolitical Risk Assessment', confidence: 0.74 },
    ],
  },
  {
    id: 'social-2026-05-1',
    domain: 'social',
    month: 4,
    year: 2026,
    probability: 0.73,
    title: 'Vertical farms supply 15% of urban produce',
    description: 'Indoor agriculture matures to provide significant fresh vegetables.',
    impact: 'medium',
    sources: [
      { name: 'Agricultural Technology Report', confidence: 0.70 },
      { name: 'Urban Farming Institute', confidence: 0.76 },
    ],
  },
  {
    id: 'economic-2026-06-1',
    domain: 'economic',
    month: 5,
    year: 2026,
    probability: 0.69,
    title: 'UBI pilots expand to 30+ major cities',
    description: 'Universal Basic Income experiments proliferate globally.',
    impact: 'high',
    sources: [
      { name: 'Economic Policy Institute', confidence: 0.66 },
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2026.htm', confidence: 0.72 },
    ],
  },
  {
    id: 'social-2026-07-1',
    domain: 'social',
    month: 6,
    year: 2026,
    probability: 0.74,
    title: 'Four-day workweek adopted by 500+ major companies',
    description: 'Major corporations implement permanent shorter work weeks.',
    impact: 'medium',
    sources: [
      { name: 'Future of Work Institute', confidence: 0.71 },
      { name: 'Corporate Trend Analysis', confidence: 0.77 },
    ],
  },
  {
    id: 'tech-2026-07-1',
    domain: 'tech',
    month: 6,
    year: 2026,
    probability: 0.79,
    title: 'Lab-grown meat reaches price parity',
    description: 'Cultured meat matches or undercuts conventional meat prices.',
    impact: 'high',
    sources: [
      { name: 'Alternative Protein Report', confidence: 0.76 },
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2026.htm', confidence: 0.82 },
    ],
  },
  {
    id: 'governance-2026-08-1',
    domain: 'governance',
    month: 7,
    year: 2026,
    probability: 0.72,
    title: 'Deepfake detection mandated for social media',
    description: 'Jurisdictions require AI-generated content detection and labeling.',
    impact: 'medium',
    sources: [
      { name: 'Digital Policy Institute', confidence: 0.69 },
      { name: 'Tech Regulation Tracker', confidence: 0.75 },
    ],
  },
  {
    id: 'tech-2026-09-1',
    domain: 'tech',
    month: 8,
    year: 2026,
    probability: 0.76,
    title: 'First commercial quantum computer sold',
    description: 'Quantum computing reaches commercial viability for specialized problems.',
    impact: 'high',
    sources: [
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2026.htm', confidence: 0.73 },
      { name: 'Quantum Technology Roadmap', confidence: 0.79 },
    ],
  },
  {
    id: 'individual-2026-10-1',
    domain: 'individual',
    month: 9,
    year: 2026,
    probability: 0.68,
    title: 'AI therapy assistants complement human counselors',
    description: 'Mental health AI provides 24/7 support between therapy sessions.',
    impact: 'medium',
    sources: [
      { name: 'Mental Health Tech Report', confidence: 0.65 },
      { name: 'Clinical Psychology Review', confidence: 0.71 },
    ],
  },
  {
    id: 'governance-2026-11-1',
    domain: 'governance',
    month: 10,
    year: 2026,
    probability: 0.64,
    title: 'Blockchain voting used in major election',
    description: 'Democracy conducts binding national election using blockchain system.',
    impact: 'medium',
    sources: [
      { name: 'Digital Democracy Research', confidence: 0.61 },
      { name: 'Electoral Technology Forecast', confidence: 0.67 },
    ],
  },
  {
    id: 'individual-2026-12-1',
    domain: 'individual',
    month: 11,
    year: 2026,
    probability: 0.77,
    title: 'Personalized genomic medicine becomes standard',
    description: 'DNA sequencing under $50 makes personalized treatments routine.',
    impact: 'high',
    sources: [
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2026.htm', confidence: 0.80 },
      { name: 'Genomics Industry Report', confidence: 0.74 },
    ],
  },
  {
    id: 'tech-2027-01-1',
    domain: 'tech',
    month: 0,
    year: 2027,
    probability: 0.81,
    title: 'AI agents autonomously manage business operations',
    description: 'Autonomous AI handles end-to-end processes without human intervention.',
    impact: 'high',
    sources: [
      { name: 'AI Futures Model', url: 'https://www.aifuturesmodel.com/forecast', confidence: 0.78 },
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2027.htm', confidence: 0.84 },
    ],
  },
  {
    id: 'economic-2027-03-1',
    domain: 'economic',
    month: 2,
    year: 2027,
    probability: 0.75,
    title: 'First trillion-dollar AI company emerges',
    description: 'Major AI company reaches $1T valuation driven by enterprise adoption.',
    impact: 'high',
    sources: [
      { name: 'Market Analysis', confidence: 0.72 },
      { name: 'AI Industry Forecast', confidence: 0.78 },
    ],
  },
  {
    id: 'governance-2027-04-1',
    domain: 'governance',
    month: 3,
    year: 2027,
    probability: 0.71,
    title: 'AI judges handle preliminary court hearings',
    description: 'Judicial systems use AI for case assessment and procedural hearings.',
    impact: 'medium',
    sources: [
      { name: 'Legal Technology Review', confidence: 0.68 },
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2027.htm', confidence: 0.74 },
    ],
  },
  {
    id: 'tech-2027-06-1',
    domain: 'tech',
    month: 5,
    year: 2027,
    probability: 0.69,
    title: 'Brain-computer interfaces approved for medical use',
    description: 'Neuralink or competitors receive FDA approval for treating paralysis.',
    impact: 'high',
    sources: [
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2027.htm', confidence: 0.66 },
      { name: 'Neurotechnology Forecast', confidence: 0.72 },
    ],
  },
  {
    id: 'individual-2027-07-1',
    domain: 'individual',
    month: 6,
    year: 2027,
    probability: 0.73,
    title: 'Online credentials surpass degrees in hiring',
    description: 'Skills-based hiring favors bootcamps and certifications over traditional degrees.',
    impact: 'medium',
    sources: [
      { name: 'Education Technology Report', confidence: 0.70 },
      { name: 'Labor Market Analysis', confidence: 0.76 },
    ],
  },
  {
    id: 'geopolitical-2027-09-1',
    domain: 'geopolitical',
    month: 8,
    year: 2027,
    probability: 0.82,
    title: 'Water scarcity triggers regional conflict',
    description: 'Drought conditions escalate into armed conflict over water resources.',
    impact: 'high',
    sources: [
      { name: 'Climate Security Assessment', confidence: 0.85 },
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2027.htm', confidence: 0.79 },
    ],
  },
  {
    id: 'social-2027-11-1',
    domain: 'social',
    month: 10,
    year: 2027,
    probability: 0.85,
    title: 'Birth rates fall below replacement in 80% of nations',
    description: 'Fertility decline accelerates globally, raising economic concerns.',
    impact: 'high',
    sources: [
      { name: 'UN Population Division', confidence: 0.88 },
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2027.htm', confidence: 0.82 },
    ],
  },
  {
    id: 'tech-2028-02-1',
    domain: 'tech',
    month: 1,
    year: 2028,
    probability: 0.87,
    title: 'AGI systems pass comprehensive reasoning benchmarks',
    description: 'Artificial General Intelligence achieves human-level performance across tasks.',
    impact: 'high',
    sources: [
      { name: 'AI Futures Model', url: 'https://www.aifuturesmodel.com/forecast', confidence: 0.84 },
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2028.htm', confidence: 0.90 },
    ],
  },
  {
    id: 'economic-2028-05-1',
    domain: 'economic',
    month: 4,
    year: 2028,
    probability: 0.78,
    title: 'Carbon markets exceed $600B annual trading',
    description: 'Global carbon pricing creates massive financial markets.',
    impact: 'high',
    sources: [
      { name: 'Climate Finance Report', confidence: 0.81 },
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2028.htm', confidence: 0.75 },
    ],
  },
  {
    id: 'governance-2028-06-1',
    domain: 'governance',
    month: 5,
    year: 2028,
    probability: 0.75,
    title: 'DAOs gain legal recognition in 40+ jurisdictions',
    description: 'Decentralized Autonomous Organizations receive formal legal status.',
    impact: 'medium',
    sources: [
      { name: 'Blockchain Governance Research', confidence: 0.72 },
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2028.htm', confidence: 0.78 },
    ],
  },
  {
    id: 'tech-2028-08-1',
    domain: 'tech',
    month: 7,
    year: 2028,
    probability: 0.66,
    title: 'CRISPR gene therapy becomes routine treatment',
    description: 'Gene editing treats common conditions like heart disease and diabetes.',
    impact: 'high',
    sources: [
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2028.htm', confidence: 0.63 },
      { name: 'Biotechnology Forecast', confidence: 0.69 },
    ],
  },
  {
    id: 'individual-2028-09-1',
    domain: 'individual',
    month: 8,
    year: 2028,
    probability: 0.70,
    title: 'Cognitive enhancement widely adopted',
    description: 'Nootropics and neurotechnology become mainstream in competitive environments.',
    impact: 'medium',
    sources: [
      { name: 'Neuropharmacology Trends', confidence: 0.67 },
      { name: 'Cognitive Enhancement Survey', confidence: 0.73 },
    ],
  },
  {
    id: 'geopolitical-2028-10-1',
    domain: 'geopolitical',
    month: 9,
    year: 2028,
    probability: 0.72,
    title: 'Space mining claims disputed at UN',
    description: 'Commercial asteroid mining triggers international legal disputes.',
    impact: 'medium',
    sources: [
      { name: 'Space Law Institute', confidence: 0.69 },
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2028.htm', confidence: 0.75 },
    ],
  },
  {
    id: 'social-2028-12-1',
    domain: 'social',
    month: 11,
    year: 2028,
    probability: 0.81,
    title: 'VR workspaces become mainstream',
    description: 'Virtual collaboration platforms adopted as primary workspace by corporations.',
    impact: 'medium',
    sources: [
      { name: 'Future of Work Report', confidence: 0.84 },
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2028.htm', confidence: 0.78 },
    ],
  },
  {
    id: 'economic-2029-01-1',
    domain: 'economic',
    month: 0,
    year: 2029,
    probability: 0.83,
    title: 'Automation eliminates 25% of traditional jobs',
    description: 'AI and robotics displacement reaches critical mass across sectors.',
    impact: 'high',
    sources: [
      { name: 'McKinsey Global Institute', confidence: 0.86 },
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2029.htm', confidence: 0.80 },
    ],
  },
  {
    id: 'tech-2029-04-1',
    domain: 'tech',
    month: 3,
    year: 2029,
    probability: 0.71,
    title: 'Fusion power plant connected to grid',
    description: 'First commercial fusion reactor delivers electricity to power grid.',
    impact: 'high',
    sources: [
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2029.htm', confidence: 0.68 },
      { name: 'Energy Technology Forecast', confidence: 0.74 },
    ],
  },
  {
    id: 'social-2029-05-1',
    domain: 'social',
    month: 4,
    year: 2029,
    probability: 0.77,
    title: 'Loneliness epidemic declared public health crisis',
    description: 'Social isolation reaches crisis levels prompting government intervention.',
    impact: 'medium',
    sources: [
      { name: 'WHO Social Health Report', confidence: 0.80 },
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2029.htm', confidence: 0.74 },
    ],
  },
  {
    id: 'geopolitical-2029-07-1',
    domain: 'geopolitical',
    month: 6,
    year: 2029,
    probability: 0.88,
    title: 'Climate refugees exceed 120 million globally',
    description: 'Mass displacement creates humanitarian and political crisis.',
    impact: 'high',
    sources: [
      { name: 'IPCC Climate Report', confidence: 0.91 },
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2029.htm', confidence: 0.85 },
    ],
  },
  {
    id: 'individual-2029-08-1',
    domain: 'individual',
    month: 7,
    year: 2029,
    probability: 0.74,
    title: 'Life expectancy reaches 87 years globally',
    description: 'Medical advances push global average lifespan to new highs.',
    impact: 'medium',
    sources: [
      { name: 'WHO Global Health Report', confidence: 0.77 },
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2029.htm', confidence: 0.71 },
    ],
  },
  {
    id: 'tech-2029-10-1',
    domain: 'tech',
    month: 9,
    year: 2029,
    probability: 0.76,
    title: 'Photonic processors replace silicon in datacenters',
    description: 'Light-based computing offers massive AI performance improvements.',
    impact: 'high',
    sources: [
      { name: 'Semiconductor Industry Roadmap', confidence: 0.73 },
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2029.htm', confidence: 0.79 },
    ],
  },
  {
    id: 'governance-2029-11-1',
    domain: 'governance',
    month: 10,
    year: 2029,
    probability: 0.69,
    title: 'Social credit systems expand to 35+ countries',
    description: 'Behavioral monitoring systems proliferate globally.',
    impact: 'high',
    sources: [
      { name: 'Digital Rights Watch', confidence: 0.66 },
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2029.htm', confidence: 0.72 },
    ],
  },
  {
    id: 'tech-2030-02-1',
    domain: 'tech',
    month: 1,
    year: 2030,
    probability: 0.91,
    title: 'AI-designed drugs approved by FDA',
    description: 'Pharmaceuticals designed entirely by AI systems receive approval.',
    impact: 'high',
    sources: [
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2030.htm', confidence: 0.94 },
      { name: 'Pharmaceutical AI Report', confidence: 0.88 },
    ],
  },
  {
    id: 'geopolitical-2030-03-1',
    domain: 'geopolitical',
    month: 2,
    year: 2030,
    probability: 0.76,
    title: 'First Mars colony supply mission launched',
    description: 'SpaceX or consortium launches initial cargo for permanent settlement.',
    impact: 'medium',
    sources: [
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2030.htm', confidence: 0.73 },
      { name: 'Space Exploration Forecast', confidence: 0.79 },
    ],
  },
  {
    id: 'economic-2030-06-1',
    domain: 'economic',
    month: 5,
    year: 2030,
    probability: 0.85,
    title: 'Green energy achieves universal cost parity',
    description: 'Renewables become cheaper than fossil fuels in all markets worldwide.',
    impact: 'high',
    sources: [
      { name: 'IEA World Energy Outlook', confidence: 0.88 },
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2030.htm', confidence: 0.82 },
    ],
  },
  {
    id: 'social-2030-07-1',
    domain: 'social',
    month: 6,
    year: 2030,
    probability: 0.73,
    title: 'Companion robots address elderly care shortage',
    description: 'AI-powered robotic caregivers provide physical assistance and companionship.',
    impact: 'medium',
    sources: [
      { name: 'Robotics Industry Forecast', confidence: 0.70 },
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2030.htm', confidence: 0.76 },
    ],
  },
  {
    id: 'tech-2030-09-1',
    domain: 'tech',
    month: 8,
    year: 2030,
    probability: 0.79,
    title: 'Neural implants restore full mobility',
    description: 'BCIs enable complete motor function restoration for paralyzed patients.',
    impact: 'high',
    sources: [
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2030.htm', confidence: 0.76 },
      { name: 'Neurotechnology Clinical Trials', confidence: 0.82 },
    ],
  },
  {
    id: 'governance-2030-11-1',
    domain: 'governance',
    month: 10,
    year: 2030,
    probability: 0.78,
    title: 'Global AI safety treaty ratified',
    description: 'Major powers sign comprehensive AGI development and safety agreement.',
    impact: 'high',
    sources: [
      { name: 'AI Governance Institute', confidence: 0.75 },
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2030.htm', confidence: 0.81 },
    ],
  },
  {
    id: 'individual-2030-12-1',
    domain: 'individual',
    month: 11,
    year: 2030,
    probability: 0.81,
    title: 'Career changes every 5 years becomes norm',
    description: 'Rapid tech change makes lifetime careers obsolete.',
    impact: 'medium',
    sources: [
      { name: 'Future of Work Institute', confidence: 0.84 },
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2030.htm', confidence: 0.78 },
    ],
  },
  {
    id: 'tech-2031-05-1',
    domain: 'tech',
    month: 4,
    year: 2031,
    probability: 0.68,
    title: 'Room-temperature superconductors commercialized',
    description: 'Practical superconductors enable revolutionary power and computing advances.',
    impact: 'high',
    sources: [
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2031.htm', confidence: 0.65 },
      { name: 'Materials Science Forecast', confidence: 0.71 },
    ],
  },
  {
    id: 'tech-2032-01-1',
    domain: 'tech',
    month: 0,
    year: 2032,
    probability: 0.75,
    title: 'Synthetic biology creates artificial organisms',
    description: 'Scientists design living organisms from scratch with custom genetics.',
    impact: 'high',
    sources: [
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2032.htm', confidence: 0.72 },
      { name: 'Synthetic Biology Roadmap', confidence: 0.78 },
    ],
  },
  {
    id: 'economic-2032-08-1',
    domain: 'economic',
    month: 7,
    year: 2032,
    probability: 0.81,
    title: 'Digital currencies replace cash in major economies',
    description: 'CBDCs become primary medium with physical cash under 10% usage.',
    impact: 'high',
    sources: [
      { name: 'Central Bank Research', confidence: 0.84 },
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2032.htm', confidence: 0.78 },
    ],
  },
  {
    id: 'geopolitical-2033-04-1',
    domain: 'geopolitical',
    month: 3,
    year: 2033,
    probability: 0.85,
    title: 'Rare earth mineral shortage triggers crisis',
    description: 'Critical materials scarcity causes supply chain disruptions and tensions.',
    impact: 'high',
    sources: [
      { name: 'Resource Security Analysis', confidence: 0.88 },
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2033.htm', confidence: 0.82 },
    ],
  },
  {
    id: 'governance-2033-09-1',
    domain: 'governance',
    month: 8,
    year: 2033,
    probability: 0.72,
    title: 'Biometric surveillance restricted by treaty',
    description: 'Global agreement limits facial recognition and biometric tracking.',
    impact: 'medium',
    sources: [
      { name: 'Privacy Rights Coalition', confidence: 0.69 },
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2033.htm', confidence: 0.75 },
    ],
  },
  {
    id: 'social-2034-02-1',
    domain: 'social',
    month: 1,
    year: 2034,
    probability: 0.78,
    title: 'Marriage rates hit all-time low globally',
    description: 'Traditional marriage declines as alternative structures become common.',
    impact: 'medium',
    sources: [
      { name: 'Social Trends Report', confidence: 0.81 },
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2034.htm', confidence: 0.75 },
    ],
  },
  {
    id: 'individual-2034-10-1',
    domain: 'individual',
    month: 9,
    year: 2034,
    probability: 0.73,
    title: 'First CRISPR-edited humans reach adulthood',
    description: 'Gene-edited children come of age, marking designer human era.',
    impact: 'high',
    sources: [
      { name: 'Bioethics Institute', confidence: 0.70 },
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2034.htm', confidence: 0.76 },
    ],
  },
  {
    id: 'tech-2035-06-1',
    domain: 'tech',
    month: 5,
    year: 2035,
    probability: 0.84,
    title: 'Artificial superintelligence emerges',
    description: 'AI surpasses human intelligence across all cognitive domains.',
    impact: 'high',
    sources: [
      { name: 'AI Futures Model', url: 'https://www.aifuturesmodel.com/forecast', confidence: 0.81 },
      { name: 'Future Timeline', url: 'https://www.futuretimeline.net/21stcentury/2035.htm', confidence: 0.87 },
    ],
  },
  {
    id: 'edu-2026-04-assessment-bifurcates',
    domain: 'governance',
    month: 3,
    year: 2026,
    probability: 0.72,
    title: 'Assessment splits into AI-permitted and AI-restricted tracks',
    description:
      'As AI tutoring normalizes, systems formalize dual pathways: open-book, AI-assisted work that rewards synthesis and iteration, alongside proctored AI-restricted checkpoints for foundational skills and integrity.',
    impact: 'medium',
    sources: [
      { name: 'UNESCO', url: 'https://www.unesco.org/en/digital-education/ai-future-learning', confidence: 0.72 },
    ],
  },
  {
    id: 'edu-2026-06-teacher-orchestration',
    domain: 'social',
    month: 5,
    year: 2026,
    probability: 0.77,
    title: 'Teachers shift toward orchestration and pastoral roles',
    description:
      'With AI covering first-draft explanations and routine feedback after broad tutor adoption, teachers emphasize motivation, class culture, project guidance, and personalized interventions.',
    impact: 'medium',
    sources: [
      { name: 'AI 2027', url: 'https://ai-2027.com/summary', confidence: 0.68 },
      { name: 'AI Futures Model', url: 'https://www.aifuturesmodel.com/about', confidence: 0.66 },
    ],
  },
  {
    id: 'edu-2028-03-mastery-maps',
    domain: 'governance',
    month: 2,
    year: 2028,
    probability: 0.7,
    title: 'Curricula unbundle into mastery maps with individualized pacing',
    description:
      'After AI tutors and dual-track assessment bed in, course pacing guides give way to competency maps that unlock concepts as students demonstrate understanding, coordinated by AI tutors that manage sequencing at scale.',
    impact: 'medium',
    sources: [
      { name: 'AI Futures Model', url: 'https://www.aifuturesmodel.com/about', confidence: 0.67 },
    ],
  },
  {
    id: 'edu-2029-04-immersive-learning-mainstream',
    domain: 'tech',
    month: 3,
    year: 2029,
    probability: 0.74,
    title: 'VR and immersive learning become mainstream',
    description:
      'Virtual and hybrid instruction expands into rich simulations and labs as consumer-grade VR/AR hardware matures and AI-generated content pipelines make scenario authoring cheap.',
    impact: 'high',
    sources: [
      { name: 'FutureTimeline', url: 'https://futuretimeline.net/21stcentury/2030.htm', confidence: 0.73 },
    ],
  },
  {
    id: 'edu-2029-11-dynamic-content-platforms',
    domain: 'economic',
    month: 10,
    year: 2029,
    probability: 0.7,
    title: 'Dynamic content platforms replace static textbooks',
    description:
      'Following mastery-map curricula, schools license adaptive platforms that generate local, level-appropriate materials and continuously refresh content instead of buying fixed textbooks.',
    impact: 'medium',
    sources: [
      { name: 'FutureTimeline', url: 'https://futuretimeline.net/21stcentury/2030.htm', confidence: 0.62 },
    ],
  },
  {
    id: 'edu-2029-12-private-tutoring-disrupted',
    domain: 'economic',
    month: 11,
    year: 2029,
    probability: 0.72,
    title: 'Private tutoring market is disrupted by AI baselines',
    description:
      'Affordable AI tutoring substitutes most entry-level private tutoring once dynamic content platforms and pervasive AI coaches are established, pushing human tutors toward high-touch, premium niches.',
    impact: 'medium',
    sources: [
      { name: 'AI Futures Model', url: 'https://www.aifuturesmodel.com/about', confidence: 0.65 },
    ],
  },
  {
    id: 'edu-2031-02-microcredentials-rise',
    domain: 'governance',
    month: 1,
    year: 2031,
    probability: 0.74,
    title: 'Micro-credentials and verified skills eclipse many degrees',
    description:
      'Stackable, tightly mapped credentials gain status as autonomous course-building systems enable rapid updates and clearer links to demonstrable skills, reinforced by AI-rich assessments.',
    impact: 'high',
    sources: [
      { name: 'LessWrong', url: 'https://www.lesswrong.com/posts/YABG5JmztGGPwNFq2/ai-futures-timelines-and-takeoff-model-dec-2025-update', confidence: 0.74 },
    ],
  },
  {
    id: 'edu-2032-01-continuous-verification',
    domain: 'governance',
    month: 0,
    year: 2032,
    probability: 0.72,
    title: 'Continuous identity and provenance checks reshape assessment',
    description:
      'Assessment relies on lightweight identity verification, oral defenses, and practical tasks, reducing reliance on unproctored essays as AI capabilities and autonomous courseware mature.',
    impact: 'medium',
    sources: [
      { name: 'AI Futures Model', url: 'https://www.aifuturesmodel.com/about', confidence: 0.68 },
    ],
  },
  {
    id: 'edu-2033-03-degree-decomposition',
    domain: 'social',
    month: 2,
    year: 2033,
    probability: 0.7,
    title: 'Traditional degrees decompose into verified cores plus specializations',
    description:
      'Universities restructure programs into verified foundational cores paired with stackable specializations tied to labor-market signals and rapid refresh cycles, accelerating after continuous verification becomes standard.',
    impact: 'medium',
    sources: [
      { name: 'LessWrong', url: 'https://www.lesswrong.com/posts/YABG5JmztGGPwNFq2/ai-futures-timelines-and-takeoff-model-dec-2025-update', confidence: 0.67 },
    ],
  },
  {
    id: 'edu-2034-02-ambient-learning-layer',
    domain: 'individual',
    month: 1,
    year: 2034,
    probability: 0.72,
    title: 'Ambient lifelong learning layers into daily tools',
    description:
      'Workflows and consumer tools embed coaching, just-in-time explanations, and simulations so learning becomes a continual background activity across life, extending the AI tutor baseline to adults.',
    impact: 'medium',
    sources: [
      { name: 'FutureTimeline', url: 'https://futuretimeline.net/21stcentury/2030.htm', confidence: 0.66 },
    ],
  },
  {
    id: 'edu-2035-07-human-centered-schools',
    domain: 'social',
    month: 6,
    year: 2035,
    probability: 0.7,
    title: 'Schools center community, leadership, and well-being over content',
    description:
      'Education systems shift toward cultivating collaboration, mentorship, and civic norms while AI handles most instruction, reflecting education as social development and curation.',
    impact: 'high',
    sources: [
      { name: 'AI 2027', url: 'https://ai-2027.com/summary', confidence: 0.64 },
      { name: 'AI Futures Model', url: 'https://www.aifuturesmodel.com/about', confidence: 0.62 },
    ],
  },
];

function dedupePredictions(predictions: Prediction[]): Prediction[] {
  const ids = new Set<string>();
  const contentKeys = new Set<string>();

  return predictions.filter((prediction) => {
    const idKey = prediction.id.trim();
    const contentKey = `${prediction.title.trim()}|${prediction.year}|${prediction.month}|${prediction.domain}`;

    if (ids.has(idKey) || contentKeys.has(contentKey)) {
      return false;
    }

    ids.add(idKey);
    contentKeys.add(contentKey);
    return true;
  });
}

const PREDICTION_DATABASE: Prediction[] = dedupePredictions(RAW_PREDICTIONS);

export function getPredictionYearRange(): { minYear: number; maxYear: number } {
  const years = PREDICTION_DATABASE.map((p) => p.year);
  return {
    minYear: Math.min(...years),
    maxYear: Math.max(...years),
  };
}

export function generateTimelineData(startYear: number, endYear: number): MonthData[] {
  const data: MonthData[] = [];
  
  for (let year = startYear; year <= endYear; year++) {
    for (let month = 0; month < 12; month++) {
      const monthPredictions = PREDICTION_DATABASE.filter(
        (p) => p.year === year && p.month === month
      );
      
      const probabilities: Record<Domain, number> = {
        individual: 0.5,
        social: 0.5,
        tech: 0.5,
        economic: 0.5,
        geopolitical: 0.5,
        governance: 0.5,
      };
      
      monthPredictions.forEach((pred) => {
        probabilities[pred.domain] = pred.probability;
      });
      
      data.push({
        month,
        year,
        probabilities,
        predictions: monthPredictions,
      });
    }
  }
  
  return data;
}

export function getAverageProbability(probabilities: Record<Domain, number>, activeDomains: Domain[]): number {
  if (activeDomains.length === 0) {
    return Object.values(probabilities).reduce((sum, val) => sum + val, 0) / 6;
  }
  
  const sum = activeDomains.reduce((acc, domain) => acc + probabilities[domain], 0);
  return sum / activeDomains.length;
}
