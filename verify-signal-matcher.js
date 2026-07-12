'use strict';

const { detectConcepts, deriveEventTerms, qualifyPost } = require('./refresh-signals.js');

function prediction(title, domain = 'technology'){
  const terms = deriveEventTerms(title);
  return {
    maps: title,
    domain,
    phrases: terms.phrases,
    strong: [],
    sw: terms.sw,
    weak: [],
    concepts: detectConcepts(title),
  };
}

const fixtures = [
  {
    name: 'AI5 tape-out supports semiconductor automation',
    expect: true,
    title: 'AI automates a majority of cognitive work in semiconductor R&D and production engineering',
    text: 'The Tesla-Samsung AI5 chip reached tape-out and will be manufactured at the Taylor fab using a 2nm process.',
  },
  {
    name: 'physician comparison supports top-expert capability',
    expect: true,
    title: 'Managed branch: the strongest AIs reach top-human-expert capability across essentially every cognitive field',
    text: 'Physicians found fewer flaws in GPT-5.6 responses than physician-written responses.',
  },
  {
    name: 'robot hand supports physical-task automation',
    expect: true,
    title: 'Advanced robots can perform roughly one third of economically valuable physical tasks',
    text: 'A humanoid robot hand has 25 degrees of freedom, tactile sensing, and human-level dexterity.',
  },
  {
    name: 'AI 2040 deal supports managed training pause',
    expect: true,
    domain: 'governance',
    title: 'Managed branch: the US and China temporarily pause the largest frontier training runs while preserving inference',
    text: 'AI 2040 Plan A says the US and China make a deal, AI R&D is slowed, and frontier labs scale more carefully.',
  },
  {
    name: 'universal high income supports dividend policy',
    expect: true,
    domain: 'economic',
    title: 'Universal high income or an AI dividend becomes a permanent institution in multiple major economies',
    text: 'AI and robots will be able to do everything, resulting in universal high income. Work will be optional.',
  },
  {
    name: 'global workspace supports AI welfare',
    expect: true,
    domain: 'social',
    title: 'AI welfare, compensation and legal status enter mainstream law and corporate governance',
    text: 'A global workspace in language models suggests Claude has a functional analog of access consciousness.',
  },
  {
    name: 'mechanistic latent-space work supports interpretability',
    expect: true,
    title: 'Mechanistic interpretability becomes a practical tool for detecting deception and tracing model decisions',
    text: 'LLMs are neurosymbolic in latent space; this is a mechanistic explanation of their internal representations.',
  },
  {
    name: 'space solar supports off-world resources',
    expect: true,
    domain: 'governance',
    title: 'Space resources and off-world self-replicating industry become central to post-ASI governance',
    text: 'Solar power in space could provide useful work at enormous scale, making space energy more valuable than Earth output.',
  },
  {
    name: 'mathematical J-space is not off-world space',
    expect: false,
    title: 'Robot industry and compute infrastructure begin shifting materially into space',
    text: 'The model forms a latent J-space whose internal coordinates encode abstract concepts.',
  },
  {
    name: 'building permit is not a compute or robot-production cap',
    expect: false,
    domain: 'governance',
    title: 'At least one major jurisdiction caps or auctions permits for frontier compute and large-scale robot production',
    text: 'A Tesla facility building permit lists a cleaning robot alongside Superchargers.',
  },
  {
    name: 'market cap is not a compute cap',
    expect: false,
    domain: 'governance',
    title: 'Managed branch: major powers adopt compute caps or mutually assured compute-destruction provisions',
    text: 'The frontier AI company reached a $100 billion market cap after leasing more compute.',
  },
  {
    name: 'political power is not electrical power',
    expect: false,
    title: 'Physical production, energy and robotics—not ideas—become the main bottlenecks to AI-driven growth',
    text: 'AI could irreversibly concentrate political power in a handful of institutions.',
  },
  {
    name: 'battery factory is not a humanoid factory deployment',
    expect: false,
    title: 'Humanoid robots move onto live factory lines in the thousands, but remain far short of general physical labor',
    text: 'A Megapack order equals more than half the annual production capacity at Tesla’s battery factory.',
  },
  {
    name: 'school learning is not continual model learning',
    expect: false,
    domain: 'governance',
    title: 'Continual-learning architectures become a major regulatory flashpoint because deployed capabilities can change',
    text: 'Education should teach students critical thinking and restore enthusiasm for learning at school.',
  },
  {
    name: 'Mars propulsion is not off-world resource governance',
    expect: false,
    domain: 'governance',
    title: 'Space resources and off-world self-replicating industry become central to post-ASI governance',
    text: 'An antimatter starship to Mars would require 25 TWh of energy and many particle accelerators.',
  },
  {
    name: 'compute lease is not a compute cap',
    expect: false,
    domain: 'governance',
    title: 'Managed branch: major powers adopt compute caps or mutually assured compute-destruction provisions',
    text: 'SpaceX signed a $6.3 billion compute lease with an open-source AI startup.',
  },
  {
    name: 'transparent bilateral deal is not privacy-preserving treaty verification',
    expect: false,
    domain: 'geopolitical',
    title: 'Treaty compliance can be verified without revealing most underlying private or national-security data',
    text: 'The US and China make an AI deal, slow AI R&D, and make frontier labs more transparent.',
  },
  {
    name: 'generic search agent is not a personal truth advisor',
    expect: false,
    title: 'Personal truth-seeking AI advisors begin replacing one-size-fits-all feeds and search interfaces',
    text: 'Qwen AgentWorld simulates Search, Terminal, SWE, Web, OS and Android environments for agents.',
  },
  {
    name: 'sixteen-percent labor score does not support eighty-five percent',
    expect: false,
    domain: 'economic',
    title: 'AI and robots perform 85% or more of economically valuable labor in at least one leading economy',
    text: 'Fable 5 reached 16.1% on the Remote Labor Index across 240 freelance projects.',
  },
  {
    name: 'eighty percent does not support eighty-five percent',
    expect: false,
    domain: 'economic',
    title: 'AI and robots perform 85% or more of economically valuable labor in at least one leading economy',
    text: 'AI and robots now perform 80% of economically valuable work.',
  },
  {
    name: 'unrelated company percentage does not satisfy cognitive labor majority',
    expect: false,
    domain: 'economic',
    title: 'AI systems produce more cognitive labor than humans in at least one leading economy',
    text: 'More than half of companies now pilot AI, but AI produces only 10% of cognitive labor.',
  },
  {
    name: 'unrelated company percentage does not satisfy eighty-five percent labor',
    expect: false,
    domain: 'economic',
    title: 'AI and robots perform 85% or more of economically valuable labor in at least one leading economy',
    text: '90% of companies are piloting AI, but AI and robots perform only 10% of economically valuable labor.',
  },
  {
    name: 'separate-sentence percentages do not merge',
    expect: false,
    domain: 'economic',
    title: 'AI and robots perform 85% or more of economically valuable labor in at least one leading economy',
    text: '90% of companies are piloting AI. AI and robots perform only 10% of economically valuable labor.',
  },
  {
    name: 'human-attributed percentage is not AI labor',
    expect: false,
    domain: 'economic',
    title: 'AI and robots perform 85% or more of economically valuable labor in at least one leading economy',
    text: 'Humans perform 90% of economically valuable labor and AI and robots perform the remaining 10%.',
  },
  {
    name: 'decimal percentage is preserved below threshold',
    expect: false,
    domain: 'economic',
    title: 'AI and robots perform 85% or more of economically valuable labor in at least one leading economy',
    text: 'AI and robots perform 80.90% of economically valuable labor.',
  },
  {
    name: 'actor-bound percentage satisfies labor threshold',
    expect: true,
    domain: 'economic',
    title: 'AI and robots perform 85% or more of economically valuable labor in at least one leading economy',
    text: 'AI and robots perform 90% of economically valuable labor.',
  },
  {
    name: 'half of entry jobs does not mean AI produces more labor than humans',
    expect: false,
    domain: 'economic',
    title: 'AI systems produce more cognitive labor than humans in at least one leading economy',
    text: 'Half of all entry-level white-collar jobs could disappear, with unemployment at 20%.',
  },
  {
    name: 'negated cognitive-majority claim is rejected',
    expect: false,
    domain: 'economic',
    title: 'AI systems produce more cognitive labor than humans in at least one leading economy',
    text: 'AI does not produce more cognitive labor than humans.',
  },
  {
    name: 'actor-bound cognitive majority is accepted',
    expect: true,
    domain: 'economic',
    title: 'AI systems produce more cognitive labor than humans in at least one leading economy',
    text: 'AI systems now perform 60% of cognitive labor.',
  },
  {
    name: 'revenue billions are not robot billions',
    expect: false,
    domain: 'economic',
    title: 'The global economy runs at least 200 million frontier AI workers and 2 billion advanced robots',
    text: 'Tesla could generate $250 billion per year by producing 10 million Optimus robots.',
  },
  {
    name: 'bound robot billions support global robot scale',
    expect: true,
    domain: 'economic',
    title: 'The global economy runs at least 200 million frontier AI workers and 2 billion advanced robots',
    text: 'Four billion robots equivalent to four billion humans would work continuously.',
  },
  {
    name: 'one billion robots is below the two-billion threshold',
    expect: false,
    domain: 'economic',
    title: 'The global economy runs at least 200 million frontier AI workers and 2 billion advanced robots',
    text: 'One billion advanced robots now work across the global economy.',
  },
  {
    name: 'decimal robot count below two billion is rejected',
    expect: false,
    domain: 'economic',
    title: 'The global economy runs at least 200 million frontier AI workers and 2 billion advanced robots',
    text: 'The global economy now runs 1.9 billion advanced robots.',
  },
  {
    name: 'below two billion qualifier is rejected',
    expect: false,
    domain: 'economic',
    title: 'The global economy runs at least 200 million frontier AI workers and 2 billion advanced robots',
    text: 'The global economy remains below 2 billion advanced robots.',
  },
  {
    name: 'robot-market dollars are not a robot count',
    expect: false,
    domain: 'economic',
    title: 'The global economy runs at least 200 million frontier AI workers and 2 billion advanced robots',
    text: 'A $2 billion advanced robot market is emerging.',
  },
  {
    name: 'noun-first two-billion robot count is accepted',
    expect: true,
    domain: 'economic',
    title: 'The global economy runs at least 200 million frontier AI workers and 2 billion advanced robots',
    text: 'Advanced robots now reach 2 billion across the global economy.',
  },
  {
    name: 'robot-generated dollars are not a robot count',
    expect: false,
    domain: 'economic',
    title: 'The global economy runs at least 200 million frontier AI workers and 2 billion advanced robots',
    text: 'Advanced robots generate 2 billion dollars in annual revenue.',
  },
  {
    name: 'robot billions do not become virtual AI-agent copies',
    expect: false,
    domain: 'economic',
    title: 'Continuously running AI agents form a virtual workforce of at least 100 million copies',
    text: 'Four billion robots equivalent to four billion humans would work continuously.',
  },
  {
    name: 'ten million AI workers is below the virtual-workforce threshold',
    expect: false,
    domain: 'economic',
    title: 'Continuously running AI agents form a virtual workforce of at least 100 million copies',
    text: 'Ten million AI workers now form a continuously running virtual workforce.',
  },
  {
    name: 'below one hundred million AI workers is rejected',
    expect: false,
    domain: 'economic',
    title: 'Continuously running AI agents form a virtual workforce of at least 100 million copies',
    text: 'The virtual AI workforce remains below 100 million AI workers.',
  },
  {
    name: 'monetary AI-workforce market is not a worker count',
    expect: false,
    domain: 'economic',
    title: 'Continuously running AI agents form a virtual workforce of at least 100 million copies',
    text: 'A €100 million AI workforce market is emerging.',
  },
  {
    name: 'scaled AI workforce supports virtual agent copies',
    expect: true,
    domain: 'economic',
    title: 'Continuously running AI agents form a virtual workforce of at least 100 million copies',
    text: 'A huge AI workforce is coming, scaling from billions to trillions of AI workers and scientists.',
  },
  {
    name: 'half-population robotaxi hiring does not support ninety-five percent automation',
    expect: false,
    title: 'AI and robots can perform about 95% of cognitive and physical tasks',
    text: 'Tesla is hiring Robotaxi AI Safety Operators in metro areas covering half the US population.',
  },
];

let failed = 0;
for (const fixture of fixtures) {
  const result = qualifyPost(fixture.text, prediction(fixture.title, fixture.domain), 1);
  if (result.ok !== fixture.expect) {
    failed++;
    console.error(`FAIL: ${fixture.name} (expected ${fixture.expect}, got ${result.ok}; reason=${result.reason || 'matched'})`);
  }
}

if (failed) {
  console.error(`RESULT: FAIL (${failed}/${fixtures.length} matcher fixtures)`);
  process.exit(1);
}
console.log(`RESULT: PASS (${fixtures.length} matcher fixtures)`);
