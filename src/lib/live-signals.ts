import type { Domain, MonthData, Prediction } from './types';
import { getMonthName } from './predictions';

export type LiveSignalSource = 'x' | 'polymarket';

export interface LiveSignal {
  id: string;
  source: LiveSignalSource;
  timestamp: string;
  headline: string;
  summary: string;
  url?: string;
  domain: Domain;
  targetYear: number;
  targetMonth: number;
  probabilityDelta: number;
  significance: number;
  tags?: string[];
  marketProbability?: number;
  horizonMonths?: number;
}

export interface LiveSignalSnapshot {
  generatedAt: string;
  windowHours: number;
  signals: LiveSignal[];
  sourceStatus?: Record<string, string>;
}

export interface DomainSignalImpact {
  domain: Domain;
  count: number;
  netDelta: number;
  avgSignificance: number;
}

const VALID_DOMAINS: Domain[] = [
  'individual',
  'social',
  'tech',
  'economic',
  'geopolitical',
  'governance',
];

const SIGNAL_FILE = '/data/live-signals.json';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getMonthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function offsetYearMonth(year: number, month: number, offset: number): { year: number; month: number } {
  const idx = year * 12 + month + offset;
  return {
    year: Math.floor(idx / 12),
    month: ((idx % 12) + 12) % 12,
  };
}

function toSignalPrediction(signal: LiveSignal): Prediction {
  const deltaPoints = signal.probabilityDelta * 100;
  const absDelta = Math.abs(signal.probabilityDelta);
  const impact: Prediction['impact'] = absDelta >= 0.08 ? 'high' : absDelta >= 0.04 ? 'medium' : 'low';
  const direction = deltaPoints >= 0 ? 'upward' : 'downward';

  return {
    id: `signal-${signal.id}`,
    domain: signal.domain,
    month: signal.targetMonth,
    year: signal.targetYear,
    probability: clamp(0.5 + signal.probabilityDelta * 2, 0.05, 0.95),
    title: `[Signal] ${signal.headline}`,
    description: `${signal.summary} (${signal.source.toUpperCase()} suggests ${direction} pressure of ${deltaPoints >= 0 ? '+' : ''}${deltaPoints.toFixed(1)}pp).`,
    impact,
    sources: [
      {
        name: signal.source === 'x' ? 'X API signal' : 'Polymarket market signal',
        url: signal.url,
        confidence: clamp(signal.significance, 0.05, 1),
      },
    ],
  };
}

function normalizeSignal(raw: LiveSignal): LiveSignal | null {
  if (!raw || !raw.id || !raw.domain || !VALID_DOMAINS.includes(raw.domain)) {
    return null;
  }

  const month = Number(raw.targetMonth);
  const year = Number(raw.targetYear);

  if (!Number.isInteger(month) || month < 0 || month > 11 || !Number.isInteger(year) || year < 2000 || year > 2200) {
    return null;
  }

  return {
    ...raw,
    significance: clamp(Number(raw.significance || 0), 0, 1),
    probabilityDelta: clamp(Number(raw.probabilityDelta || 0), -0.2, 0.2),
    horizonMonths: clamp(Number(raw.horizonMonths || 3), 1, 6),
  };
}

export async function loadLiveSignals(signalFile: string = SIGNAL_FILE): Promise<LiveSignalSnapshot> {
  const response = await fetch(`${signalFile}?t=${Date.now()}`, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`Failed to load live signals (${response.status})`);
  }

  const payload = await response.json();
  const signals = Array.isArray(payload?.signals)
    ? payload.signals.map((s: LiveSignal) => normalizeSignal(s)).filter(Boolean)
    : [];

  return {
    generatedAt: payload?.generatedAt || new Date().toISOString(),
    windowHours: Number(payload?.windowHours || 24),
    signals: signals as LiveSignal[],
    sourceStatus: payload?.sourceStatus || {},
  };
}

export function summarizeSignalImpact(signals: LiveSignal[]): DomainSignalImpact[] {
  const map = new Map<Domain, { count: number; netDelta: number; significanceTotal: number }>();

  signals.forEach((signal) => {
    const current = map.get(signal.domain) || { count: 0, netDelta: 0, significanceTotal: 0 };
    current.count += 1;
    current.netDelta += signal.probabilityDelta;
    current.significanceTotal += signal.significance;
    map.set(signal.domain, current);
  });

  return VALID_DOMAINS.map((domain) => {
    const current = map.get(domain) || { count: 0, netDelta: 0, significanceTotal: 0 };
    return {
      domain,
      count: current.count,
      netDelta: current.netDelta,
      avgSignificance: current.count > 0 ? current.significanceTotal / current.count : 0,
    };
  });
}

export function applySignalsToTimeline(data: MonthData[], signals: LiveSignal[]): MonthData[] {
  if (!signals || signals.length === 0) {
    return data;
  }

  const copied = data.map((monthData) => ({
    ...monthData,
    probabilities: { ...monthData.probabilities },
    predictions: [...monthData.predictions],
  }));

  const monthIndex = new Map<string, MonthData>();
  copied.forEach((monthData) => {
    monthIndex.set(getMonthKey(monthData.year, monthData.month), monthData);
  });

  const decayByOffset = [1, 0.58, 0.35, 0.2, 0.12, 0.08];

  signals.forEach((signal) => {
    const horizon = Math.max(1, Math.min(signal.horizonMonths || 3, 6));

    for (let offset = 0; offset < horizon; offset++) {
      const weight = decayByOffset[offset] ?? decayByOffset[decayByOffset.length - 1];
      const { year, month } = offsetYearMonth(signal.targetYear, signal.targetMonth, offset);
      const monthData = monthIndex.get(getMonthKey(year, month));
      if (!monthData) continue;

      monthData.probabilities[signal.domain] = clamp(
        monthData.probabilities[signal.domain] + signal.probabilityDelta * weight,
        0.01,
        0.99
      );

      if (offset === 0) {
        const signalPrediction = toSignalPrediction(signal);
        if (!monthData.predictions.find((p) => p.id === signalPrediction.id)) {
          monthData.predictions.push(signalPrediction);
        }
      }
    }
  });

  return copied;
}

export function formatSignalTarget(signal: LiveSignal): string {
  return `${getMonthName(signal.targetMonth)} ${signal.targetYear}`;
}
