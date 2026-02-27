#!/usr/bin/env node
/*
  Ingests significant timeline signals from:
  - X API (recent tweets search)
  - Polymarket Gamma API (active markets)

  Output: public/data/live-signals.json

  This version aggressively filters for post-AGI planning relevance so
  unrelated markets/news (sports, celebrity, etc.) do not enter the feed.
*/

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const outputPath = path.join(projectRoot, 'public', 'data', 'live-signals.json');

const DOMAIN_KEYWORDS = {
  tech: ['agi', 'asi', 'model', 'llm', 'compute', 'gpu', 'robot', 'agent', 'alignment', 'ai', 'chip', 'semiconductor'],
  governance: ['regulation', 'law', 'policy', 'treaty', 'compliance', 'standards', 'licensing'],
  geopolitical: ['export control', 'sanction', 'supply chain', 'critical minerals', 'taiwan', 'chip war', 'geopolitic'],
  economic: ['productivity', 'labor', 'employment', 'gdp', 'inflation', 'capex', 'energy demand', 'market'],
  social: ['education', 'society', 'misinformation', 'public trust', 'adoption'],
  individual: ['health', 'longevity', 'therapy', 'bci', 'personal ai', 'consumer ai'],
};

const ALL_DOMAINS = /** @type {const} */ (['individual', 'social', 'tech', 'economic', 'geopolitical', 'governance']);

const POST_AGI_PRIMARY_TERMS = [
  'agi',
  'asi',
  'artificial intelligence',
  'foundation model',
  'frontier model',
  'llm',
  'openai',
  'anthropic',
  'deepmind',
  'xai',
  'gpu',
  'compute cluster',
  'training run',
  'inference',
  'datacenter',
  'semiconductor',
  'chip export',
  'export control',
  'chip ban',
  'nvidia',
  'asml',
  'tsmc',
  'autonomous agent',
  'agentic',
  'robotics',
  'automation',
  'ai safety',
  'alignment',
  'power grid',
  'energy demand',
  'nuclear power',
  'biosecurity',
  'cybersecurity',
  'critical minerals',
];

const POST_AGI_CONTEXT_TERMS = [
  'regulation',
  'policy',
  'governance',
  'compliance',
  'treaty',
  'sanction',
  'supply chain',
  'electricity',
  'productivity',
  'labor market',
  'job displacement',
  'unemployment',
  'infrastructure',
  'geopolitical',
  'defense',
  'military',
];

const EXCLUSION_TERMS = [
  'nba',
  'nfl',
  'nhl',
  'mlb',
  'fifa',
  'world cup',
  'mvp',
  'rookie',
  'playoffs',
  'finals',
  'oscars',
  'grammys',
  'box office',
  'celebrity',
  'sentenced',
  'prison',
  'movie',
  'album',
  'concert',
];

const POSITIVE_WORDS = [
  'breakthrough',
  'approval',
  'launch',
  'record',
  'accelerate',
  'expand',
  'improve',
  'gain',
  'surge',
  'increase',
  'deployed',
];

const NEGATIVE_WORDS = [
  'ban',
  'blocked',
  'delay',
  'risk',
  'conflict',
  'hack',
  'sanction',
  'restriction',
  'decline',
  'shortage',
  'outage',
  'slowdown',
];

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function hasTerm(text, term) {
  const source = normalizeText(text);
  const needle = normalizeText(term);
  if (!source || !needle) return false;

  if (needle.includes(' ')) {
    return source.includes(needle);
  }

  const re = new RegExp(`(^|[^a-z0-9])${escapeRegex(needle)}([^a-z0-9]|$)`, 'i');
  return re.test(source);
}

function matchedTerms(text, terms) {
  return terms.filter((term) => hasTerm(text, term));
}

function evaluatePostAgiRelevance(text) {
  const primaryMatches = matchedTerms(text, POST_AGI_PRIMARY_TERMS);
  const contextMatches = matchedTerms(text, POST_AGI_CONTEXT_TERMS);
  const exclusionMatches = matchedTerms(text, EXCLUSION_TERMS);

  const score = primaryMatches.length * 2 + contextMatches.length - exclusionMatches.length * 2;

  return {
    primaryMatches,
    contextMatches,
    exclusionMatches,
    score,
    isRelevant: primaryMatches.length >= 1 && score >= 2,
  };
}

function detectDomain(text) {
  const source = normalizeText(text);
  let bestDomain = 'tech';
  let bestScore = -1;

  for (const domain of ALL_DOMAINS) {
    const keywords = DOMAIN_KEYWORDS[domain] || [];
    const score = keywords.reduce((acc, keyword) => acc + (hasTerm(source, keyword) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestDomain = domain;
    }
  }

  return bestDomain;
}

function detectDirection(text) {
  const source = normalizeText(text);
  const positive = POSITIVE_WORDS.reduce((acc, keyword) => acc + (hasTerm(source, keyword) ? 1 : 0), 0);
  const negative = NEGATIVE_WORDS.reduce((acc, keyword) => acc + (hasTerm(source, keyword) ? 1 : 0), 0);

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

function compactTag(term) {
  return String(term || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

function relevanceTags(relevance, maxTags = 6) {
  return Array.from(
    new Set([...relevance.primaryMatches.slice(0, 4), ...relevance.contextMatches.slice(0, 3)].map(compactTag).filter(Boolean))
  ).slice(0, maxTags);
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
    || '(AGI OR ASI OR "artificial general intelligence" OR OpenAI OR Anthropic OR DeepMind OR xAI OR "AI regulation" OR "chip export" OR semiconductor OR datacenter) lang:en -is:retweet';
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
  const signals = [];

  for (const tweet of tweets) {
    const user = users.get(tweet.author_id);
    const text = String(tweet.text || '').replace(/\s+/g, ' ').trim();
    const relevance = evaluatePostAgiRelevance(text);
    if (!relevance.isRelevant) continue;

    const metrics = tweet.public_metrics || {};
    const engagement =
      Number(metrics.like_count || 0)
      + Number(metrics.retweet_count || 0) * 2
      + Number(metrics.quote_count || 0) * 2
      + Number(metrics.reply_count || 0);

    const verifiedBoost = user?.verified ? 0.08 : 0;
    const relevanceBoost = clamp(relevance.score * 0.02, 0, 0.18);
    const significance = clamp(Math.log10(engagement + 1) / 3 + verifiedBoost + relevanceBoost, 0.08, 1);

    const direction = detectDirection(text);
    const probabilityDelta = inferImpactDelta(significance, direction, 0.06);
    const { targetYear, targetMonth } = toYearMonth(tweet.created_at, now);
    const headline = text.length > 120 ? `${text.slice(0, 117)}...` : text;

    signals.push({
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
      tags: Array.from(
        new Set([
          ...((text.match(/#\w+/g) || []).map((tag) => tag.toLowerCase().replace('#', ''))),
          ...relevanceTags(relevance),
          'x',
        ])
      ).slice(0, 10),
      horizonMonths: 3,
    });
  }

  return { signals, status: `ok(raw=${tweets.length},kept=${signals.length})` };
}

async function loadSignalsFromPolymarket(now) {
  const apiBase = process.env.POLYMARKET_API_BASE || 'https://gamma-api.polymarket.com';
  const limit = clamp(Number(process.env.POLYMARKET_LIMIT || 400), 50, 800);

  const url = `${apiBase}/markets?active=true&closed=false&limit=${limit}`;
  const markets = await fetchJson(url);
  const rawMarkets = Array.isArray(markets) ? markets : [];

  const relevantMarkets = rawMarkets
    .map((market) => {
      const text = `${market.question || ''} ${market.description || ''}`.trim();
      return { market, text, relevance: evaluatePostAgiRelevance(text) };
    })
    .filter((entry) => entry.relevance.isRelevant);

  const signals = relevantMarkets.slice(0, 80).map(({ market, text, relevance }) => {
    const outcomes = safeJsonArray(market.outcomes);
    const outcomePrices = safeJsonArray(market.outcomePrices).map((value) => Number(value));

    const yesIdx = outcomes.findIndex((value) => String(value).toLowerCase() === 'yes');
    const probability = clamp(Number(outcomePrices[yesIdx >= 0 ? yesIdx : 0] || 0.5), 0.01, 0.99);

    const volume = Number(market.volume24hr || market.volume || 0);
    const liquidity = Number(market.liquidity || 0);
    const baseSignificance = clamp(Math.log10(volume + 1) / 6 + Math.log10(liquidity + 1) / 8, 0.08, 1);
    const relevanceBoost = clamp(relevance.score * 0.02, 0, 0.18);
    const significance = clamp(baseSignificance + relevanceBoost, 0.08, 1);

    const centeredProbability = probability - 0.5;
    const probabilityDelta = clamp(centeredProbability * (0.22 + relevance.score * 0.01), -0.18, 0.18);

    const { targetYear, targetMonth } = toYearMonth(market.endDate, now);
    const question = String(market.question || market.title || 'Polymarket signal').replace(/\s+/g, ' ').trim();

    return {
      id: `poly-${market.id || idPrefix('mkt')}`,
      source: 'polymarket',
      timestamp: market.updatedAt || market.createdAt || now.toISOString(),
      headline: question,
      summary: `${question} • market probability ${(probability * 100).toFixed(1)}%`,
      url: market.slug ? `https://polymarket.com/event/${market.slug}` : 'https://polymarket.com',
      domain: detectDomain(text),
      targetYear,
      targetMonth,
      probabilityDelta,
      significance,
      tags: Array.from(new Set(['polymarket', 'prediction-market', ...relevanceTags(relevance, 5)])),
      marketProbability: probability,
      horizonMonths: 3,
    };
  });

  return { signals, status: `ok(raw=${rawMarkets.length},kept=${signals.length})` };
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
  const cutoffMs = now.getTime() - windowHours * 60 * 60 * 1000;

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
    .filter((signal) => Math.abs(signal.probabilityDelta) >= 0.008)
    .filter((signal) => {
      const ts = new Date(signal.timestamp).getTime();
      return !Number.isFinite(ts) || ts >= cutoffMs;
    })
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

  console.log(`Wrote ${mergedSignals.length} relevance-filtered signals to ${outputPath}`);
  console.log(`Source status: x=${sourceStatus.x}, polymarket=${sourceStatus.polymarket}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
