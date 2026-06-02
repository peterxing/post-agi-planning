#!/usr/bin/env node
import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const outputPath = path.join(projectRoot, 'public', 'data', 'x-chapter-embeds.json');

const username = process.env.X_USERNAME || 'peterxing';
const maxResults = Math.max(5, Math.min(Number(process.env.X_MAX_RESULTS || 40), 100));
const scrapeSources = (process.env.X_SCRAPE_SOURCES || [
  `https://nitter.net/${username}/rss`,
  `https://nitter.poast.org/${username}/rss`,
  `https://xcancel.com/${username}/rss`,
  `https://x.com/${username}`,
].join(','))
  .split(',')
  .map((source) => source.trim())
  .filter(Boolean);

const CHAPTERS = [
  {
    id: 'chapter-1-do-you-feel-the-acceleration',
    title: 'Chapter 1: Do You Feel the Acceleration?',
    terms: ['acceleration', 'exponential', 'future', 'agi', 'frontier model', 'agent', 'codex', 'automation', 'disruption'],
  },
  {
    id: 'chapter-2-why-this-matters-and-who-needs-a-plan',
    title: 'Chapter 2: Why This Matters and Who Needs a Plan',
    terms: ['income', 'insurance', 'family', 'career', 'jobs', 'education', 'retirement', 'community', 'governance', 'society'],
  },
  {
    id: 'chapter-3-what-agi-means-inside-the-singularity',
    title: 'Chapter 3: What AGI Means Inside the Singularity',
    terms: ['singularity', 'agi', 'asi', 'superintelligence', 'robotics', 'transhumanism', 'bci', 'longevity', 'abundance'],
  },
  {
    id: 'chapter-4-how-the-transition-could-unfold',
    title: 'Chapter 4: How the Transition Could Unfold',
    terms: ['ubi', 'uhi', 'civil unrest', 'labour', 'labor', 'displacement', 'takeoff', 'alignment', 'x-risk', 'existential'],
  },
  {
    id: 'chapter-5-when-to-expect-impact',
    title: 'Chapter 5: When to Expect Impact',
    terms: ['timeline', 'forecast', 'prediction', 'polymarket', 'kalshi', 'probability', 'when', '2026', '2027', '2030'],
  },
  {
    id: 'chapter-6-what-to-do-now',
    title: 'Chapter 6: What to Do Now',
    terms: ['energy', 'compute', 'gpu', 'resilience', 'microgrid', 'capital', 'plan', 'action', 'strategy', 'sovereignty'],
  },
];

function normalize(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function compactText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function repairMojibake(text) {
  const source = String(text || '');
  return source
    .replace(/\u00e2\u20ac\u2122/g, "'")
    .replace(/\u00e2\u20ac\u02dc/g, "'")
    .replace(/\u00e2\u20ac\u0153/g, '"')
    .replace(/\u00e2\u20ac\ufffd/g, '"')
    .replace(/\u00e2\u20ac\u201d/g, '-')
    .replace(/\u00e2\u20ac\u201d/g, '-')
    .replace(/\u00e2\u20ac\u00a6/g, '...')
    .replace(/\u00e2\u20ac\u00a2/g, '-')
    .replace(/\u00c2 /g, ' ')
    .replace(/\u00c2/g, '');
}

function decodeEntities(text) {
  return repairMojibake(String(text || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCodePoint(parseInt(value, 16)))
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(parseInt(value, 10))));
}

function xmlTag(source, tag) {
  const match = String(source || '').match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeEntities(match[1]).trim() : '';
}

function inferPostType(title) {
  if (new RegExp(`^RT by @${username}:`, 'i').test(title)) return 'repost';
  if (new RegExp(`^R to @${username}:`, 'i').test(title)) return 'reply';
  return 'post';
}

function canonicalXUrl(url, creator, id) {
  const author = String(creator || username).replace(/^@/, '') || username;
  if (id) return `https://x.com/${author}/status/${id}`;

  const statusMatch = String(url || '').match(/\/([^/]+)\/status\/(\d+)/);
  if (statusMatch) return `https://x.com/${statusMatch[1]}/status/${statusMatch[2]}`;

  return String(url || '').replace(/^https:\/\/[^/]+/, 'https://x.com');
}

function parseRssFeed(xml) {
  const items = [...String(xml || '').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)]
    .slice(0, maxResults)
    .map((match) => {
      const raw = match[1];
      const title = xmlTag(raw, 'title');
      const description = xmlTag(raw, 'description');
      const creator = xmlTag(raw, 'dc:creator') || `@${username}`;
      const guid = xmlTag(raw, 'guid');
      const link = xmlTag(raw, 'link');
      const id = guid.match(/\d{12,}/)?.[0] || link.match(/status\/(\d+)/)?.[1] || '';
      const cleanedTitle = title.replace(new RegExp(`^(RT|R) by @${username}:\\s*`, 'i'), '');
      const text = compactText(description || cleanedTitle);

      return {
        id: id || link || cleanedTitle.slice(0, 80),
        type: inferPostType(title),
        text,
        created_at: new Date(xmlTag(raw, 'pubDate') || Date.now()).toISOString(),
        url: canonicalXUrl(link, creator, id),
        public_metrics: {},
      };
    });

  return items.filter((item) => item.text && !/rss reader not yet whitelisted/i.test(item.text));
}

function parseXHtml(html) {
  const posts = [];
  const matches = [...String(html || '').matchAll(/https:\/\/x\.com\/([^/"?]+)\/status\/(\d+)/g)];
  const seen = new Set();
  for (const match of matches) {
    const [, author, id] = match;
    if (seen.has(id) || posts.length >= maxResults) continue;
    seen.add(id);
    posts.push({
      id,
      type: author.toLowerCase() === username.toLowerCase() ? 'post' : 'repost',
      text: '',
      created_at: '',
      url: `https://x.com/${author}/status/${id}`,
      public_metrics: {},
    });
  }
  return posts;
}

function termMatches(text, terms) {
  const source = normalize(text);
  return terms.filter((term) => {
    const normalizedTerm = normalize(term);
    const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (/^[a-z0-9-]+$/.test(normalizedTerm)) {
      return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(source);
    }
    return source.includes(normalizedTerm);
  });
}

function classifyPost(post) {
  const text = normalize(post.text);
  const ranked = CHAPTERS
    .map((chapter) => {
      const matches = termMatches(text, chapter.terms);
      return { chapter, matches, score: matches.length };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return ranked.slice(0, 2);
}

async function scrapeSource(url) {
  const { statusCode, body } = await requestText(url);
  if (statusCode < 200 || statusCode >= 300) throw new Error(`${statusCode}: ${body.slice(0, 160)}`);
  if (/<rss\b|<feed\b/i.test(body)) return parseRssFeed(body);
  return parseXHtml(body);
}

function requestText(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'http:' ? http : https;
    const request = client.get(parsed, {
      headers: {
        Accept: 'application/rss+xml,text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5',
        'User-Agent': 'Mozilla/5.0 (compatible; PostAGIPlanningBot/1.0; +https://post-agi-planning.vercel.app/book/)',
      },
      timeout: 25000,
    }, (response) => {
      const statusCode = response.statusCode || 0;
      const location = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(statusCode) && location && redirectCount < 4) {
        response.resume();
        resolve(requestText(new URL(location, parsed).toString(), redirectCount + 1));
        return;
      }

      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => resolve({ statusCode, body }));
    });

    request.on('timeout', () => {
      request.destroy(new Error(`timeout fetching ${url}`));
    });
    request.on('error', reject);
  });
}

async function main() {
  const snapshot = {
    generatedAt: new Date().toISOString(),
    username,
    sourceStatus: {},
    chapters: Object.fromEntries(CHAPTERS.map((chapter) => [chapter.id, { ...chapter, posts: [] }])),
  };

  const sourceAttempts = [];
  let posts = [];
  try {
    for (const source of scrapeSources) {
      try {
        posts = await scrapeSource(source);
        sourceAttempts.push(`${source}: ok(raw=${posts.length})`);
        if (posts.length) break;
      } catch (error) {
        sourceAttempts.push(`${source}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    for (const post of posts) {
      const matches = classifyPost(post);
      if (!matches.length) continue;

      const item = {
        id: post.id,
        type: post.type || 'post',
        text: compactText(post.text).slice(0, 280),
        created_at: post.created_at,
        url: post.url || `https://x.com/${username}/status/${post.id}`,
        public_metrics: post.public_metrics || {},
      };

      for (const match of matches) {
        const target = snapshot.chapters[match.chapter.id];
        if (!target.posts.find((p) => p.id === item.id)) {
          target.posts.push({ ...item, matched_terms: match.matches });
        }
      }
    }

    for (const chapter of Object.values(snapshot.chapters)) {
      chapter.posts = chapter.posts
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        .slice(0, 4);
    }

    snapshot.sourceStatus.x = posts.length ? `scraped(raw=${posts.length})` : 'blocked-or-empty';
    snapshot.sourceStatus.sources = sourceAttempts;
  } catch (error) {
    snapshot.sourceStatus.x = `scrape-error: ${error instanceof Error ? error.message : String(error)}`;
    snapshot.sourceStatus.sources = sourceAttempts;
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
