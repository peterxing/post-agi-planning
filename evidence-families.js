'use strict';

const FAMILY_DEFINITIONS = {
  'agents-workflows': {
    label: 'AI agents and continuous digital work',
    reuse: true,
    match: true,
    all: ['agents'],
    any: ['ai', 'coding', 'labor', 'institutions'],
    text: /\b(?:agent|agents|agentic)\b.*\b(?:work|workflow|tasks?|labor|labour|workforce|business|copies)\b|\b(?:work|workflow|tasks?|labor|labour|workforce|business|copies)\b.*\b(?:agent|agents|agentic)\b/,
  },
  'ai-rd': {
    label: 'AI-accelerated and automated R&D',
    reuse: true,
    match: true,
    all: ['research'],
    any: ['ai', 'coding', 'agents'],
    text: /\b(?:ai r d|automated research|research automation|ai scientist|ai researchers?|research agents?|agents? (?:doing|conducting|accelerating) research|self improv\w* model)\b/,
  },
  'ai-economy-power': {
    label: 'Frontier-lab economic and political power',
    reuse: true,
    all: ['economy'],
    any: ['ai', 'compute', 'infrastructure', 'scale', 'institutions'],
  },
  'robotics-physical': {
    label: 'Robotics and physical automation',
    reuse: true,
    match: true,
    all: ['robotics'],
    any: ['production', 'labor', 'ai', 'scale', 'economy'],
    text: /\b(?:robot|robots|robotic|robotics|humanoid)\b.*\b(?:work|jobs?|labor|labour|tasks?|factory|production|manufactur\w*|deploy\w*|scale|economy)\b|\b(?:work|jobs?|labor|labour|tasks?|factory|production|manufactur\w*|deploy\w*|scale|economy)\b.*\b(?:robot|robots|robotic|robotics|humanoid)\b/,
  },
  'frontier-governance': {
    label: 'Frontier governance, compute controls and verification',
    reuse: true,
    all: ['governance'],
    any: ['ai', 'compute', 'geopolitics', 'scenario2040', 'institutions'],
  },
  'ai-capability': {
    label: 'AGI, superintelligence and top-expert capability',
    reuse: true,
    match: true,
    any: ['agi'],
    text: /\b(?:agi|asi|superintelligen\w*|human level ai|top expert ai|intelligence explosion)\b/,
  },
  'bci-implantable': {
    label: 'Implantable brain-computer interfaces',
    reuse: true,
    match: true,
    all: ['bci'],
    text: /\b(?:neuralink|intracortical|brain implant|neural implant|implanted bci|bci implant)\b/,
  },
  'bci-non-invasive': {
    label: 'Genuinely non-invasive brain-computer interfaces',
    reuse: false,
    all: ['bci'],
  },
  'orbital-compute': {
    label: 'Orbital compute and space data centres',
    reuse: true,
    match: true,
    all: ['orbitalcompute'],
    text: /\b(?:orbital compute|orbital data cent(?:er|re)|space data cent(?:er|re)|data cent(?:er|re)s? in space|space based data cent(?:er|re)|ai sat(?:ellite)?|starcloud|project suncatcher)\b/,
  },
  'software-automation': {
    label: 'End-to-end software automation',
    reuse: true,
    match: true,
    all: ['coding'],
    any: ['ai', 'agents', 'production'],
    text: /\b(?:ai|agents?)\b.*\b(?:write|writes|written|coding|software|programming)\b|\b(?:coding|software|programming)\b.*\b(?:automated|autonomous|agents?|ai)\b/,
  },
  'labor-automation': {
    label: 'Cognitive labor and economy-wide automation',
    reuse: true,
    match: true,
    all: ['labor'],
    any: ['ai', 'robotics', 'agents', 'economy'],
    text: /\b(?:ai|agents?|robots?|automation)\b.*\b(?:jobs?|employment|workforce|labor|labour|workers?|human work|cognitive work)\b|\b(?:jobs?|employment|workforce|labor|labour|workers?|human work|cognitive work)\b.*\b(?:ai|agents?|robots?|automation)\b/,
  },
  'compute-infrastructure': {
    label: 'Compute, datacentres and physical bottlenecks',
    reuse: true,
    match: true,
    all: ['compute'],
    any: ['infrastructure', 'energy', 'production', 'economy', 'geopolitics'],
    text: /\b(?:data cent(?:er|re)|datacent(?:er|re)|compute capacity|compute infrastructure|grid capacity|power constraint|gpu supply|chip supply|compute buildout)\b/,
  },
  'ai-politics': {
    label: 'AI politics, elections and polarization',
    reuse: true,
    match: true,
    all: ['ai'],
    any: ['institutions', 'governance', 'geopolitics'],
    text: /\b(?:election|politics|political polarization|political issue|campaign|voters?)\b/,
  },
  distribution: {
    label: 'AI dividends, ownership and post-work distribution',
    reuse: true,
    match: true,
    all: ['distribution'],
    text: /\b(?:ubi|universal basic income|universal high income|ai dividend|citizen dividend|compute rents?|robot rents?|wealth redistribution)\b/,
  },
  'health-ai': {
    label: 'AI-designed medicine, cures and longevity',
    reuse: true,
    match: true,
    all: ['health'],
    any: ['ai', 'research'],
    text: /\b(?:ai|model|agents?)\b.*\b(?:drug|medicine|medical|disease|cancer|longevity|health)\b|\b(?:drug|medicine|medical|disease|cancer|longevity|health)\b.*\b(?:ai|model|agents?)\b/,
  },
  biosecurity: {
    label: 'Biosecurity, biodefense and pathogen monitoring',
    reuse: true,
    match: true,
    all: ['biosecurity'],
    text: /\b(?:biosecurity|biodefense|pathogen monitoring|synthetic nucleic acid|pandemic preparedness|rapid vaccines?)\b/,
  },
  'safety-alignment': {
    label: 'Alignment, interpretability and safety evidence',
    reuse: true,
    any: ['alignment', 'interpretability'],
  },
  'economy-growth': {
    label: 'AI-driven economic growth',
    reuse: true,
    all: ['economy'],
    any: ['ai', 'robotics', 'scale'],
  },
  persuasion: {
    label: 'AI persuasion and truth-seeking',
    reuse: true,
    match: true,
    all: ['persuasion'],
    text: /\b(?:persuad\w*|targeted influence|human manipulation|political manipulation|deepfake persuasion)\b/,
  },
  'ai-rights': {
    label: 'AI welfare, consciousness and legal status',
    reuse: true,
    match: true,
    all: ['rights'],
    text: /\b(?:ai welfare|ai rights|legal status|moral agent|self awareness|consciousness|sentien\w*)\b/,
  },
  education: {
    label: 'Education, meaning and stewardship',
    reuse: true,
    match: true,
    all: ['education'],
    text: /\b(?:education|school|university|learning)\b.*\b(?:meaning|community|relationships?|stewardship|purpose|employability)\b/,
  },
  'science-acceleration': {
    label: 'AI-accelerated science and paradigm change',
    reuse: true,
    match: true,
    all: ['research'],
    any: ['ai', 'scale', 'health', 'energy'],
    text: /\b(?:ai|agents?|model)\b.*\b(?:science|scientific|research|discovery|theorem|cures?)\b|\b(?:science|scientific|research|discovery|theorem|cures?)\b.*\b(?:ai|agents?|model)\b/,
  },
  'privacy-verification': {
    label: 'Privacy-preserving audit and treaty verification',
    reuse: true,
    match: true,
    all: ['privacy'],
    any: ['governance', 'ai'],
    text: /\b(?:privacy preserving|zero knowledge|without revealing|confidential audit|private verification)\b/,
  },
  'institutions-delegation': {
    label: 'AI-run institutions and delegated authority',
    reuse: true,
    match: true,
    all: ['institutions'],
    any: ['ai', 'agents', 'governance'],
    text: /\b(?:ai run|ai runs|run by ai|delegate\w* (?:authority|decisions?)|ai decisions?|autonomous institutions?)\b/,
  },
  connectomics: {
    label: 'Connectomics, emulation and mind uploading',
    reuse: true,
    match: true,
    all: ['connectomics'],
    text: /\b(?:connectom\w*|whole brain emulation|functional emulation|mind upload\w*|digital immortal\w*)\b/,
  },
  'civilizational-energy': {
    label: 'Kardashev-scale energy and Dyson trajectories',
    reuse: true,
    match: true,
    all: ['civilizationalenergy'],
    text: /\b(?:kardashev|dyson swarm|type i civilization|type ii civilization|stellar energy)\b/,
  },
  transcension: {
    label: 'Transcension and inward computational densification',
    reuse: false,
    match: true,
    all: ['transcension'],
    text: /\b(?:transcension|computational densification|inner space)\b/,
  },
  ruliad: {
    label: 'Ruliad and testable Wolfram physics',
    reuse: false,
    match: true,
    all: ['ruliad'],
    text: /\b(?:ruliad|rulial|wolfram physics)\b/,
  },
};

const FAMILY_PREDICTION_IDS = {
  'agents-workflows': ['2026-0', '2027-0', '2034-1'],
  'ai-rd': ['2026-1', '2027-2', '2028-2', '2030-0', '2031-0', '2034-0'],
  'ai-economy-power': ['2026-2', '2028-3', '2031-2'],
  'robotics-physical': [
    '2026-3', '2030-5', '2031-1', '2032-1', '2032-3', '2033-0',
    '2033-5', '2035-2', '2036-0', '2036-1', '2040-0',
  ],
  'frontier-governance': [
    '2026-4', '2026-5', '2027-4', '2028-6', '2029-1', '2029-2', '2029-3',
    '2029-4', '2030-2', '2030-3', '2031-3', '2031-5', '2032-4', '2034-3',
    '2034-5', '2035-1', '2038-5', '2039-1', '2039-5', '2040-1',
  ],
  'ai-capability': ['2026-6', '2028-5', '2030-1', '2035-0'],
  'bci-implantable': [
    '2026-7',
    'horizon-implantable-neural-symbiosis',
  ],
  'bci-non-invasive': [
    'horizon-non-invasive-neural-symbiosis',
  ],
  'orbital-compute': [
    '2026-8',
    '2039-4',
    'horizon-orbital-compute-to-proto-dyson',
  ],
  'software-automation': ['2027-1'],
  'compute-infrastructure': ['2027-5', '2028-4', '2034-2', '2034-4', '2036-4'],
  'ai-politics': ['2028-0', '2029-6'],
  'labor-automation': ['2027-3', '2028-1', '2029-0', '2032-0', '2036-2'],
  distribution: ['2029-5', '2032-5', '2033-1', '2033-2', '2035-3', '2036-5', '2039-3'],
  'health-ai': ['2030-4', '2037-1'],
  biosecurity: ['2033-6'],
  'safety-alignment': ['2031-4', '2035-6', '2038-0', '2038-1', '2038-2', '2038-4'],
  'economy-growth': ['2032-2', '2036-3'],
  persuasion: ['2033-3', '2033-4', '2035-4', '2037-3'],
  'ai-rights': ['2035-5'],
  education: ['2036-6'],
  'science-acceleration': ['2037-0', '2037-4'],
  'privacy-verification': ['2037-2', '2037-5'],
  'institutions-delegation': ['2038-3', '2039-0', '2039-2', '2040-2'],
  connectomics: ['2028-7', 'horizon-whole-brain-emulation-and-uploading'],
  'civilizational-energy': ['horizon-kardashev-energy-scaling'],
  transcension: ['horizon-transcension-hypothesis'],
  ruliad: ['horizon-ruliad-testable-physics'],
};

const PREDICTION_FAMILY = new Map();
for (const [family, ids] of Object.entries(FAMILY_PREDICTION_IDS)) {
  for (const id of ids) {
    if (PREDICTION_FAMILY.has(id)) throw new Error(`Duplicate evidence family assignment for ${id}`);
    PREDICTION_FAMILY.set(id, family);
  }
}

function familyForPrediction(id) {
  return PREDICTION_FAMILY.get(id) || null;
}

function validateFamilyCoverage(ids) {
  const expected = new Set(ids);
  return {
    missing: [...expected].filter(id => !PREDICTION_FAMILY.has(id)),
    extra: [...PREDICTION_FAMILY.keys()].filter(id => !expected.has(id)),
  };
}

module.exports = {
  FAMILY_DEFINITIONS,
  FAMILY_PREDICTION_IDS,
  familyForPrediction,
  validateFamilyCoverage,
};
