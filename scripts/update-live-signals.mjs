#!/usr/bin/env node
/*
  Ingests significant timeline signals from:
  - X API (recent tweets search)
  - Polymarket Gamma API (active markets)

  Output: public/data/live-signals.json
*/

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const outputPath = path.join(projectRoot, 'public', 'data', 'live-signals.json');

const DOMAIN_KEYWORDS = {
  tech: ['agi', 'asi', 'model', 'llm', 'compute', 'gpu', 'robot', 'agent', 'alignment', 'ai'],
  governance: ['regulation', 'law', 'policy', 'treaty', 'compliance', 'standards'],
  geopolitical: ['china', 'us', 'war', 'export control', 'sanction', 'geopolitic', 'conflict'],
  economic: ['market', 'valuation', 'gdp', 'inflation', 'recession', 'jobs', 'employment'],
  social: ['education', 'society', 'labor', 'culture', 'demographic', 'adoption'],
  individual: ['health', 'longevity', 'therapy', 'personal', 'consumer', 'household'],
};

const ALL_DOMAINS = /** @type {const} */ (['individual', 'social', 'tech', 'economic', 'geopolitical', 'governance']);

const POSITIVE_WORDS = [
  'breakthrough',
  'approval',
  'launch',
  'wins',
  'record',
  'accelerate',
  'upgrades',
  'expands',
  'improves',
  'beats',
  'gains',
  'surge',
];

const NEGATIVE_WORDS = [
  'ban',
  'blocked',
  'delay',
  'lawsuit',
  'risk',
  'conflict',
  'crash',
  'hack',
  'sanction',
  'restriction',
  'decline',
  'shortage',
];

const POLY_AI_TERMS = [
  'ai',
  'agi',
  'artificial intelligence',
  'openai',
  'anthropic',
  'deepmind',
  'xai',
  'robot',
  'chip',
  'semiconductor',
  'automation',
  'regulation',
];

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function detectDomain(text) {
  const source = (text || '').toLowerCase();
  let bestDomain = 'tech';
  let bestScore = -1;

  for (const domain of ALL_DOMAINS) {
    const keywords = DOMAIN_KEYWORDS[domain] || [];
    const score = keywords.reduce((acc, keyword) => acc + (source.includes(keyword) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestDomain = domain;
    }
  }

  return bestDomain;
}

function detectDirection(text) {
  const source = (text || '').toLowerCase();
  const positive = POSITIVE_WORDS.reduce((acc, keyword) => acc + (source.includes(keyword) ? 1 : 0), 0);
  const negative = NEGATIVE_WORDS.reduce((acc, keyword) => acc + (source.includes(keyword) ? 1 : 0), 0);

  if (positive === negative) return 1;
  return positive > negative ? 1 : -1;
}

function inferImpactDelta(significance, direction, scale = 0.07) {
  return clamp(direction * (0.008 + significance * scale), -0.16, 0.16);
}

function safeJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseDate(dateValue, fallback = new Date()) {
  const d = new Date(dateValue);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function toYearMonth(dateValue, fallbackDate = new Date()) {
  const d = parseDate(dateValue, fallbackDate);
  return { targetYear: d.getUTCFullYear(), targetMonth: d.getUTCMonth() };
}

function idPrefix(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} for ${url}: ${body.slice(0, 240)}`);
  }
  return response.json();
}

async function loadSignalsFromX(now) {
  const token = process.env.X_BEARER_TOKEN?.trim();
  if (!token) {
    return { signals: [], status: 'missing-token' };
  }

  const query = process.env.X_QUERY
    || '(AGI OR ASI OR "artificial general intelligence" OR OpenAI OR Anthropic OR DeepMind OR xAI OR "AI regulation" OR "chip export") lang:en -is:retweet';
  const maxResults = clamp(Number(process.env.X_MAX_RESULTS || 40), 10, 100);

  const params = new URLSearchParams({
    query,
    max_results: String(maxResults),
    'tweet.fields': 'created_at,public_metrics,author_id,lang',
    expansions: 'author_id',
    'user.fields': 'name,username,verified',
  });

  const url = `https://api.x.com/2/tweets/search/recent?${params.toString()}`;
  const payload = await fetchJson(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'post-agi-planning-live-signals/1.0',
    },
  });

  const users = new Map((payload?.includes?.users || []).map((u) => [u.id, u]));
  const tweets = payload?.data || [];

  const signals = tweets.map((tweet) => {
    const user = users.get(tweet.author_id);
    const text = String(tweet.text || '').replace(/\s+/g, ' ').trim();
    const metrics = tweet.public_metrics || {};

    const engagement =
      Number(metrics.like_count || 0)
      + Number(metrics.retweet_count || 0) * 2
      + Number(metrics.quote_count || 0) * 2
      + Number(metrics.reply_count || 0);

    const verifiedBoost = user?.verified ? 0.08 : 0;
    const significance = clamp(Math.log10(engagement + 1) / 3 + verifiedBoost, 0.05, 1);

    const direction = detectDirection(text);
    const probabilityDelta = inferImpactDelta(significance, direction, 0.065);
    const { targetYear, targetMonth } = toYearMonth(tweet.created_at, now);
    const headline = text.length > 120 ? `${text.slice(0, 117)}...` : text;

    return {
      id: `x-${tweet.id || idPrefix('tweet')}`,
      source: 'x',
      timestamp: tweet.created_at || now.toISOString(),
      headline,
      summary: text,
      url: user?.username
        ? `https://x.com/${user.username}/status/${tweet.id}`
        : `https://x.com/i/web/status/${tweet.id}`,
      domain: detectDomain(text),
      targetYear,
      targetMonth,
      probabilityDelta,
      significance,
      tags: Array.from(new Set((text.match(/#\w+/g) || []).map((tag) => tag.toLowerCase().replace('#', '')))).slice(0, 8),
      horizonMonths: 3,
    };
  });

  return { signals, status: `ok(${signals.length})` };
}

async function loadSignalsFromPolymarket(now) {
  const apiBase = process.env.POLYMARKET_API_BASE || 'https://gamma-api.polymarket.com';
  const limit = clamp(Number(process.env.POLYMARKET_LIMIT || 400), 50, 500);

  const url = `${apiBase}/markets?active=true&closed=false&limit=${limit}`;
  const markets = await fetchJson(url);

  const filtered = (Array.isArray(markets) ? markets : []).filter((market) => {
    const text = `${market.question || ''} ${market.description || ''}`.toLowerCase();
    return POLY_AI_TERMS.some((term) => text.includes(term));
  });

  const signals = filtered.slice(0, 60).map((market) => {
    const outcomes = safeJsonArray(market.outcomes);
    const outcomePrices = safeJsonArray(market.outcomePrices).map((value) => Number(value));

    const yesIdx = outcomes.findIndex((value) => String(value).toLowerCase() === 'yes');
    const probability = clamp(Number(outcomePrices[yesIdx >= 0 ? yesIdx : 0] || 0.5), 0.01, 0.99);

    const volume = Number(market.volume24hr || market.volume || 0);
    const liquidity = Number(market.liquidity || 0);
    const significance = clamp(Math.log10(volume + 1) / 6 + Math.log10(liquidity + 1) / 8, 0.08, 1);

    const direction = probability >= 0.5 ? 1 : -1;
    const probabilityDelta = clamp((probability - 0.5) * 0.22, -0.16, 0.16);

    const { targetYear, targetMonth } = toYearMonth(market.endDate, now);
    const question = String(market.question || market.title || 'Polymarket signal').replace(/\s+/g, ' ').trim();

    return {
      id: `poly-${market.id || idPrefix('mkt')}`,
      source: 'polymarket',
      timestamp: market.updatedAt || market.createdAt || now.toISOString(),
      headline: question,
      summary: `${question} • market probability ${(probability * 100).toFixed(1)}%`,
      url: market.slug ? `https://polymarket.com/event/${market.slug}` : 'https://polymarket.com',
      domain: detectDomain(`${question} ${market.description || ''}`),
      targetYear,
      targetMonth,
      probabilityDelta: direction === 1 ? Math.abs(probabilityDelta) : -Math.abs(probabilityDelta),
      significance,
      tags: ['polymarket', 'prediction-market'],
      marketProbability: probability,
      horizonMonths: 3,
    };
  });

  return { signals, status: `ok(${signals.length})` };
}

function dedupeSignals(signals) {
  const seen = new Set();
  return signals.filter((signal) => {
    const key = `${signal.source}:${signal.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function main() {
  const now = new Date();
  const windowHours = clamp(Number(process.env.SIGNAL_WINDOW_HOURS || 24), 1, 168);

  const [xResult, polyResult] = await Promise.allSettled([
    loadSignalsFromX(now),
    loadSignalsFromPolymarket(now),
  ]);

  const xSignals = xResult.status === 'fulfilled' ? xResult.value.signals : [];
  const polySignals = polyResult.status === 'fulfilled' ? polyResult.value.signals : [];

  const sourceStatus = {
    x: xResult.status === 'fulfilled' ? xResult.value.status : `error(${xResult.reason?.message || 'unknown'})`,
    polymarket: polyResult.status === 'fulfilled' ? polyResult.value.status : `error(${polyResult.reason?.message || 'unknown'})`,
  };

  let mergedSignals = dedupeSignals([...xSignals, ...polySignals]);

  mergedSignals = mergedSignals
    .filter((signal) => Math.abs(signal.probabilityDelta) >= 0.005)
    .sort((a, b) => {
      const bySignificance = b.significance - a.significance;
      if (bySignificance !== 0) return bySignificance;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    })
    .slice(0, clamp(Number(process.env.SIGNAL_MAX_ITEMS || 120), 20, 200));

  const payload = {
    generatedAt: now.toISOString(),
    windowHours,
    sourceStatus,
    signals: mergedSignals,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2));

  console.log(`Wrote ${mergedSignals.length} signals to ${outputPath}`);
  console.log(`Source status: x=${sourceStatus.x}, polymarket=${sourceStatus.polymarket}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
