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

const PREDICTION_DATABASE: Prediction[] = [
  {
    id: 'edu-2026-01-ai-tutor-default',
    domain: 'tech',
    month: 0,
    year: 2026,
    probability: 0.78,
    title: 'AI tutors become default scaffolding in affluent systems',
    description:
      '1:1 AI coaching for practice, explanations, and study planning becomes the default baseline; teachers reallocate time toward motivation, class culture, and targeted interventions.',
    impact: 'high',
    sources: [
      { name: 'Reuters', url: 'https://www.reuters.com/world/asia-pacific/china-rely-artificial-intelligence-education-reform-bid-2025-04-17/', confidence: 0.8 },
      { name: 'UNESCO', url: 'https://www.unesco.org/en/digital-education/ai-future-learning', confidence: 0.74 },
    ],
  },
  {
    id: 'edu-2026-09-assessment-bifurcates',
    domain: 'governance',
    month: 8,
    year: 2026,
    probability: 0.7,
    title: 'Assessment splits into AI-permitted and AI-restricted tracks',
    description:
      'Systems formalize dual pathways: open-book, AI-assisted work that rewards synthesis and iteration, alongside proctored AI-restricted checkpoints for foundational skills and integrity.',
    impact: 'medium',
    sources: [
      { name: 'UNESCO', url: 'https://www.unesco.org/en/digital-education/ai-future-learning', confidence: 0.72 },
    ],
  },
  {
    id: 'edu-2026-11-teacher-orchestration',
    domain: 'social',
    month: 10,
    year: 2026,
    probability: 0.74,
    title: 'Teachers shift toward orchestration and pastoral roles',
    description:
      'With AI covering first-draft explanations and routine feedback, teachers emphasize motivation, class culture, project guidance, and personalized interventions.',
    impact: 'medium',
    sources: [
      { name: 'AI 2027', url: 'https://ai-2027.com/summary', confidence: 0.68 },
      { name: 'AI Futures Model', url: 'https://www.aifuturesmodel.com/about', confidence: 0.66 },
    ],
  },
  {
    id: 'edu-2029-02-mastery-maps',
    domain: 'governance',
    month: 1,
    year: 2029,
    probability: 0.69,
    title: 'Curricula unbundle into mastery maps with individualized pacing',
    description:
      'Course pacing guides give way to competency maps that unlock concepts as students demonstrate understanding, coordinated by AI tutors that manage sequencing at scale.',
    impact: 'medium',
    sources: [
      { name: 'AI Futures Model', url: 'https://www.aifuturesmodel.com/about', confidence: 0.67 },
    ],
  },
  {
    id: 'edu-2030-06-immersive-learning-mainstream',
    domain: 'tech',
    month: 5,
    year: 2030,
    probability: 0.71,
    title: 'VR and immersive learning become mainstream',
    description:
      'Virtual and hybrid instruction expands beyond video conferencing into rich simulations and labs as consumer-grade VR/AR hardware becomes broadly accessible.',
    impact: 'high',
    sources: [
      { name: 'FutureTimeline', url: 'https://futuretimeline.net/21stcentury/2030.htm', confidence: 0.73 },
    ],
  },
  {
    id: 'edu-2031-04-dynamic-content-platforms',
    domain: 'economic',
    month: 3,
    year: 2031,
    probability: 0.66,
    title: 'Dynamic content platforms replace static textbooks',
    description:
      'Schools license adaptive platforms that generate local, level-appropriate materials and continuously refresh content instead of buying fixed textbooks.',
    impact: 'medium',
    sources: [
      { name: 'FutureTimeline', url: 'https://futuretimeline.net/21stcentury/2030.htm', confidence: 0.62 },
    ],
  },
  {
    id: 'edu-2031-09-private-tutoring-disrupted',
    domain: 'economic',
    month: 8,
    year: 2031,
    probability: 0.68,
    title: 'Private tutoring market is disrupted by AI baselines',
    description:
      'Affordable AI tutoring substitutes most entry-level private tutoring, pushing human tutors to specialize in high-touch, premium niches.',
    impact: 'medium',
    sources: [
      { name: 'AI Futures Model', url: 'https://www.aifuturesmodel.com/about', confidence: 0.65 },
    ],
  },
  {
    id: 'edu-2032-03-microcredentials-rise',
    domain: 'governance',
    month: 2,
    year: 2032,
    probability: 0.72,
    title: 'Micro-credentials and verified skills eclipse many degrees',
    description:
      'Stackable, tightly mapped credentials gain status as autonomous course-building systems enable rapid updates and clearer links to demonstrable skills.',
    impact: 'high',
    sources: [
      { name: 'LessWrong', url: 'https://www.lesswrong.com/posts/YABG5JmztGGPwNFq2/ai-futures-timelines-and-takeoff-model-dec-2025-update', confidence: 0.74 },
    ],
  },
  {
    id: 'edu-2033-07-continuous-verification',
    domain: 'governance',
    month: 6,
    year: 2033,
    probability: 0.7,
    title: 'Continuous identity and provenance checks reshape assessment',
    description:
      'Assessment relies more on lightweight identity verification, oral defenses, and practical tasks, reducing reliance on unproctored essays as AI capabilities grow.',
    impact: 'medium',
    sources: [
      { name: 'AI Futures Model', url: 'https://www.aifuturesmodel.com/about', confidence: 0.68 },
    ],
  },
  {
    id: 'edu-2034-11-degree-decomposition',
    domain: 'social',
    month: 10,
    year: 2034,
    probability: 0.65,
    title: 'Traditional degrees decompose into verified cores plus specializations',
    description:
      'Universities restructure programs into verified foundational cores paired with stackable specializations tied to labor-market signals and rapid refresh cycles.',
    impact: 'medium',
    sources: [
      { name: 'LessWrong', url: 'https://www.lesswrong.com/posts/YABG5JmztGGPwNFq2/ai-futures-timelines-and-takeoff-model-dec-2025-update', confidence: 0.67 },
    ],
  },
  {
    id: 'edu-2035-05-ambient-learning-layer',
    domain: 'individual',
    month: 4,
    year: 2035,
    probability: 0.69,
    title: 'Ambient lifelong learning layers into daily tools',
    description:
      'Workflows and consumer tools embed coaching, just-in-time explanations, and simulations so learning becomes a continual background activity across life.',
    impact: 'medium',
    sources: [
      { name: 'FutureTimeline', url: 'https://futuretimeline.net/21stcentury/2030.htm', confidence: 0.66 },
    ],
  },
  {
    id: 'edu-2036-09-human-centered-schools',
    domain: 'social',
    month: 8,
    year: 2036,
    probability: 0.67,
    title: 'Schools center community, leadership, and well-being over content',
    description:
      'Education systems shift toward cultivating collaboration, mentorship, and civic norms while AI handles most instruction, reflecting education as social development and curation.',
    impact: 'high',
    sources: [
      { name: 'AI 2027', url: 'https://ai-2027.com/summary', confidence: 0.64 },
      { name: 'AI Futures Model', url: 'https://www.aifuturesmodel.com/about', confidence: 0.62 },
    ],
  },
  {
    id: 'edu-2026-01-ai-tutor-default',
    domain: 'tech',
    month: 0,
    year: 2026,
    probability: 0.78,
    title: 'AI tutors become default scaffolding in affluent systems',
    description:
      '1:1 AI coaching for practice, explanations, and study planning becomes the default baseline; teachers reallocate time toward motivation, class culture, and targeted interventions.',
    impact: 'high',
    sources: [
      { name: 'Reuters', url: 'https://www.reuters.com/world/asia-pacific/china-rely-artificial-intelligence-education-reform-bid-2025-04-17/', confidence: 0.8 },
      { name: 'UNESCO', url: 'https://www.unesco.org/en/digital-education/ai-future-learning', confidence: 0.74 },
    ],
  },
  {
    id: 'edu-2026-09-assessment-bifurcates',
    domain: 'governance',
    month: 8,
    year: 2026,
    probability: 0.7,
    title: 'Assessment splits into AI-permitted and AI-restricted tracks',
    description:
      'Systems formalize dual pathways: open-book, AI-assisted work that rewards synthesis and iteration, alongside proctored AI-restricted checkpoints for foundational skills and integrity.',
    impact: 'medium',
    sources: [
      { name: 'UNESCO', url: 'https://www.unesco.org/en/digital-education/ai-future-learning', confidence: 0.72 },
    ],
  },
  {
    id: 'edu-2026-11-teacher-orchestration',
    domain: 'social',
    month: 10,
    year: 2026,
    probability: 0.74,
    title: 'Teachers shift toward orchestration and pastoral roles',
    description:
      'With AI covering first-draft explanations and routine feedback, teachers emphasize motivation, class culture, project guidance, and personalized interventions.',
    impact: 'medium',
    sources: [
      { name: 'AI 2027', url: 'https://ai-2027.com/summary', confidence: 0.68 },
      { name: 'AI Futures Model', url: 'https://www.aifuturesmodel.com/about', confidence: 0.66 },
    ],
  },
  {
    id: 'edu-2029-02-mastery-maps',
    domain: 'governance',
    month: 1,
    year: 2029,
    probability: 0.69,
    title: 'Curricula unbundle into mastery maps with individualized pacing',
    description:
      'Course pacing guides give way to competency maps that unlock concepts as students demonstrate understanding, coordinated by AI tutors that manage sequencing at scale.',
    impact: 'medium',
    sources: [
      { name: 'AI Futures Model', url: 'https://www.aifuturesmodel.com/about', confidence: 0.67 },
    ],
  },
  {
    id: 'edu-2030-06-immersive-learning-mainstream',
    domain: 'tech',
    month: 5,
    year: 2030,
    probability: 0.71,
    title: 'VR and immersive learning become mainstream',
    description:
      'Virtual and hybrid instruction expands beyond video conferencing into rich simulations and labs as consumer-grade VR/AR hardware becomes broadly accessible.',
    impact: 'high',
    sources: [
      { name: 'FutureTimeline', url: 'https://futuretimeline.net/21stcentury/2030.htm', confidence: 0.73 },
    ],
  },
  {
    id: 'edu-2031-04-dynamic-content-platforms',
    domain: 'economic',
    month: 3,
    year: 2031,
    probability: 0.66,
    title: 'Dynamic content platforms replace static textbooks',
    description:
      'Schools license adaptive platforms that generate local, level-appropriate materials and continuously refresh content instead of buying fixed textbooks.',
    impact: 'medium',
    sources: [
      { name: 'FutureTimeline', url: 'https://futuretimeline.net/21stcentury/2030.htm', confidence: 0.62 },
    ],
  },
  {
    id: 'edu-2031-09-private-tutoring-disrupted',
    domain: 'economic',
    month: 8,
    year: 2031,
    probability: 0.68,
    title: 'Private tutoring market is disrupted by AI baselines',
    description:
      'Affordable AI tutoring substitutes most entry-level private tutoring, pushing human tutors to specialize in high-touch, premium niches.',
    impact: 'medium',
    sources: [
      { name: 'AI Futures Model', url: 'https://www.aifuturesmodel.com/about', confidence: 0.65 },
    ],
  },
  {
    id: 'edu-2032-03-microcredentials-rise',
    domain: 'governance',
    month: 2,
    year: 2032,
    probability: 0.72,
    title: 'Micro-credentials and verified skills eclipse many degrees',
    description:
      'Stackable, tightly mapped credentials gain status as autonomous course-building systems enable rapid updates and clearer links to demonstrable skills.',
    impact: 'high',
    sources: [
      { name: 'LessWrong', url: 'https://www.lesswrong.com/posts/YABG5JmztGGPwNFq2/ai-futures-timelines-and-takeoff-model-dec-2025-update', confidence: 0.74 },
    ],
  },
  {
    id: 'edu-2033-07-continuous-verification',
    domain: 'governance',
    month: 6,
    year: 2033,
    probability: 0.7,
    title: 'Continuous identity and provenance checks reshape assessment',
    description:
      'Assessment relies more on lightweight identity verification, oral defenses, and practical tasks, reducing reliance on unproctored essays as AI capabilities grow.',
    impact: 'medium',
    sources: [
      { name: 'AI Futures Model', url: 'https://www.aifuturesmodel.com/about', confidence: 0.68 },
    ],
  },
  {
    id: 'edu-2034-11-degree-decomposition',
    domain: 'social',
    month: 10,
    year: 2034,
    probability: 0.65,
    title: 'Traditional degrees decompose into verified cores plus specializations',
    description:
      'Universities restructure programs into verified foundational cores paired with stackable specializations tied to labor-market signals and rapid refresh cycles.',
    impact: 'medium',
    sources: [
      { name: 'LessWrong', url: 'https://www.lesswrong.com/posts/YABG5JmztGGPwNFq2/ai-futures-timelines-and-takeoff-model-dec-2025-update', confidence: 0.67 },
    ],
  },
  {
    id: 'edu-2035-05-ambient-learning-layer',
    domain: 'individual',
    month: 4,
    year: 2035,
    probability: 0.69,
    title: 'Ambient lifelong learning layers into daily tools',
    description:
      'Workflows and consumer tools embed coaching, just-in-time explanations, and simulations so learning becomes a continual background activity across life.',
    impact: 'medium',
    sources: [
      { name: 'FutureTimeline', url: 'https://futuretimeline.net/21stcentury/2030.htm', confidence: 0.66 },
    ],
  },
  {
    id: 'edu-2036-09-human-centered-schools',
    domain: 'social',
    month: 8,
    year: 2036,
    probability: 0.67,
    title: 'Schools center community, leadership, and well-being over content',
    description:
      'Education systems shift toward cultivating collaboration, mentorship, and civic norms while AI handles most instruction, reflecting education as social development and curation.',
    impact: 'high',
    sources: [
      { name: 'AI 2027', url: 'https://ai-2027.com/summary', confidence: 0.64 },
      { name: 'AI Futures Model', url: 'https://www.aifuturesmodel.com/about', confidence: 0.62 },
    ],
  },
  {
    id: 'edu-2026-01-ai-tutor-default',
    domain: 'tech',
    month: 0,
    year: 2026,
    probability: 0.78,
    title: 'AI tutors become default scaffolding in affluent systems',
    description:
      '1:1 AI coaching for practice, explanations, and study planning becomes the default baseline; teachers reallocate time toward motivation, class culture, and targeted interventions.',
    impact: 'high',
    sources: [
      { name: 'Reuters', url: 'https://www.reuters.com/world/asia-pacific/china-rely-artificial-intelligence-education-reform-bid-2025-04-17/', confidence: 0.8 },
      { name: 'UNESCO', url: 'https://www.unesco.org/en/digital-education/ai-future-learning', confidence: 0.74 },
    ],
  },
  {
    id: 'edu-2026-09-assessment-bifurcates',
    domain: 'governance',
    month: 8,
    year: 2026,
    probability: 0.7,
    title: 'Assessment splits into AI-permitted and AI-restricted tracks',
    description:
      'Systems formalize dual pathways: open-book, AI-assisted work that rewards synthesis and iteration, alongside proctored AI-restricted checkpoints for foundational skills and integrity.',
    impact: 'medium',
    sources: [
      { name: 'UNESCO', url: 'https://www.unesco.org/en/digital-education/ai-future-learning', confidence: 0.72 },
    ],
  },
  {
    id: 'edu-2026-11-teacher-orchestration',
    domain: 'social',
    month: 10,
    year: 2026,
    probability: 0.74,
    title: 'Teachers shift toward orchestration and pastoral roles',
    description:
      'With AI covering first-draft explanations and routine feedback, teachers emphasize motivation, class culture, project guidance, and personalized interventions.',
    impact: 'medium',
    sources: [
      { name: 'AI 2027', url: 'https://ai-2027.com/summary', confidence: 0.68 },
      { name: 'AI Futures Model', url: 'https://www.aifuturesmodel.com/about', confidence: 0.66 },
    ],
  },
  {
    id: 'edu-2029-02-mastery-maps',
    domain: 'governance',
    month: 1,
    year: 2029,
    probability: 0.69,
    title: 'Curricula unbundle into mastery maps with individualized pacing',
    description:
      'Course pacing guides give way to competency maps that unlock concepts as students demonstrate understanding, coordinated by AI tutors that manage sequencing at scale.',
    impact: 'medium',
    sources: [
      { name: 'AI Futures Model', url: 'https://www.aifuturesmodel.com/about', confidence: 0.67 },
    ],
  },
  {
    id: 'edu-2030-06-immersive-learning-mainstream',
    domain: 'tech',
    month: 5,
    year: 2030,
    probability: 0.71,
    title: 'VR and immersive learning become mainstream',
    description:
      'Virtual and hybrid instruction expands beyond video conferencing into rich simulations and labs as consumer-grade VR/AR hardware becomes broadly accessible.',
    impact: 'high',
    sources: [
      { name: 'FutureTimeline', url: 'https://futuretimeline.net/21stcentury/2030.htm', confidence: 0.73 },
    ],
  },
  {
    id: 'edu-2031-04-dynamic-content-platforms',
    domain: 'economic',
    month: 3,
    year: 2031,
    probability: 0.66,
    title: 'Dynamic content platforms replace static textbooks',
    description:
      'Schools license adaptive platforms that generate local, level-appropriate materials and continuously refresh content instead of buying fixed textbooks.',
    impact: 'medium',
    sources: [
      { name: 'FutureTimeline', url: 'https://futuretimeline.net/21stcentury/2030.htm', confidence: 0.62 },
    ],
  },
  {
    id: 'edu-2031-09-private-tutoring-disrupted',
    domain: 'economic',
    month: 8,
    year: 2031,
    probability: 0.68,
    title: 'Private tutoring market is disrupted by AI baselines',
    description:
      'Affordable AI tutoring substitutes most entry-level private tutoring, pushing human tutors to specialize in high-touch, premium niches.',
    impact: 'medium',
    sources: [
      { name: 'AI Futures Model', url: 'https://www.aifuturesmodel.com/about', confidence: 0.65 },
    ],
  },
  {
    id: 'edu-2032-03-microcredentials-rise',
    domain: 'governance',
    month: 2,
    year: 2032,
    probability: 0.72,
    title: 'Micro-credentials and verified skills eclipse many degrees',
    description:
      'Stackable, tightly mapped credentials gain status as autonomous course-building systems enable rapid updates and clearer links to demonstrable skills.',
    impact: 'high',
    sources: [
      { name: 'LessWrong', url: 'https://www.lesswrong.com/posts/YABG5JmztGGPwNFq2/ai-futures-timelines-and-takeoff-model-dec-2025-update', confidence: 0.74 },
    ],
  },
  {
    id: 'edu-2033-07-continuous-verification',
    domain: 'governance',
    month: 6,
    year: 2033,
    probability: 0.7,
    title: 'Continuous identity and provenance checks reshape assessment',
    description:
      'Assessment relies more on lightweight identity verification, oral defenses, and practical tasks, reducing reliance on unproctored essays as AI capabilities grow.',
    impact: 'medium',
    sources: [
      { name: 'AI Futures Model', url: 'https://www.aifuturesmodel.com/about', confidence: 0.68 },
    ],
  },
  {
    id: 'edu-2034-11-degree-decomposition',
    domain: 'social',
    month: 10,
    year: 2034,
    probability: 0.65,
    title: 'Traditional degrees decompose into verified cores plus specializations',
    description:
      'Universities restructure programs into verified foundational cores paired with stackable specializations tied to labor-market signals and rapid refresh cycles.',
    impact: 'medium',
    sources: [
      { name: 'LessWrong', url: 'https://www.lesswrong.com/posts/YABG5JmztGGPwNFq2/ai-futures-timelines-and-takeoff-model-dec-2025-update', confidence: 0.67 },
    ],
  },
  {
    id: 'edu-2035-05-ambient-learning-layer',
    domain: 'individual',
    month: 4,
    year: 2035,
    probability: 0.69,
    title: 'Ambient lifelong learning layers into daily tools',
    description:
      'Workflows and consumer tools embed coaching, just-in-time explanations, and simulations so learning becomes a continual background activity across life.',
    impact: 'medium',
    sources: [
      { name: 'FutureTimeline', url: 'https://futuretimeline.net/21stcentury/2030.htm', confidence: 0.66 },
    ],
  },
  {
    id: 'edu-2036-09-human-centered-schools',
    domain: 'social',
    month: 8,
    year: 2036,
    probability: 0.67,
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
