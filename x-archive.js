'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const SECRET_DIR = process.env.PAP_SECRET_DIR || 'C:\\Users\\peterxing\\pap-secrets';
const CORPUS_FILE = path.join(SECRET_DIR, 'x-status-corpus.json');
const DISCOVERY_FILE = path.join(SECRET_DIR, 'x-wayback-status-ids.json');
const LEGACY_HISTORY_FILE = path.join(SECRET_DIR, 'x-activity-history.json');
const ACTIVITY_CACHE_FILE = path.join(SECRET_DIR, 'x-activity.json');
const RSS_CACHE_FILE = path.join(SECRET_DIR, 'x-public-rss-cache.json');
const PUBLIC_GIT_ARCHIVE = process.env.PAP_GITHUB_ARCHIVE || 'C:\\Users\\peterxing\\pap-github';
const STATUS_PACE_MS = Math.max(600, Number(process.env.X_STATUS_PACE_MS) || 600);
const OEMBED_PACE_MS = Math.max(150, Number(process.env.X_OEMBED_PACE_MS) || 250);
const DISCOVERY_CACHE_HOURS = Math.max(24, Number(process.env.X_DISCOVERY_CACHE_HOURS) || 168);
const VERIFY_CACHE_HOURS = Math.max(1, Number(process.env.X_VERIFY_CACHE_HOURS) || 720);
const WAYBACK_PATTERNS = [
  'twitter.com/peterxing/status*',
  'twitter.com/PeterXing/status*',
  'x.com/peterxing/status*',
  'x.com/PeterXing/status*',
];

function externalAccountFile(handle) {
  return path.join(SECRET_DIR, `x-external-account-${String(handle).toLowerCase()}.json`);
}

function externalDiscoveryFile(handle) {
  return path.join(SECRET_DIR, `x-wayback-account-${String(handle).toLowerCase()}.json`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(temporary, file);
}

function ageHours(value) {
  const date = new Date(value);
  return isNaN(date.getTime()) ? Infinity : Math.max(0, (Date.now() - date.getTime()) / 36e5);
}

function numericSort(left, right) {
  const a = BigInt(left);
  const b = BigInt(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function statusToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

function statusIdFrom(value) {
  return String(value || '').match(/status(?:es)?\/(\d{15,})/i)?.[1] || null;
}

function cleanText(value) {
  return String(value || '')
    .replace(/https?:\/\/t\.co\/\w+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchResponse(url, {
  timeoutMs = 120000,
  attempts = 3,
  headers = {},
  retryStatuses = new Set([429, 500, 502, 503, 504]),
} = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'pap-archive-verifier/1.0',
          'Accept': 'application/json,text/plain,*/*',
          ...headers,
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!retryStatuses.has(response.status) || attempt === attempts - 1) return response;
      await response.arrayBuffer().catch(() => {});
      const retryAfter = Number(response.headers.get('retry-after')) || 0;
      await sleep(Math.max(retryAfter * 1000, Math.min(60000, 1500 * (2 ** attempt))));
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt === attempts - 1) throw error;
      await sleep(Math.min(60000, 1500 * (2 ** attempt)));
    }
  }
  throw lastError || new Error('request failed');
}

function createPacer(intervalMs) {
  let nextAt = 0;
  return async () => {
    const waitMs = Math.max(0, nextAt - Date.now());
    if (waitMs) await sleep(waitMs);
    nextAt = Date.now() + intervalMs;
  };
}

const paceStatus = createPacer(STATUS_PACE_MS);
const paceOembed = createPacer(OEMBED_PACE_MS);

async function hydrateTweetResult(id) {
  await paceStatus();
  const endpoint = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${statusToken(id)}`;
  const response = await fetchResponse(endpoint, { timeoutMs: 45000, attempts: 5 });
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      reason: response.status === 429 ? 'rate-limited'
        : response.status === 404 ? 'not-found'
          : response.status === 403 ? 'protected-or-forbidden'
            : 'unavailable',
    };
  }
  let data;
  try {
    data = await response.json();
  } catch {
    return { ok: false, status: response.status, reason: 'invalid-json' };
  }
  if (!data || !/^\d{15,}$/.test(String(data.id_str || '')) || !data.created_at
      || !data.user || !data.user.screen_name || !(data.text || data.full_text)) {
    return { ok: false, status: response.status, reason: 'incomplete-payload' };
  }
  return { ok: true, status: response.status, data };
}

async function resolveOembed(url) {
  await paceOembed();
  const endpoint = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=1`;
  const response = await fetchResponse(endpoint, { timeoutMs: 45000, attempts: 4 });
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      reason: response.status === 404 ? 'not-found'
        : response.status === 429 ? 'rate-limited'
          : 'unavailable',
    };
  }
  let data;
  try {
    data = await response.json();
  } catch {
    return { ok: false, status: response.status, reason: 'invalid-json' };
  }
  const id = statusIdFrom(data.url);
  const handle = String(data.author_url || '').match(/(?:twitter|x)\.com\/([A-Za-z0-9_]+)/i)?.[1] || null;
  if (!id || !handle) return { ok: false, status: response.status, reason: 'incomplete-payload' };
  return {
    ok: true,
    status: response.status,
    id,
    handle,
    displayName: String(data.author_name || '').trim(),
    canonicalUrl: String(data.url || ''),
  };
}

function activityKind(tweet, activityId, statusId) {
  if (statusId !== activityId) return 'repost';
  if (tweet.in_reply_to_status_id_str) return 'reply';
  if (tweet.quoted_tweet || tweet.quoted_status_id_str || tweet.quoted_tweet_permalink) return 'quote';
  return 'authored';
}

async function hydrateActivity(activityId) {
  const tweetResult = await hydrateTweetResult(activityId);
  if (!tweetResult.ok) return { ok: false, activityId, stage: 'tweet-result', ...tweetResult };
  const tweet = tweetResult.data;
  const statusId = String(tweet.id_str);
  const author = String(tweet.user.screen_name);
  const activityCheck = await resolveOembed(`https://x.com/i/status/${activityId}`);
  if (!activityCheck.ok || activityCheck.id !== String(activityId)
      || activityCheck.handle.toLowerCase() !== 'peterxing') {
    return {
      ok: false,
      activityId,
      statusId,
      stage: 'activity-oembed',
      status: activityCheck.status,
      reason: activityCheck.reason || 'activity-author-mismatch',
    };
  }

  const statusCheck = statusId === String(activityId)
    ? activityCheck
    : await resolveOembed(`https://x.com/i/status/${statusId}`);
  if (!statusCheck.ok || statusCheck.id !== statusId
      || statusCheck.handle.toLowerCase() !== author.toLowerCase()) {
    return {
      ok: false,
      activityId,
      statusId,
      stage: 'status-oembed',
      status: statusCheck.status,
      reason: statusCheck.reason || 'status-author-mismatch',
    };
  }
  const created = new Date(tweet.created_at);
  if (isNaN(created.getTime())) {
    return { ok: false, activityId, statusId, stage: 'tweet-result', reason: 'invalid-date' };
  }
  const kind = activityKind(tweet, String(activityId), statusId);
  const text = cleanText(tweet.text || tweet.full_text);
  if (!text) {
    return { ok: false, activityId, statusId, stage: 'tweet-result', reason: 'empty-text' };
  }
  const verifiedAt = new Date().toISOString();
  return {
    ok: true,
    item: {
      activityId: String(activityId),
      statusId,
      author,
      displayName: String(tweet.user.name || statusCheck.displayName || author),
      createdAt: created.toISOString(),
      text,
      kind,
      likes: Number(tweet.favorite_count) || 0,
      reposts: Number(tweet.retweet_count) || 0,
      statusUrl: statusCheck.canonicalUrl || `https://x.com/${author}/status/${statusId}`,
      activityUrl: activityCheck.canonicalUrl || `https://x.com/peterxing/status/${activityId}`,
      verifiedAt,
      verification: {
        tweetResult: 'first-party',
        statusOembed: true,
        activityOembed: true,
      },
      sourceChain: ['wayback-cdx', 'tweet-result', 'x-oembed'],
    },
  };
}

async function hydrateAccountActivity(activityId, expectedHandle) {
  const tweetResult = await hydrateTweetResult(activityId);
  if (!tweetResult.ok) return { ok: false, activityId, stage: 'tweet-result', ...tweetResult };
  const tweet = tweetResult.data;
  const statusId = String(tweet.id_str);
  const author = String(tweet.user.screen_name);
  const activityCheck = await resolveOembed(`https://x.com/i/status/${activityId}`);
  if (!activityCheck.ok || activityCheck.id !== String(activityId)
      || activityCheck.handle.toLowerCase() !== String(expectedHandle).toLowerCase()) {
    return {
      ok: false,
      activityId,
      statusId,
      stage: 'activity-oembed',
      status: activityCheck.status,
      reason: activityCheck.reason || 'activity-author-mismatch',
    };
  }
  const statusCheck = statusId === String(activityId)
    ? activityCheck
    : await resolveOembed(`https://x.com/i/status/${statusId}`);
  if (!statusCheck.ok || statusCheck.id !== statusId
      || statusCheck.handle.toLowerCase() !== author.toLowerCase()) {
    return {
      ok: false,
      activityId,
      statusId,
      stage: 'status-oembed',
      status: statusCheck.status,
      reason: statusCheck.reason || 'status-author-mismatch',
    };
  }
  const created = new Date(tweet.created_at);
  const text = cleanText(tweet.text || tweet.full_text);
  if (isNaN(created.getTime()) || !text) {
    return { ok: false, activityId, statusId, stage: 'tweet-result', reason: 'invalid-content' };
  }
  const kind = statusId === String(activityId) ? 'authored' : 'repost';
  return {
    ok: true,
    item: {
      activityId: String(activityId),
      statusId,
      account: activityCheck.handle,
      author,
      displayName: String(tweet.user.name || statusCheck.displayName || author),
      createdAt: created.toISOString(),
      text,
      kind,
      likes: Number(tweet.favorite_count) || 0,
      reposts: Number(tweet.retweet_count) || 0,
      statusUrl: statusCheck.canonicalUrl || `https://x.com/${author}/status/${statusId}`,
      activityUrl: activityCheck.canonicalUrl || `https://x.com/${expectedHandle}/status/${activityId}`,
      verifiedAt: new Date().toISOString(),
      verification: {
        tweetResult: 'first-party',
        statusOembed: true,
        activityOembed: true,
      },
      sourceChain: ['wayback-cdx', 'tweet-result', 'x-oembed'],
    },
  };
}

function waybackUrl(pattern, extras) {
  const params = new URLSearchParams({
    url: pattern,
    output: 'json',
    filter: 'statuscode:200',
    ...extras,
  });
  return `https://web.archive.org/cdx/search/cdx?${params.toString()}`;
}

function parsePageCount(value) {
  if (!Array.isArray(value)) return 0;
  const flat = value.flat().map(item => String(item));
  const count = flat.map(Number).find(number => Number.isInteger(number) && number >= 0);
  return count == null ? 0 : count;
}

function idsFromCdxRows(rows) {
  if (!Array.isArray(rows)) return [];
  const ids = [];
  for (const row of rows) {
    const original = Array.isArray(row) ? row[0] : row;
    const id = statusIdFrom(original);
    if (id) ids.push(id);
  }
  return ids;
}

async function discoverWaybackIds({ force = false } = {}) {
  const cached = readJson(DISCOVERY_FILE, null);
  if (!force && cached && ageHours(cached.updated) <= DISCOVERY_CACHE_HOURS
      && Array.isArray(cached.ids) && cached.ids.length) {
    return {
      ...cached,
      cache: 'fresh',
      attempts: (cached.sources || []).map(source => ({
        source: 'wayback-cdx',
        pattern: source.pattern,
        status: 'cached',
        pages: source.pages,
        count: source.count,
      })),
    };
  }
  const priorIds = new Set(Array.isArray(cached?.ids) ? cached.ids : []);
  const allIds = new Set(priorIds);
  const sources = [];
  const attempts = [];
  for (const pattern of WAYBACK_PATTERNS) {
    let pageCount = 0;
    let error = null;
    let status = 0;
    try {
      const pagesResponse = await fetchResponse(waybackUrl(pattern, { showNumPages: 'true' }), {
        timeoutMs: 180000,
        attempts: 4,
      });
      status = pagesResponse.status;
      if (!pagesResponse.ok) throw new Error(`HTTP ${pagesResponse.status}`);
      pageCount = parsePageCount(await pagesResponse.json());
    } catch (caught) {
      error = caught.message;
    }
    const sourceIds = new Set();
    let pagesRead = 0;
    if (!error && pageCount > 0) {
      for (let page = 0; page < pageCount; page++) {
        try {
          const response = await fetchResponse(waybackUrl(pattern, {
            fl: 'original',
            collapse: 'urlkey',
            limit: '5000',
            page: String(page),
          }), {
            timeoutMs: 180000,
            attempts: 4,
          });
          status = response.status;
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          for (const id of idsFromCdxRows(await response.json())) {
            sourceIds.add(id);
            allIds.add(id);
          }
          pagesRead++;
        } catch (caught) {
          error = `page ${page}: ${caught.message}`;
          break;
        }
      }
    }
    const source = {
      pattern,
      pages: pageCount,
      pagesRead,
      count: sourceIds.size,
      status: error ? 'partial-or-unavailable' : 'complete',
      httpStatus: status || null,
      error: error || null,
    };
    sources.push(source);
    attempts.push({ source: 'wayback-cdx', ...source });
  }
  const ids = [...allIds].filter(id => /^\d{15,}$/.test(id)).sort(numericSort);
  if (!ids.length) throw new Error('Wayback discovery produced no status IDs and no cache is available');
  const payload = {
    version: 1,
    updated: new Date().toISOString(),
    count: ids.length,
    sources,
    ids,
  };
  writeJsonAtomic(DISCOVERY_FILE, payload);
  return { ...payload, cache: 'refreshed', attempts };
}

async function discoverAccountIds(handle, { force = false } = {}) {
  const account = String(handle || '').replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(account)) throw new Error('invalid X account handle');
  const cacheFile = externalDiscoveryFile(account);
  const cached = readJson(cacheFile, null);
  if (!force && cached && ageHours(cached.updated) <= DISCOVERY_CACHE_HOURS
      && Array.isArray(cached.ids) && cached.ids.length) {
    return { ...cached, cache:'fresh' };
  }
  const variants = [...new Set([account, account.toLowerCase()])];
  const patterns = [...new Set(variants.flatMap(variant => [
    `twitter.com/${variant}/status*`,
    `x.com/${variant}/status*`,
  ]))];
  const allIds = new Set(Array.isArray(cached?.ids) ? cached.ids : []);
  const sources = [];
  for (const pattern of patterns) {
    let pageCount = 0;
    let pagesRead = 0;
    let status = 0;
    let error = null;
    const sourceIds = new Set();
    try {
      const pagesResponse = await fetchResponse(waybackUrl(pattern, { showNumPages:'true' }), {
        timeoutMs:180000,
        attempts:4,
      });
      status = pagesResponse.status;
      if (!pagesResponse.ok) throw new Error(`HTTP ${pagesResponse.status}`);
      pageCount = parsePageCount(await pagesResponse.json());
      for (let page = 0; page < pageCount; page++) {
        const response = await fetchResponse(waybackUrl(pattern, {
          fl:'original',
          collapse:'urlkey',
          limit:'5000',
          page:String(page),
        }), {
          timeoutMs:180000,
          attempts:4,
        });
        status = response.status;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        for (const id of idsFromCdxRows(await response.json())) {
          sourceIds.add(id);
          allIds.add(id);
        }
        pagesRead++;
      }
    } catch (caught) {
      error = caught.message;
    }
    sources.push({
      pattern,
      pages:pageCount,
      pagesRead,
      count:sourceIds.size,
      status:error ? 'partial-or-unavailable' : 'complete',
      httpStatus:status || null,
      error,
    });
  }
  const ids = [...allIds].filter(id => /^\d{15,}$/.test(id)).sort(numericSort);
  if (!ids.length) throw new Error(`Wayback discovery produced no status IDs for @${account}`);
  const payload = {
    version:1,
    account,
    updated:new Date().toISOString(),
    count:ids.length,
    sources,
    ids,
  };
  writeJsonAtomic(cacheFile, payload);
  return { ...payload, cache:'refreshed' };
}

async function refreshExternalAccountCorpus(handle, {
  forceDiscovery = false,
  hydrateLimit = 120,
} = {}) {
  const discovery = await discoverAccountIds(handle, { force:forceDiscovery });
  const file = externalAccountFile(handle);
  const cached = readJson(file, {});
  const byActivity = new Map(
    (Array.isArray(cached.items) ? cached.items : [])
      .filter(item => /^\d{15,}$/.test(String(item.activityId || '')))
      .map(item => [String(item.activityId), item])
  );
  const unverified = discovery.ids.filter(id => {
    const item = byActivity.get(id);
    return !item?.verifiedAt || ageHours(item.verifiedAt) > VERIFY_CACHE_HOURS;
  });
  const plan = [
    ...unverified.slice(-40).reverse(),
    ...selectEvenly(unverified, Math.max(hydrateLimit * 2, hydrateLimit)),
  ].filter((id, index, values) => values.indexOf(id) === index).slice(0, hydrateLimit);
  const failures = [];
  let hydrated = 0;
  for (const activityId of plan) {
    const result = await hydrateAccountActivity(activityId, handle);
    if (result.ok) {
      byActivity.set(activityId, result.item);
      hydrated++;
    } else {
      failures.push({
        stage:result.stage || null,
        status:result.status || null,
        reason:result.reason || 'unavailable',
      });
    }
  }
  const items = [...byActivity.values()].sort((a, b) => numericSort(a.activityId, b.activityId));
  const payload = {
    version:1,
    account:String(handle).replace(/^@/, ''),
    updated:new Date().toISOString(),
    discovery:{
      updated:discovery.updated,
      count:discovery.count,
      sources:discovery.sources,
    },
    verification:{
      updated:new Date().toISOString(),
      attempted:plan.length,
      hydrated,
      failures:failures.length,
      statusPaceMs:STATUS_PACE_MS,
    },
    count:items.length,
    authored:items.filter(item => item.kind === 'authored').length,
    reposted:items.filter(item => item.kind === 'repost').length,
    items,
  };
  writeJsonAtomic(file, payload);
  return payload;
}

function normalizeLegacyItem(item, source) {
  const statusId = String(item?.statusId || item?.id || '');
  const activityId = String(item?.activityId || statusId);
  const created = new Date(item?.createdAt || item?.created);
  if (!/^\d{15,}$/.test(statusId) || !/^\d{15,}$/.test(activityId)
      || isNaN(created.getTime()) || !item?.text || !item?.author) return null;
  const repost = item.kind === 'repost' || statusId !== activityId;
  return {
    activityId,
    statusId,
    author: String(item.author),
    displayName: String(item.displayName || item.author),
    createdAt: created.toISOString(),
    text: cleanText(item.text),
    kind: repost ? 'repost' : item.corpusKind || 'authored',
    likes: Number(item.likes) || 0,
    reposts: Number(item.rts || item.reposts) || 0,
    statusUrl: item.statusUrl || item.url || `https://x.com/${item.author}/status/${statusId}`,
    activityUrl: item.activityUrl || `https://x.com/peterxing/status/${activityId}`,
    verifiedAt: item.verifiedAt || null,
    verification: item.verification || null,
    sourceChain: [...new Set([...(item.sourceChain || []), source])],
  };
}

function loadLegacySeeds({ includeGitArchive = false } = {}) {
  const seeds = [];
  const history = readJson(LEGACY_HISTORY_FILE, {});
  for (const item of Array.isArray(history.items) ? history.items : []) {
    const normalized = normalizeLegacyItem(item, 'private-api-history');
    if (normalized) seeds.push(normalized);
  }
  const activity = readJson(ACTIVITY_CACHE_FILE, {});
  for (const item of Array.isArray(activity.items) ? activity.items : []) {
    const normalized = normalizeLegacyItem(item, 'private-api-snapshot');
    if (normalized) seeds.push(normalized);
  }
  const rss = readJson(RSS_CACHE_FILE, {});
  for (const item of Array.isArray(rss.items) ? rss.items : []) {
    const normalized = normalizeLegacyItem(item, 'private-public-profile-snapshot');
    if (normalized) seeds.push(normalized);
  }
  if (includeGitArchive && fs.existsSync(path.join(PUBLIC_GIT_ARCHIVE, '.git'))) {
    const commits = childProcess.spawnSync(
      'git',
      ['-C', PUBLIC_GIT_ARCHIVE, 'rev-list', '--all', '--', 'signals.json'],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 }
    );
    const hashes = commits.status === 0
      ? commits.stdout.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
      : [];
    for (const hash of hashes) {
      const shown = childProcess.spawnSync(
        'git',
        ['-C', PUBLIC_GIT_ARCHIVE, 'show', `${hash}:signals.json`],
        { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 }
      );
      if (shown.status !== 0 || !shown.stdout) continue;
      let signals;
      try { signals = JSON.parse(shown.stdout.replace(/^\uFEFF/, '')); } catch { continue; }
      for (const embed of Object.values(signals.embeds || {})) {
        if (embed?.evidenceOwner !== 'peterxing') continue;
        const normalized = normalizeLegacyItem({
          id: embed.id,
          activityId: embed.provenance?.activityId || embed.id,
          created: embed.date,
          text: embed.text,
          author: embed.author,
          kind: embed.kind,
          url: embed.url,
        }, 'public-signals-history');
        if (normalized) seeds.push(normalized);
      }
      for (const item of Array.isArray(signals.reality) ? signals.reality : []) {
        if (item.kind !== 'post' || String(item.author).toLowerCase() !== 'peterxing') continue;
        const normalized = normalizeLegacyItem(item, 'public-reality-history');
        if (normalized) seeds.push(normalized);
      }
    }
  }
  return seeds;
}

function mergeCorpusItems(...lists) {
  const byActivity = new Map();
  for (const item of lists.flat()) {
    if (!item || !/^\d{15,}$/.test(String(item.activityId || ''))) continue;
    const activityId = String(item.activityId);
    const prior = byActivity.get(activityId);
    const usableItem = cleanText(item.text)
      ? item
      : { ...item, verifiedAt: null, verification: null };
    if (!prior || (!prior.verifiedAt && usableItem.verifiedAt)
        || cleanText(item.text).length > cleanText(prior.text).length) {
      byActivity.set(activityId, {
        ...prior,
        ...usableItem,
        activityId,
        statusId: String(item.statusId || item.id || activityId),
        sourceChain: [...new Set([...(prior?.sourceChain || []), ...(item.sourceChain || [])])],
      });
    }
  }
  return [...byActivity.values()].sort((a, b) => numericSort(a.activityId, b.activityId));
}

function loadCorpus() {
  const value = readJson(CORPUS_FILE, {});
  return {
    metadata: value && typeof value === 'object' ? value : {},
    items: mergeCorpusItems(Array.isArray(value?.items) ? value.items : []),
  };
}

function saveCorpus(items, metadata = {}) {
  const dated = items.filter(item => !isNaN(Date.parse(item.createdAt)));
  const kinds = {};
  for (const item of items) kinds[item.kind] = (kinds[item.kind] || 0) + 1;
  const payload = {
    version: 1,
    updated: new Date().toISOString(),
    count: items.length,
    verifiedCount: items.filter(item => item.verifiedAt).length,
    kinds,
    oldestItemAt: dated.length
      ? dated.reduce((oldest, item) => item.createdAt < oldest ? item.createdAt : oldest, dated[0].createdAt)
      : null,
    newestItemAt: dated.length
      ? dated.reduce((newest, item) => item.createdAt > newest ? item.createdAt : newest, dated[0].createdAt)
      : null,
    ...metadata,
    items,
  };
  writeJsonAtomic(CORPUS_FILE, payload);
  return payload;
}

function selectEvenly(ids, limit) {
  if (ids.length <= limit) return ids.slice();
  if (limit <= 1) return [ids[ids.length - 1]];
  const selected = new Set();
  for (let index = 0; index < limit; index++) {
    selected.add(ids[Math.round(index * (ids.length - 1) / (limit - 1))]);
  }
  return [...selected];
}

function hydrationPlan(items, discoveredIds, { forceIds = [], limit = 120 } = {}) {
  const byActivity = new Map(items.map(item => [String(item.activityId), item]));
  const plan = [];
  const add = id => {
    const value = String(id || '');
    if (/^\d{15,}$/.test(value) && !plan.includes(value)) plan.push(value);
  };
  forceIds.forEach(add);

  const needsVerification = item => !item.verifiedAt || ageHours(item.verifiedAt) > VERIFY_CACHE_HOURS;
  items
    .filter(item => needsVerification(item) && ['authored', 'quote', 'reply'].includes(item.kind))
    .sort((a, b) => numericSort(b.activityId, a.activityId))
    .forEach(item => add(item.activityId));

  const candidates = [...new Set([
    ...discoveredIds,
    ...items.map(item => item.activityId),
  ])].sort(numericSort).filter(id => {
    const item = byActivity.get(id);
    return !item || needsVerification(item);
  });
  candidates.slice(-40).reverse().forEach(add);
  selectEvenly(candidates, Math.max(limit * 2, limit)).forEach(add);
  return plan.slice(0, Math.max(forceIds.length, limit));
}

function corpusToMatcherItems(items, { verifiedOnly = true } = {}) {
  return items
    .filter(item => !verifiedOnly || item.verifiedAt)
    .map(item => ({
      id: item.statusId,
      activityId: item.activityId,
      activitySource: 'archive-verified',
      created: new Date(item.createdAt),
      text: item.text,
      author: item.author,
      likes: item.likes || 0,
      rts: item.reposts || 0,
      kind: item.kind === 'repost' ? 'repost' : 'post',
      corpusKind: item.kind,
      verifiedAt: item.verifiedAt,
      statusUrl: item.statusUrl,
      activityUrl: item.activityUrl,
    }))
    .filter(item => /^\d{15,}$/.test(item.id) && !isNaN(item.created.getTime()));
}

async function refreshArchiveCorpus({
  forceDiscovery = false,
  includeGitArchive = false,
  hydrateLimit = 120,
  forceIds = [],
} = {}) {
  const discovery = await discoverWaybackIds({ force: forceDiscovery });
  const loaded = loadCorpus();
  const seeds = loadLegacySeeds({ includeGitArchive });
  let items = mergeCorpusItems(loaded.items, seeds);
  const plan = hydrationPlan(items, discovery.ids, { forceIds, limit: hydrateLimit });
  const byActivity = new Map(items.map(item => [item.activityId, item]));
  const failures = [];
  const verifiedActivityIds = [];
  let hydrated = 0;
  let authored = 0;
  let reposted = 0;
  for (let index = 0; index < plan.length; index++) {
    const activityId = plan[index];
    const result = await hydrateActivity(activityId);
    if (result.ok) {
      const prior = byActivity.get(activityId);
      byActivity.set(activityId, {
        ...prior,
        ...result.item,
        sourceChain: [...new Set([...(prior?.sourceChain || []), ...result.item.sourceChain])],
      });
      hydrated++;
      verifiedActivityIds.push(activityId);
      if (result.item.kind === 'repost') reposted++;
      else authored++;
    } else {
      const prior = byActivity.get(activityId);
      if (prior) {
        byActivity.set(activityId, {
          ...prior,
          lastFailure: {
            checkedAt: new Date().toISOString(),
            stage: result.stage || null,
            status: result.status || null,
            reason: result.reason || 'unavailable',
          },
        });
      }
      failures.push({
        stage: result.stage || null,
        status: result.status || null,
        reason: result.reason || 'unavailable',
      });
    }
    if ((index + 1) % 25 === 0) {
      items = mergeCorpusItems([...byActivity.values()]);
      saveCorpus(items, {
        discovery: {
          updated: discovery.updated,
          count: discovery.count,
          cache: discovery.cache,
          sources: discovery.sources,
        },
        verification: {
          updated: new Date().toISOString(),
          attempted: index + 1,
          hydrated,
          failures: failures.length,
        },
      });
    }
  }
  items = mergeCorpusItems([...byActivity.values()]);
  const payload = saveCorpus(items, {
    discovery: {
      updated: discovery.updated,
      count: discovery.count,
      cache: discovery.cache,
      sources: discovery.sources,
    },
    verification: {
      updated: new Date().toISOString(),
      attempted: plan.length,
      hydrated,
      authored,
      reposted,
      failures: failures.length,
      failureReasons: failures.reduce((counts, failure) => {
        const key = `${failure.stage || 'unknown'}:${failure.reason || 'unavailable'}`;
        counts[key] = (counts[key] || 0) + 1;
        return counts;
      }, {}),
      statusPaceMs: STATUS_PACE_MS,
    },
  });
  return {
    payload,
    items,
    matcherItems: corpusToMatcherItems(items),
    verifiedActivityIds,
    sourceAttempts: [
      ...discovery.attempts,
      {
        source: 'tweet-result',
        status: hydrated ? 'verified' : 'unavailable',
        attempted: plan.length,
        hydrated,
        authored,
        reposted,
        failures: failures.length,
        paceMs: STATUS_PACE_MS,
      },
      {
        source: 'x-oembed',
        status: hydrated ? 'cross-checked' : 'unavailable',
        count: hydrated,
      },
    ],
  };
}

module.exports = {
  CORPUS_FILE,
  DISCOVERY_FILE,
  STATUS_PACE_MS,
  WAYBACK_PATTERNS,
  corpusToMatcherItems,
  discoverWaybackIds,
  discoverAccountIds,
  hydrateActivity,
  hydrateAccountActivity,
  hydrateTweetResult,
  loadCorpus,
  loadLegacySeeds,
  refreshArchiveCorpus,
  refreshExternalAccountCorpus,
  resolveOembed,
  statusToken,
};

if (require.main === module) {
  const hydrateArg = process.argv.find(argument => /^--hydrate(?:=|$)/.test(argument));
  const hydrateLimit = hydrateArg
    ? Math.max(1, Number(hydrateArg.split('=')[1]) || 120)
    : 0;
  const accountArg = process.argv.find(argument => argument.startsWith('--account='));
  const operation = accountArg
    ? refreshExternalAccountCorpus(accountArg.split('=')[1], {
      forceDiscovery:process.argv.includes('--force-discovery'),
      hydrateLimit,
    })
    : refreshArchiveCorpus({
      forceDiscovery: process.argv.includes('--force-discovery'),
      includeGitArchive: process.argv.includes('--include-git'),
      hydrateLimit,
    });
  operation.then(result => {
    if (accountArg) {
      console.log(JSON.stringify({
        account:result.account,
        discoveryIds:result.discovery.count,
        corpusItems:result.count,
        authored:result.authored,
        reposted:result.reposted,
        verification:result.verification,
      }, null, 2));
      return;
    }
    const payload = result.payload;
    console.log(JSON.stringify({
      discoveryIds: payload.discovery.count,
      corpusItems: payload.count,
      verifiedItems: payload.verifiedCount,
      kinds: payload.kinds,
      verification: payload.verification,
      oldestItemAt: payload.oldestItemAt,
      newestItemAt: payload.newestItemAt,
    }, null, 2));
  }).catch(error => {
    console.error(`[archive] ${error.message}`);
    process.exit(1);
  });
}
