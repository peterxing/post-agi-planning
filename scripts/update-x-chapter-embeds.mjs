#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const outputPath = path.join(projectRoot, 'public', 'data', 'x-chapter-embeds.json');

const bearer = process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN || '';
const username = process.env.X_USERNAME || 'peterxing';
const maxResults = Math.max(5, Math.min(Number(process.env.X_MAX_RESULTS || 40), 100));

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

function termMatches(text, terms) {
  const source = normalize(text);
  return terms.filter((term) => source.includes(normalize(term)));
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

async function xFetch(url) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${bearer}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`X API ${response.status}: ${body.slice(0, 240)}`);
  }

  return response.json();
}

function postType(post) {
  const ref = Array.isArray(post.referenced_tweets) ? post.referenced_tweets[0] : null;
  if (ref?.type === 'retweeted') return 'repost';
  if (ref?.type === 'quoted') return 'quote';
  if (ref?.type === 'replied_to') return 'reply';
  return 'post';
}

async function main() {
  const snapshot = {
    generatedAt: new Date().toISOString(),
    username,
    sourceStatus: {},
    chapters: Object.fromEntries(CHAPTERS.map((chapter) => [chapter.id, { ...chapter, posts: [] }])),
  };

  if (!bearer) {
    snapshot.sourceStatus.x = 'missing-token';
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(snapshot, null, 2), 'utf8');
    console.log(`Wrote ${outputPath} with missing-token status`);
    return;
  }

  try {
    const userPayload = await xFetch(`https://api.twitter.com/2/users/by/username/${encodeURIComponent(username)}?user.fields=id,name,username`);
    const userId = userPayload?.data?.id;
    if (!userId) throw new Error(`No X user ID found for ${username}`);

    const params = new URLSearchParams({
      max_results: String(maxResults),
      'tweet.fields': 'created_at,public_metrics,referenced_tweets,entities,context_annotations',
      expansions: 'referenced_tweets.id,referenced_tweets.id.author_id,author_id',
      'user.fields': 'name,username',
      exclude: 'replies',
    });

    const timeline = await xFetch(`https://api.twitter.com/2/users/${userId}/tweets?${params.toString()}`);
    const posts = Array.isArray(timeline?.data) ? timeline.data : [];

    for (const post of posts) {
      const matches = classifyPost(post);
      if (!matches.length) continue;

      const item = {
        id: post.id,
        type: postType(post),
        text: compactText(post.text).slice(0, 280),
        created_at: post.created_at,
        url: `https://x.com/${username}/status/${post.id}`,
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

    snapshot.sourceStatus.x = `ok(raw=${posts.length})`;
  } catch (error) {
    snapshot.sourceStatus.x = `error: ${error instanceof Error ? error.message : String(error)}`;
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
