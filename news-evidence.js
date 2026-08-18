'use strict';

/*
 * VERIFIED NEWS EVIDENCE - THE SOLE EVIDENCE SUBSTRATE
 * =====================================================
 * X RETIREMENT 2026-08-13. This file used to describe itself as "tier 3, BENEATH the X
 * tiers, never a replacement for them". That is now the exact inverse of the site owner's
 * instruction ("remove all references to x posts and stop using the x api for the
 * predictions"), so it is corrected rather than left to be read as policy by the next
 * reader. There is no priority order any more, because there is only one tier:
 *
 *   a reviewed authoritative NEWS ARTICLE, live-verified, published inside the currency
 *   window  <- this file, and nothing else.
 *
 * A prediction with no qualifying in-window source is NOT given a borrowed, stale or
 * adjacent citation. It renders EXPLICITLY UNCITED, naming the window that was searched.
 * Some subjects on this site - Dyson swarms, whole-brain emulation, the ruliad - are
 * speculative frameworks with no fortnightly news cycle, and measured 0 matches across ~90
 * days of 58 authoritative feeds. For those the honest render is an empty result, stated.
 * The two ways to avoid that are an invented citation or a silent gap. We take neither.
 *
 * A news URL is far easier to hallucinate than an X status ID, which has a hard
 * first-party + oEmbed author check. The verification bar here is therefore
 * HIGHER, not lower:
 *
 *   - every field is extracted FROM THE FETCHED PAGE, never from memory;
 *   - an exact verbatim supporting quote is stored and must still be present at
 *     publish time;
 *   - the resolved host after redirects must belong to the declared publisher;
 *   - aggregators, syndicators, shorteners, release mills and content farms are
 *     rejected outright;
 *   - nothing is auto-approved: a mapping exists only after manual review and is
 *     bound to the exact predictionText.
 */

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { URL } = require('url');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 20000;
const MAX_REDIRECTS = 6;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/* ------------------------------------------------------------------ *
 * Reviewed ledger
 * ------------------------------------------------------------------ */

/*
 * NEWS_SOURCES is the reviewed news ledger. It is the SOLE evidence substrate for the
 * site: the X layer was retired on 2026-08-13 on the site owner's instruction, and no
 * prediction may cite an X post any more.
 *
 * Every field below was captured from a LIVE fetch at review time — headline, publisher,
 * byline, publishedAt, the verbatim supporting quote and the SHA-256 of the extracted
 * main text. Nothing is inferred, recalled or back-filled, and verify-news-evidence.js
 * re-fetches and re-checks every one of them at publish time.
 *
 * A prediction with no qualifying source inside the currency window is NOT given a
 * borrowed or stale citation. It renders explicitly UNCITED, naming the window. That
 * honest gap is the intended behaviour, not a defect to be filled.
 */
const NEWS_SOURCES = {
  "nature-ai-datacentre-energy-1": {
    url: "https://www.nature.com/articles/d41586-026-02451-2",
    resolvedUrl: "https://www.nature.com/articles/d41586-026-02451-2",
    publisher: "Nature",
    publisherHost: "nature.com",
    author: "Buhler, Cassidy K.",
    headline: "Why scientists should lead the shift away from AI mega data centres",
    publishedAt: "2026-08-11T00:00:00.000Z",
    publishedAtSource: "page",
    retrievedAt: "2026-08-13",
    sourceQuality: "peer-reviewed-journal",
    quote: "The world’s data centres used about 485 terawatt-hours of electricity last year, similar to that used by Germany, and the International Energy Agency expects that to double by 2030.",
    textSha256: "23c2444a17ff1f9701968950f2a3f36684d4867b8f79a97b9d6f105e31331c89",
  },
  "nature-ai-datacentre-energy-2": {
    url: "https://www.nature.com/articles/d41586-026-02451-2",
    resolvedUrl: "https://www.nature.com/articles/d41586-026-02451-2",
    publisher: "Nature",
    publisherHost: "nature.com",
    author: "Buhler, Cassidy K.",
    headline: "Why scientists should lead the shift away from AI mega data centres",
    publishedAt: "2026-08-11T00:00:00.000Z",
    publishedAtSource: "page",
    retrievedAt: "2026-08-13",
    sourceQuality: "peer-reviewed-journal",
    quote: "Five technology companies — Amazon, Alphabet, Microsoft, Meta and Oracle — are expected to spend a total of more than US$600 billion on AI infrastructure this year; a decade ago, the same five companies spent less than $40 billion.",
    textSha256: "23c2444a17ff1f9701968950f2a3f36684d4867b8f79a97b9d6f105e31331c89",
  },
  "challenger-ai-labour-market": {
    url: "https://www.challengergray.com/blog/challenger-report-layoffs-fall-hiring-picks-up-ai-leads-for-fifth-straight-month/",
    resolvedUrl: "https://www.challengergray.com/blog/challenger-report-layoffs-fall-hiring-picks-up-ai-leads-for-fifth-straight-month/",
    publisher: "Challenger, Gray & Christmas, Inc. | Outplacement & Career Transitioning Services",
    publisherHost: "challengergray.com",
    author: "Colleen Madden Blumenfeld",
    headline: "Challenger Report: Layoffs Fall, Hiring Picks Up; AI Leads For Fifth Straight Month",
    publishedAt: "2026-08-06T09:30:00.000Z",
    publishedAtSource: "page",
    retrievedAt: "2026-08-13",
    sourceQuality: "named-expert-analysis",
    quote: "“Hiring has also increased over last year by 25%, so while AI is shifting the labor market, it is not dismantling it,” said Andy Challenger, workplace expert and chief revenue officer for Challenger, Gray & Christmas.",
    textSha256: "65c1f4a1c9375966e5d9af23a0db47d185c8aad83c9b0f01d8765f2985ef5d80",
  },
  "ars-frontier-agent-network-intrusions": {
    url: "https://arstechnica.com/security/2026/07/likely-illegally-claude-gained-access-to-3-networks-will-anthropic-be-held-to-account/",
    resolvedUrl: "https://arstechnica.com/security/2026/07/likely-illegally-claude-gained-access-to-3-networks-will-anthropic-be-held-to-account/",
    publisher: "Ars Technica",
    publisherHost: "arstechnica.com",
    author: "Dan Goodin",
    headline: "Claude published malicious code to the Internet and attacked 3 real companies",
    publishedAt: "2026-07-31T20:39:14.000Z",
    publishedAtSource: "page",
    retrievedAt: "2026-08-13",
    sourceQuality: "primary-news-organization",
    quote: "The events, which Anthropic revealed Thursday , are the second revelation in 10 days that AI models from the world’s wealthiest providers have trespassed into protected networks, an offense that, in more traditional hacking scenarios, could land the human behind the keyboard in prison for years.",
    textSha256: "a86aeaf689bbb16ca00740266f3373bb4f4c4b5fb619a46d2f4b95efba647be7",
  },
  "ec-ai-act-enforcement-august": {
    url: "https://digital-strategy.ec.europa.eu/en/news/commission-starts-enforcing-ai-act-rules-and-new-transparency-requirements-2-august",
    resolvedUrl: "https://digital-strategy.ec.europa.eu/en/news/commission-starts-enforcing-ai-act-rules-and-new-transparency-requirements-2-august",
    publisher: "Shaping Europe’s digital future",
    publisherHost: "europa.eu",
    author: null,
    headline: "Commission starts enforcing AI Act rules and new transparency requirements on 2 August",
    publishedAt: "2026-08-02T00:00:00.000Z",
    publishedAtSource: "page",
    retrievedAt: "2026-08-13",
    sourceQuality: "intergovernmental-organization",
    quote: "From 2 August 2026, the European Commission’s AI Office, together with national authorities, will begin enforcing the Artificial Intelligence (AI) Act.",
    textSha256: "48cda069c6afe2e42f715ee6d96b89eab7e1dbc34aaffd1f9ad7ed29e8df889e",
  },
  /* REMOVED 2026-08-17 — the arXiv preprint source record for the mapping deleted below. See the
     REJECTED_HOSTS note: arxiv.org is no longer exempt, so this row could not be fetched-and-verified
     under the current bar even if it were still referenced. */
  "techreview-ai-for-science-reasoning": {
    url: "https://www.technologyreview.com/2026/08/10/1141384/ai-agents-for-science/",
    resolvedUrl: "https://www.technologyreview.com/2026/08/10/1141384/ai-agents-for-science/",
    publisher: "MIT Technology Review",
    publisherHost: "technologyreview.com",
    author: "Eric Schmidt",
    headline: "AI for science needs reasoning, not just data",
    publishedAt: "2026-08-10T09:00:00.000Z",
    publishedAtSource: "page",
    retrievedAt: "2026-08-13",
    sourceQuality: "primary-news-organization",
    quote: "Instead, the acceleration of science will come about thanks to another approach: AI agents.",
    textSha256: "6feebcca8e6ceb873d58dcd8ae9028e798be537365da4e218ded3af073012161",
  },
  /* CONTEXT-CHANNEL SOURCES, promoted 2026-08-17 from the reviewed verdicts in
     news-backfill-review.js. These are deliberately OUT of the 14-day window, so refresh-signals.js
     emits them as CONTEXT (dated background carrying their true age) and never as CITED. The
     relevance bar they cleared is the SAME one the cited channel uses; only the recency ceiling was
     lifted. Each was live-fetched on 2026-08-17 and its publisher, headline, date and quote were
     read off the fetched page by verifyNewsSource(). */
  "ars-orbital-datacenter-constraints-1": {
    url: "https://arstechnica.com/space/2026/07/how-hard-is-it-to-build-orbital-data-centers-actually/",
    resolvedUrl: "https://arstechnica.com/space/2026/07/how-hard-is-it-to-build-orbital-data-centers-actually/",
    publisher: "Ars Technica",
    publisherHost: "arstechnica.com",
    author: "Eric Berger",
    headline: "How hard is it to build orbital data centers, actually?",
    publishedAt: "2026-07-15T11:00:09.000Z",
    publishedAtSource: "page",
    retrievedAt: "2026-08-17",
    sourceQuality: "primary-news-organization",
    quote: "The spacecraft is due to launch in October and, if successful, will demonstrate the ability to radiate heat efficiently and run useful workloads for customers, Johnston said.",
    textSha256: "a2decd2e64052479bc0e9c6a647fff54a847d230cb63649be05c3b0054969762",
  },
  "ars-orbital-datacenter-constraints-2": {
    url: "https://arstechnica.com/space/2026/07/how-hard-is-it-to-build-orbital-data-centers-actually/",
    resolvedUrl: "https://arstechnica.com/space/2026/07/how-hard-is-it-to-build-orbital-data-centers-actually/",
    publisher: "Ars Technica",
    publisherHost: "arstechnica.com",
    author: "Eric Berger",
    headline: "How hard is it to build orbital data centers, actually?",
    publishedAt: "2026-07-15T11:00:09.000Z",
    publishedAtSource: "page",
    retrievedAt: "2026-08-17",
    sourceQuality: "primary-news-organization",
    quote: "The six radiators on the International Space Station, which use ammonia as a coolant, have a combined mass of just over 6 metric tons.",
    textSha256: "a2decd2e64052479bc0e9c6a647fff54a847d230cb63649be05c3b0054969762",
  },
  "nature-noninvasive-mi-bci": {
    url: "https://www.nature.com/articles/s41467-026-75435-5",
    resolvedUrl: "https://www.nature.com/articles/s41467-026-75435-5",
    publisher: "Nature",
    publisherHost: "nature.com",
    author: "Wang, Hanwen",
    headline: "Sensory-guided human-machine joint learning accelerates the acquisition of motor imagery brain computer interface control - Nature Communications",
    publishedAt: "2026-07-15T00:00:00.000Z",
    publishedAtSource: "page",
    retrievedAt: "2026-08-17",
    sourceQuality: "peer-reviewed-journal",
    quote: "In contrast, non-invasive BCIs based on electroencephalography (EEG) offer a safe and more accessible alternative with potential applicability to a wide population.",
    textSha256: "52bf33ed7d00e5cd7cd73f4ff0bf8e559de5875f180956f4e0bf138d1ff198ae",
  },
  /* IN-WINDOW SOURCES reviewed 2026-08-17 from that day's proposal pass. Both are inside the
     14-day currency window at review time, so they enter the CITED channel rather than CONTEXT.
     Publisher, headline, date, quote and text hash were read off the live fetched page. IEEE
     Spectrum exposes no extractable byline on either page, so author is null rather than a name
     typed from the visible page — an inferred byline would be a fabricated provenance field. */
  "ieee-common-earth-chip-bottlenecks": {
    url: "https://spectrum.ieee.org/rare-earth-metals-in-semiconductors",
    resolvedUrl: "https://spectrum.ieee.org/rare-earth-metals-in-semiconductors",
    publisher: "IEEE Spectrum",
    publisherHost: "ieee.org",
    author: null,
    headline: "Could Rethinking Rare Earths Shield Chips From Geopolitics?",
    publishedAt: "2026-08-15T13:00:01.000Z",
    publishedAtSource: "page",
    retrievedAt: "2026-08-17",
    sourceQuality: "primary-news-organization",
    quote: "The goal of the project is to eliminate supply chain bottlenecks in the manufacturing of silicon chips.",
    textSha256: "b0195a2d1d47deb1abf8b1e3e091248ae5ce6902fef17393a5a6a640b3b0fa8b",
  },
  "ieee-persona-humanoid-welding": {
    url: "https://spectrum.ieee.org/persona-ai-humanoid-robot-welding",
    resolvedUrl: "https://spectrum.ieee.org/persona-ai-humanoid-robot-welding",
    publisher: "IEEE Spectrum",
    publisherHost: "ieee.org",
    author: null,
    headline: "Inside Persona’s Bold Bet On Humanoid Welders In Shipyards",
    publishedAt: "2026-08-17T15:33:42.000Z",
    publishedAtSource: "page",
    retrievedAt: "2026-08-17",
    sourceQuality: "primary-news-organization",
    quote: "These are the same environments with the same sorts of potential applications that basically every other humanoid robotics company is attempting to make economically viable, and despite an ever more exhaustive number of demonstrations, so far none have succeeded at any sort of useful scale.",
    textSha256: "0e441d70fd87f0847123c3cf70eecf13577b9dc1a35303f249178ad7a29237ad",
  },
};

/*
 * NEWS_GROUPS binds reviewed sources to prediction IDs, exactly like
 * EXTERNAL_GROUPS. Each group carries the reviewed rationale, the reuse family
 * and the evidence type, and every entry is manually reviewed.
 */
const NEWS_GROUPS = [
  {
    source: "nature-ai-datacentre-energy-1",
    ids: ["2027-5"],
    evidenceType: "leading-indicator",
    evidenceBasis: "measured-infrastructure-constraint",
    reuseFamily: "datacentre-energy",
    rationale: "Nature reports measured global data-centre electricity use and the IEA doubling projection, evidencing datacentre power as a top-tier infrastructure constraint. It does not evidence the water or grid-interconnection elements of the prediction.",
    reviewedAt: "2026-08-13",
  },
  {
    source: "nature-ai-datacentre-energy-2",
    ids: ["2028-4"],
    evidenceType: "leading-indicator",
    evidenceBasis: "measured-capital-commitment",
    reuseFamily: "datacentre-energy",
    rationale: "The same Nature analysis records the five largest technology firms committing more than US$600 billion to AI infrastructure this year against under $40 billion a decade ago, evidencing the scale of annual datacentre commitments. It makes no comparison to any defence budget.",
    reviewedAt: "2026-08-13",
  },
  {
    source: "challenger-ai-labour-market",
    ids: ["2028-1"],
    evidenceType: "leading-indicator",
    evidenceBasis: "labour-market-statistics",
    reuseFamily: "ai-labour-market",
    rationale: "Challenger, Gray & Christmas attribute the leading stated reason for US layoffs to AI for a fifth consecutive month while hiring rose 25%, evidencing AI reshaping white-collar work. It does not evidence that most professions yet supervise AI agents.",
    reviewedAt: "2026-08-13",
  },
  {
    source: "ars-frontier-agent-network-intrusions",
    ids: ["2031-4"],
    evidenceType: "direct",
    evidenceBasis: "incident-report",
    reuseFamily: "agent-control-incidents",
    rationale: "Ars Technica reports the second disclosed incident in ten days of frontier models trespassing into protected networks, evidencing the repeated frontier-agent circumvention the prediction is conditioned on. It does not evidence that trajectory-level monitoring has been made mandatory.",
    reviewedAt: "2026-08-13",
  },
  {
    source: "ec-ai-act-enforcement-august",
    ids: ["2026-4"],
    evidenceType: "direct",
    evidenceBasis: "regulatory-milestone",
    reuseFamily: "frontier-governance",
    rationale: "The European Commission records the AI Office and national authorities beginning enforcement of the AI Act, evidencing the EU half of the prediction. It concerns transparency obligations and does not evidence US practice or cyber, bio and autonomy release thresholds.",
    reviewedAt: "2026-08-13",
  },
  /* REMOVED 2026-08-17 — arxiv-persuasive-intent-disclosure (https://arxiv.org/abs/2608.11794)
     was a live cited source for 2033-3. It is an unreviewed arXiv preprint, which the evidence bar
     has always called "a claim, not a finding", and it was admissible only because arxiv.org had
     been exempted from REJECTED_HOSTS on the grounds that removing it would invalidate this very
     mapping. The exemption is withdrawn and the mapping goes with it. A search for a peer-reviewed
     or reported version of the same result found none, so nothing is substituted: 2033-3 returns to
     the uncited channel with an honest record rather than keeping a citation that does not meet the
     bar. Its sourceQuality was 'original-researcher', which renders as authoritative provenance on
     an unreviewed abstract — a false provenance claim, not merely a wrong field. */
  {
    source: "techreview-ai-for-science-reasoning",
    ids: ["2037-0"],
    evidenceType: "scenario",
    evidenceBasis: "expert-analysis",
    reuseFamily: "ai-science-acceleration",
    rationale: "A named MIT Technology Review analysis argues the acceleration of science will come through AI agents rather than AlphaFold-style data models. It is contested expert analysis bearing on the mechanism of acceleration and explicitly cautions that the conditions may take decades; it does not evidence any 10x-1000x figure.",
    reviewedAt: "2026-08-13",
  },
  /* CONTEXT-CHANNEL GROUPS, promoted 2026-08-17. The verdicts and their reasoning are recorded in
     news-backfill-review.js; repeated here in the rationale so the ledger is auditable on its own.
     Each of these is OUT of the 14-day window and therefore renders as dated background, labelled
     with its true age, never as current evidence. */
  {
    source: "ars-orbital-datacenter-constraints-1",
    ids: ["2026-8"],
    evidenceType: "leading-indicator",
    evidenceBasis: "reported-engineering-constraint",
    reuseFamily: "orbital-compute-constraints",
    rationale: "The prediction thresholds on orbital compute remaining demonstrator-scale through 2026 with no operator disclosing utility-scale power and cooling. This reported analysis describes the next flight as a 450 kg satellite with 8 kW of generation that has yet to demonstrate efficient heat rejection or customer workloads — demonstrator scale, stated by the operator. It evidences the state of the art; it does not evidence that the 2026 outcome has occurred.",
    reviewedAt: "2026-08-17",
  },
  {
    source: "ars-orbital-datacenter-constraints-2",
    ids: ["2039-4"],
    evidenceType: "scenario",
    evidenceBasis: "reported-engineering-constraint",
    reuseFamily: "orbital-compute-constraints",
    rationale: "The prediction names 1 MW of disclosed electrical power with MATCHED RADIATORS sustained for 90 days. The same reported analysis quantifies the radiator side of that coupling — the ISS needs six ammonia radiators massing over 6 tonnes — which is the constraint that makes the threshold hard. It is a scenario source for the engineering constraint, never evidence the threshold has been met. Second and final use of this article: a third mapping was refused on the reuse ceiling.",
    reviewedAt: "2026-08-17",
  },
  {
    source: "nature-noninvasive-mi-bci",
    ids: ["horizon-non-invasive-neural-symbiosis"],
    evidenceType: "leading-indicator",
    evidenceBasis: "peer-reviewed-result",
    reuseFamily: "non-invasive-bci",
    rationale: "The horizon item is about GENUINELY non-invasive interfaces as a separate, lower-risk path. This peer-reviewed Nature Communications study is on scalp-recorded EEG motor-imagery BCI and states directly that non-invasive EEG BCIs are the safer, more accessible alternative. The disambiguation guard holds: EEG is scalp-recorded, so this is not an implanted or endovascular interface. It evidences the path's viability, not its arrival.",
    reviewedAt: "2026-08-17",
  },
  /* IN-WINDOW GROUPS reviewed 2026-08-17. Both articles were published inside the 14-day window,
     so these are CITED rather than CONTEXT. Each rationale states what the article evidences AND
     what it does not, because a prediction that names several facets is not evidenced by a source
     that speaks to one of them. */
  {
    source: "ieee-common-earth-chip-bottlenecks",
    ids: ["2030-5"],
    evidenceType: "leading-indicator",
    evidenceBasis: "reported-production-constraint",
    reuseFamily: "semiconductor-supply-constraints",
    rationale: "The prediction claims the binding constraint on AI-driven growth shifts from ideas to PHYSICAL production, energy and robotics. IEEE Spectrum reports a University of Michigan/Imec research programme whose stated goal is eliminating supply-chain bottlenecks in silicon-chip manufacturing — critical elements, hafnium, plasma-coating rare earths and PFAS byproducts — including the observation that scaling semiconductor manufacturing requires scaling a second industry. That is a concrete leading indicator on the physical-production facet, at the material substrate of AI compute. It does NOT evidence the energy or robotics facets, does not measure any growth rate, and does not establish that the shift away from ideas has already occurred.",
    reviewedAt: "2026-08-17",
  },
  {
    source: "ieee-persona-humanoid-welding",
    ids: ["2026-3"],
    evidenceType: "leading-indicator",
    evidenceBasis: "reported-deployment-state",
    reuseFamily: "humanoid-industrial-deployment",
    rationale: "The prediction is two-sided: humanoids move onto live factory lines in the thousands BUT remain far short of general physical labor. This reported IEEE Spectrum account of Persona AI's shipyard-welding programme, with named industrial partners, evidences the second half directly and in the industry's own terms — every humanoid company is attempting to make the same environments economically viable and, despite an ever-growing number of demonstrations, none has succeeded at any useful scale, which is why Persona deliberately narrowed to a single robot-friendly skilled task. It also evidences the entry of humanoids into economically valuable industrial work. It does NOT evidence that thousands of humanoids are on live factory lines: the article reports a customer-scale ambition of hundreds of robots per location, and an ambition is not deployed capacity. This mapping stands on its own positive case for 2026-3 and is not a relocation of the separately rejected 2032-1 proposal.",
    reviewedAt: "2026-08-17",
  },
];

const NEWS_MAPPINGS = {};
for (const group of NEWS_GROUPS) {
  if (!NEWS_SOURCES[group.source]) throw new Error(`Unknown news evidence source ${group.source}`);
  for (const predictionId of group.ids) {
    if (NEWS_MAPPINGS[predictionId]) throw new Error(`Duplicate news evidence mapping for ${predictionId}`);
    NEWS_MAPPINGS[predictionId] = {
      source: group.source,
      reuseFamily: group.reuseFamily,
      evidenceType: group.evidenceType,
      rationale: group.rationale,
      reviewedAt: group.reviewedAt,
      lastVerifiedAt: group.lastVerifiedAt || group.reviewedAt,
    };
  }
}

/* Same source-quality bar already applied to external X evidence. */
const NEWS_QUALITY_CLASSES = new Set([
  'official-research-organization',
  'official-ai-lab',
  'official-company',
  'government',
  'intergovernmental-organization',
  'academic-researcher',
  'academic-research-institution',
  'peer-reviewed-journal',
  'primary-news-organization',
  'named-expert-analysis',
  'original-researcher',
]);

/* The transports a reviewed row may declare for its live re-read. 'https' is the plain GET every
   existing row uses and remains the default, so an undeclared row behaves exactly as before.
   'browser' routes the read through browse-transport.js for publishers that refuse a non-browser
   client. This is an ENUMERATION rather than a free string because the value selects executable
   behaviour at publish time: a typo that fell through to a default would verify a browser-only
   source with the transport it is declared to fail, and report the resulting failure as if the
   article had gone. */
const NEWS_TRANSPORTS = new Set(['https', 'browser']);

/*
 * Hosts that can never be primary news provenance: aggregators and syndicated
 * republishers, press-release mills, SEO/AI content farms and link shorteners.
 * Matching is on the registrable host, so subdomains are covered.
 */
const REJECTED_HOSTS = new Map([
  ['news.google.com', 'aggregator'],
  ['news.yahoo.com', 'aggregator'],
  ['finance.yahoo.com', 'aggregator'],
  ['msn.com', 'aggregator'],
  ['flipboard.com', 'aggregator'],
  ['smartnews.com', 'aggregator'],
  ['apple.news', 'aggregator'],
  ['reddit.com', 'aggregator'],
  ['news.ycombinator.com', 'aggregator'],
  ['techmeme.com', 'aggregator'],
  ['slashdot.org', 'aggregator'],
  ['digg.com', 'aggregator'],
  ['feedly.com', 'aggregator'],
  ['prnewswire.com', 'press-release mill'],
  ['businesswire.com', 'press-release mill'],
  ['globenewswire.com', 'press-release mill'],
  ['einpresswire.com', 'press-release mill'],
  ['accesswire.com', 'press-release mill'],
  ['newswire.com', 'press-release mill'],
  ['openpr.com', 'press-release mill'],
  ['prweb.com', 'press-release mill'],
  ['medium.com', 'open publishing platform'],
  ['substack.com', 'open publishing platform'],
  /*
   * Preprint servers whose posting is a claim rather than a finding. This rule was declared
   * in the evidence policy and enforced NOWHERE — classifyHost accepted all four — so it was
   * a guard made of prose, which protects only for as long as someone remembers to read it.
   * It is code now because the news backfill asks the machine, not a reader, whether a source
   * qualifies.
   *
   * arxiv.org WAS deliberately absent, and that exemption is withdrawn on 2026-08-17. The
   * recorded reason was that arxiv.org is "a live cited source in this very file", so adding
   * it "would retroactively invalidate published evidence". That is the argument running
   * backwards: it admits the host BECAUSE something inadmissible was already admitted, which
   * is precisely how a bar gets crossed without anyone deciding to cross it. If published
   * evidence does not meet the bar, invalidating it is the CORRECT outcome and not a cost to
   * be avoided. The governing test is whether the record carries peer review or editorial
   * responsibility, never whether its host happens to be enumerated here, and an arXiv v1
   * abstract carries neither. The single mapping that depended on this exemption
   * (arxiv-persuasive-intent-disclosure -> 2033-3) is removed in the same change rather than
   * grandfathered, so the ledger and the rule agree instead of the rule bending to the ledger.
   * A preprint remains a legitimate DISCOVERY channel: use one to FIND the reviewed paper or
   * the reported story and cite THAT. If neither exists, the prediction stays uncited.
   */
  ['arxiv.org', 'preprint server — a claim, not a finding'],
  ['biorxiv.org', 'preprint server — a claim, not a finding'],
  ['medrxiv.org', 'preprint server — a claim, not a finding'],
  ['ssrn.com', 'preprint server — a claim, not a finding'],
  ['researchgate.net', 'preprint server — a claim, not a finding'],
  ['blogspot.com', 'open publishing platform'],
  ['wordpress.com', 'open publishing platform'],
  ['linkedin.com', 'open publishing platform'],
  ['t.co', 'link shortener'],
  ['bit.ly', 'link shortener'],
  ['tinyurl.com', 'link shortener'],
  ['ow.ly', 'link shortener'],
  ['buff.ly', 'link shortener'],
  ['lnkd.in', 'link shortener'],
  ['rb.gy', 'link shortener'],
  ['shorturl.at', 'link shortener'],
  ['dlvr.it', 'link shortener'],
  ['ift.tt', 'link shortener'],
  ['zerohedge.com', 'low-quality republisher'],
  ['dailymail.co.uk', 'low-quality republisher'],
  ['express.co.uk', 'low-quality republisher'],
  ['thesun.co.uk', 'low-quality republisher'],
  ['nypost.com', 'low-quality republisher'],
  ['futurism.com', 'aggregating rewrite outlet'],
  ['interestingengineering.com', 'aggregating rewrite outlet'],
  ['dailygalaxy.com', 'aggregating rewrite outlet'],
  ['scitechdaily.com', 'press-release republisher'],
  ['phys.org', 'press-release republisher'],
  ['eurekalert.org', 'press-release republisher'],
  ['sciencedaily.com', 'press-release republisher'],
  ['benzinga.com', 'content farm'],
  ['analyticsinsight.net', 'content farm'],
  ['marktechpost.com', 'content farm'],
  ['cointelegraph.com', 'content farm'],
]);

/* Structural giveaways that a host is a farm or a mirror regardless of name. */
const REJECTED_HOST_PATTERNS = [
  { pattern: /(^|\.)(amp|amp-cdn)\./i, reason: 'AMP mirror rather than the publisher original' },
  { pattern: /(^|\.)(webcache|cache)\./i, reason: 'cache mirror rather than the publisher original' },
  { pattern: /(^|\.)translate\./i, reason: 'translation proxy rather than the publisher original' },
  { pattern: /(^|\.)(m|mobile)\.facebook\.com$/i, reason: 'social platform, not a publisher' },
];

const REJECTED_URL_PATTERNS = [
  { pattern: /\/amp(\/|$|\.html)/i, reason: 'AMP rendition rather than the canonical article' },
  { pattern: /^https?:\/\/[^/]*\/?$/i, reason: 'site root rather than a specific article' },
];

/* ------------------------------------------------------------------ *
 * URL and host handling
 * ------------------------------------------------------------------ */

function registrableHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  // Handle the common two-part public suffixes used by news publishers.
  const twoPartSuffix = /^(co|com|org|net|gov|ac|edu|or|ne)\.[a-z]{2}$/;
  const lastTwo = parts.slice(-2).join('.');
  if (twoPartSuffix.test(lastTwo)) return parts.slice(-3).join('.');
  return lastTwo;
}

/*
 * Query parameters that are session, tracking or consent noise. They must be
 * stripped before a resolved URL is recorded, otherwise a publisher that
 * appends a per-request code (Nature appends ?error=cookies_not_supported&code=…)
 * would look like it had "drifted" on every single verification run.
 */
const VOLATILE_QUERY_PARAMS = [
  /^utm_/i, /^fbclid$/i, /^gclid$/i, /^mc_(cid|eid)$/i, /^igsh$/i, /^ref$/i, /^ref_src$/i,
  /^referrer$/i, /^source$/i, /^cmpid$/i, /^smid$/i, /^partner$/i, /^sh$/i, /^s$/i,
  /^error$/i, /^code$/i, /^token$/i, /^session/i, /^_ga$/i, /^spm$/i, /^at_/i,
];

function normalizeUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return String(url || '');
  }
  const keep = [];
  for (const [key, value] of parsed.searchParams.entries()) {
    if (!VOLATILE_QUERY_PARAMS.some(pattern => pattern.test(key))) keep.push([key, value]);
  }
  parsed.search = '';
  for (const [key, value] of keep) parsed.searchParams.append(key, value);
  parsed.hash = '';
  return parsed.toString();
}

/* Prefer the publisher's own canonical URL when it points at the same host. */
function canonicalUrl(html, finalUrl) {
  const match = html.match(/<link[^>]+rel\s*=\s*["']canonical["'][^>]*?href\s*=\s*["']([^"']+)["']/i)
    || html.match(/<link[^>]+href\s*=\s*["']([^"']+)["'][^>]*?rel\s*=\s*["']canonical["']/i);
  if (!match) return normalizeUrl(finalUrl);
  let candidate;
  try {
    candidate = new URL(collapse(match[1]), finalUrl).toString();
  } catch {
    return normalizeUrl(finalUrl);
  }
  const sameHost = registrableHost(new URL(candidate).hostname) === registrableHost(new URL(finalUrl).hostname);
  return normalizeUrl(sameHost ? candidate : finalUrl);
}

function classifyHost(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'unparsable URL' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: `unsupported protocol ${parsed.protocol}` };
  }
  const fullHost = String(parsed.hostname || '').toLowerCase().replace(/^www\./, '');
  const host = registrableHost(parsed.hostname);
  // Match the exact hostname, the registrable domain, and any parent suffix, so
  // news.google.com and finance.yahoo.com are caught as well as google.com.
  for (const candidate of [fullHost, host]) {
    if (REJECTED_HOSTS.has(candidate)) {
      return { ok: false, reason: `${candidate} is a ${REJECTED_HOSTS.get(candidate)}`, host };
    }
  }
  for (const [rejected, reason] of REJECTED_HOSTS) {
    if (fullHost === rejected || fullHost.endsWith(`.${rejected}`)) {
      return { ok: false, reason: `${fullHost} is a ${reason}`, host };
    }
  }
  for (const rule of REJECTED_HOST_PATTERNS) {
    if (rule.pattern.test(parsed.hostname)) return { ok: false, reason: rule.reason, host };
  }
  for (const rule of REJECTED_URL_PATTERNS) {
    if (rule.pattern.test(url)) return { ok: false, reason: rule.reason, host };
  }
  return { ok: true, host };
}

/* ------------------------------------------------------------------ *
 * Fetching
 * ------------------------------------------------------------------ */

function requestOnce(url) {
  return new Promise(resolve => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      resolve({ ok: false, reason: 'unparsable URL' });
      return;
    }
    const client = parsed.protocol === 'http:' ? http : https;
    const request = client.request(parsed, {
      method: 'GET',
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'accept-encoding': 'gzip, deflate, br',
        'cache-control': 'no-cache',
      },
      timeout: FETCH_TIMEOUT_MS,
    }, response => {
      const chunks = [];
      let bytes = 0;
      let aborted = false;
      const encoding = String(response.headers['content-encoding'] || '').toLowerCase();
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX_BODY_BYTES) {
          aborted = true;
          response.destroy();
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        let buffer = Buffer.concat(chunks);
        try {
          if (encoding === 'gzip') buffer = zlib.gunzipSync(buffer);
          else if (encoding === 'deflate') buffer = zlib.inflateSync(buffer);
          else if (encoding === 'br') buffer = zlib.brotliDecompressSync(buffer);
        } catch {
          resolve({ ok: false, status: response.statusCode, reason: 'undecodable response body' });
          return;
        }
        resolve({
          ok: true,
          status: response.statusCode,
          headers: response.headers,
          body: buffer.toString('utf8'),
          truncated: aborted,
        });
      });
      response.on('error', error => resolve({ ok: false, reason: error.message, code: error.code }));
    });
    request.on('timeout', () => {
      request.destroy();
      resolve({ ok: false, reason: `timeout after ${FETCH_TIMEOUT_MS}ms`, code: 'ETIMEDOUT' });
    });
    /* Carry the STRUCTURED code, not just the message. A caller that needs to tell "this host
       does not exist" from "this host did not answer" was previously forced to pattern-match
       the message text, which keys the decision to the message format rather than to the
       failure. libuv codes (ENOTFOUND, EAI_AGAIN, ECONNRESET, ETIMEDOUT) are stable and
       locale-invariant; the prose around them is neither guaranteed to be. */
    request.on('error', error => resolve({ ok: false, reason: error.message, code: error.code }));
    request.end();
  });
}

/*
 * Fetch an article, following redirects manually so the FINAL resolved URL is
 * recorded rather than the input URL, and so a redirect into an aggregator or
 * shortener is caught rather than silently followed.
 */
async function fetchArticle(url) {
  const redirects = [];
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const gate = classifyHost(current);
    if (!gate.ok) {
      return { ok: false, finalUrl: current, redirects, reason: `rejected source: ${gate.reason}` };
    }
    const response = await requestOnce(current);
    if (!response.ok) return { ok: false, finalUrl: current, redirects, reason: response.reason, code: response.code };
    const status = Number(response.status);
    if (status >= 300 && status < 400 && response.headers.location) {
      const next = new URL(response.headers.location, current).toString();
      redirects.push({ from: current, to: next, status });
      current = next;
      continue;
    }
    if (status !== 200) {
      return { ok: false, status, finalUrl: current, redirects, reason: `HTTP ${status}` };
    }
    return {
      ok: true,
      status,
      finalUrl: normalizeUrl(current),
      redirects,
      body: response.body,
      truncated: response.truncated === true,
    };
  }
  return { ok: false, finalUrl: current, redirects, reason: `exceeded ${MAX_REDIRECTS} redirects` };
}

/* ------------------------------------------------------------------ *
 * Extraction — every published field comes from here, never from memory
 * ------------------------------------------------------------------ */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '\u2013',
  mdash: '\u2014', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
  hellip: '\u2026', middot: '\u00b7', eacute: '\u00e9', egrave: '\u00e8', uuml: '\u00fc',
};

function decodeEntities(value) {
  return String(value == null ? '' : value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name) => {
      const key = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(ENTITIES, key) ? ENTITIES[key] : match;
    });
}

function collapse(value) {
  return decodeEntities(value).replace(/\s+/g, ' ').trim();
}

function metaContent(html, names) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name|itemprop)\\s*=\\s*["']${escaped}["'][^>]*?content\\s*=\\s*["']([^"']*)["']`, 'i'),
      new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*?(?:property|name|itemprop)\\s*=\\s*["']${escaped}["']`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && collapse(match[1])) return collapse(match[1]);
    }
  }
  return '';
}

function jsonLdBlocks(html) {
  const blocks = [];
  const pattern = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const raw = match[1].trim().replace(/^\uFEFF/, '');
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // Some publishers emit multiple concatenated objects or trailing commas; skip unparsable blocks.
    }
  }
  const flattened = [];
  const walk = node => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object') return;
    flattened.push(node);
    if (node['@graph']) walk(node['@graph']);
  };
  blocks.forEach(walk);
  return flattened;
}

function jsonLdArticle(html) {
  const nodes = jsonLdBlocks(html);
  const isArticle = node => {
    const type = node['@type'];
    const types = Array.isArray(type) ? type : [type];
    return types.some(value => /article|report|newsitem|blogposting|webpage/i.test(String(value || '')));
  };
  return nodes.find(node => isArticle(node) && (node.headline || node.name)) || null;
}

function nameOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return collapse(value);
  if (Array.isArray(value)) return value.map(nameOf).filter(Boolean).join(', ');
  if (typeof value === 'object') return collapse(value.name || value['@id'] || '');
  return '';
}

function stripToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<(nav|header|footer|aside|form|figure)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|br|section|article)>/gi, ' \n')
    .replace(/<[^>]+>/g, ' ');
}

function extractMainText(html) {
  const bodyMatch = html.match(/<body\b[\s\S]*?<\/body>/i);
  const bodyText = collapse(stripToText(bodyMatch ? bodyMatch[0] : html));
  const candidates = [
    ...(html.match(/<article\b[\s\S]*?<\/article>/gi) || []),
    ...(html.match(/<main\b[\s\S]*?<\/main>/gi) || []),
  ].map(region => collapse(stripToText(region)));
  // Take the richest semantic region, but fall back to the full body when that
  // region is only a fragment — some publishers wrap a teaser in <article>.
  const best = candidates.sort((a, b) => b.length - a.length)[0] || '';
  return best.length >= Math.max(400, bodyText.length * 0.3) ? best : bodyText;
}

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
const RENDERED_DATE_PATTERNS = [
  new RegExp(`\\b(${MONTHS})[a-z]*\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'gi'),
  new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS})[a-z]*\\.?\\s+(\\d{4})\\b`, 'gi'),
  /\b(\d{4})-(\d{2})-(\d{2})\b/g,
];

/*
 * Last-resort publication date read from the RENDERED page rather than metadata.
 * Only accepted when the opening of the article yields exactly one distinct
 * date, so an ambiguous page fails closed instead of guessing.
 */
function renderedPublishedDate(mainText) {
  const window = String(mainText || '').slice(0, 1200);
  const found = new Set();
  for (const pattern of RENDERED_DATE_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(window))) {
      // Parse as UTC. A bare calendar date ("Jul 24, 2026") is otherwise parsed in the
      // RUNNER'S local timezone and then serialised back through toISOString() in UTC, so
      // every date-only page shifted one day EARLIER on any host east of UTC. That silently
      // publishes a wrong publication date, which this system treats as fabrication.
      const parsed = new Date(`${match[0].replace(/,/g, '')} UTC`);
      if (!Number.isNaN(parsed.getTime())) found.add(parsed.toISOString().slice(0, 10));
    }
  }
  return found.size === 1 ? [...found][0] : '';
}

/*
 * BOT-CHALLENGE / INTERSTITIAL DETECTION.
 *
 * Some publishers (nature.com among them) intermittently answer an automated request with a
 * ~3KB "Client Challenge" shell instead of the article — and serve it with HTTP 200. Status
 * alone therefore does NOT mean "fetched". This matters far more than it looks: a challenge
 * shell contains none of the article prose, so a naive verifier concludes the supporting
 * quote has vanished and reports EVIDENCE DRIFT against a citation that is completely
 * genuine and completely unchanged.
 *
 * An infrastructure fault must never be able to evict real evidence. This classifies the two
 * apart so callers can retry and, if it persists, report UNVERIFIABLE-INFRASTRUCTURE rather
 * than accusing the source of tampering.
 */
const CHALLENGE_MARKERS_STRONG = [
  'cf-browser-verification', '__cf_chl', 'Client Challenge', 'Attention Required! | Cloudflare',
  'Checking your browser before accessing', 'DDoS protection by', 'Please verify you are a human',
];
const CHALLENGE_MARKERS_WEAK = [
  'JavaScript is disabled in your browser', 'Enable JavaScript and cookies to continue', 'Just a moment',
];
function detectBotChallenge(html, mainText) {
  const body = String(html || '');
  const prose = String(mainText || '');
  const strong = CHALLENGE_MARKERS_STRONG.find(m => body.includes(m));
  if (strong) return { challenged: true, reason: `interstitial marker "${strong}"` };
  // These phrases can legitimately appear inside a real article, so they only count as a
  // challenge when the response is also too small to BE an article.
  if (body.length < 20000) {
    const weak = CHALLENGE_MARKERS_WEAK.find(m => body.includes(m));
    if (weak) return { challenged: true, reason: `interstitial marker "${weak}" in a ${body.length}-byte response` };
    if (prose.length < 500) {
      return { challenged: true, reason: `implausibly small response (${body.length} bytes, ${prose.length} chars of prose)` };
    }
  }
  return { challenged: false, reason: '' };
}

function extractArticle(html, finalUrl) {
  const ld = jsonLdArticle(html) || {};
  const headline = metaContent(html, ['og:title', 'twitter:title'])
    || collapse(ld.headline || ld.name || '')
    || collapse((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '')
    || collapse((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '')
    // Academic publishers often expose only these. Appended LAST on purpose: a new tag
    // earlier in the chain would change already-captured headlines and trip the drift
    // check on genuine articles. This only adds reach where the chain currently returns
    // nothing, and an empty headline still fails closed.
    || metaContent(html, ['citation_title', 'dc.title', 'DC.title', 'dcterms.title']);
  const publisher = metaContent(html, ['og:site_name', 'application-name', 'publisher', 'DC.publisher'])
    || nameOf(ld.publisher)
    || nameOf(ld.sourceOrganization)
    || nameOf(ld.isPartOf)
    || '';
  const authorRaw = metaContent(html, ['article:author', 'author', 'byl', 'parsely-author', 'DC.creator'])
    || nameOf(ld.author)
    || collapse((html.match(/rel=["']author["'][^>]*>([\s\S]*?)</i) || [])[1] || '');
  // A byline is optional. Publishers frequently put a social profile URL in
  // article:author; a URL is not a byline, so drop it rather than publish it.
  const author = /^(https?:\/\/|@|www\.)/i.test(authorRaw) || authorRaw.length > 120 ? '' : authorRaw;
  // A MODIFICATION time is not a PUBLICATION date, and article:modified_time was previously
  // read as one. That is a freshness fabrication in both directions. Measured on
  // nih.gov/news-events/nih-research-matters/brain-computer-device-helps-man-speak, which
  // carries og:updated_time and article:modified_time (2026-07-30T14:49:47-04:00) and NO
  // published tag at all, while the page shows readers "July 14, 2026": the old chain
  // recorded the article 16 days fresher than it is, and every later publisher edit would
  // silently re-start its 60-day currency clock without one word of new reporting. It also
  // guarantees drift, since the value changes whenever the page is touched, so the verifier
  // would eventually report a date change on an article that never changed. Removing it lets
  // such a page fall through to renderedPublishedDate(), which reads the date the publisher
  // actually shows readers. Verified safe against the whole reviewed ledger before removal:
  // 6 of 9 sources resolve via article:published_time and 3 already fall through, so NO
  // captured date moves. A page with no honest publication date now fails closed, which is
  // the correct outcome for a layer whose entire job is stating how current something is.
  const publishedRaw = metaContent(html, [
    'article:published_time', 'datePublished', 'date', 'parsely-pub-date',
    'og:published_time', 'pubdate', 'publish-date', 'DC.date.issued',
  ])
    || collapse(ld.datePublished || ld.dateCreated || '')
    || collapse((html.match(/<time[^>]+datetime\s*=\s*["']([^"']+)["']/i) || [])[1] || '')
    // Same reasoning as the headline chain: academic-publisher tags appended last so no
    // already-captured date can shift. A date that still cannot be extracted fails closed.
    || metaContent(html, ['citation_publication_date', 'citation_online_date', 'DC.date', 'dcterms.date']);
  const mainText = extractMainText(html);
  let publishedAt = '';
  if (publishedRaw) {
    // A value with no time-of-day is a bare calendar date and therefore carries no
    // timezone. new Date() would interpret it in LOCAL time and toISOString() would then
    // serialise it in UTC, recording the date one day EARLY on any host east of UTC.
    // Verified at UTC+10: '2026/06/15', 'June 15, 2026' and '15 June 2026' all shifted.
    const bareCalendarDate = !/\d:\d/.test(publishedRaw);
    const parsed = new Date(bareCalendarDate ? `${publishedRaw} UTC` : publishedRaw);
    if (!Number.isNaN(parsed.getTime())) publishedAt = parsed.toISOString();
  }
  if (!publishedAt) {
    const rendered = renderedPublishedDate(mainText);
    if (rendered) publishedAt = new Date(`${rendered}T00:00:00.000Z`).toISOString();
  }
  let host = '';
  try {
    host = registrableHost(new URL(finalUrl).hostname);
  } catch {
    host = '';
  }
  return {
    headline,
    publisher: publisher || '',
    author: author || '',
    publishedAt,
    publishedRaw,
    mainText,
    host,
    canonicalUrl: canonicalUrl(html, finalUrl),
    textSha256: sha256(mainText),
  };
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value == null ? '' : value), 'utf8').digest('hex');
}

/*
 * Quote matching is whitespace and typography tolerant but never word tolerant:
 * the words themselves must appear verbatim and in order.
 */
function normalizeForQuote(value) {
  return decodeEntities(value)
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201c\u201d\u2033]/g, '"')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    /* Collapse whitespace introduced by inline markup boundaries. A sentence spanning an
       <a>, <em>, <strong> or <time> tag strips to "revealed Thursday , are", so a recorded
       quote that crosses one would stop matching the moment a publisher adds or removes a
       mid-sentence link — the prose unchanged, yet reported as quote drift. That is the
       same false-evidence-fault class as the bot challenge. This touches only whitespace
       ADJACENT TO punctuation: it can never make two different words compare equal, so it
       normalises presentation without weakening the verbatim guarantee. */
    .replace(/\s+([,.;:!?)\]])/g, '$1')
    .replace(/([(\[])\s+/g, '$1')
    .trim()
    .toLowerCase();
}

function quotePresent(mainText, quote) {
  const haystack = normalizeForQuote(mainText);
  const needle = normalizeForQuote(quote);
  return Boolean(needle) && haystack.includes(needle);
}

/* ------------------------------------------------------------------ *
 * Verification
 * ------------------------------------------------------------------ */

/*
 * Verify one reviewed news source against the live web. Returns an array of
 * problems; an empty array means the source is publishable. Every failure mode
 * is fail-closed: a missing field, a dead URL, a moved quote or a changed
 * headline all block publication rather than degrading silently.
 */
async function verifyNewsSource(key, source, options = {}) {
  const problems = [];
  const label = `news:${key}`;
  // publishedAtSource is REQUIRED because 'publishedAt' names two DIFFERENT facts in this tree: the
  // RSS pubDate in currency-candidates.json, and the date the fetched page itself states here. They
  // legitimately differ - arXiv submission vs announcement date, or a slug dated 2 August on a feed
  // item stamped 31 July - so a checker comparing them as one field reports a conflict that is not
  // one. Carrying the provenance with the value is what makes a like-for-like comparison possible.
  const required = ['url', 'resolvedUrl', 'publisher', 'publisherHost', 'headline', 'publishedAt', 'publishedAtSource', 'retrievedAt', 'sourceQuality', 'quote', 'textSha256'];
  for (const field of required) {
    if (!source || !String(source[field] || '').trim()) problems.push(`${label}: missing ${field}`);
  }
  if (problems.length) return { problems, fetched: null };

  if (!NEWS_QUALITY_CLASSES.has(source.sourceQuality)) {
    problems.push(`${label}: invalid source-quality class ${source.sourceQuality}`);
  }
  const gate = classifyHost(source.resolvedUrl);
  if (!gate.ok) problems.push(`${label}: ${gate.reason}`);
  if (gate.ok && gate.host !== registrableHost(source.publisherHost)) {
    problems.push(`${label}: resolved host ${gate.host} does not match declared publisher host ${source.publisherHost}`);
  }
  if (String(source.quote).trim().length < 40) {
    problems.push(`${label}: supporting quote is too short to be probative`);
  }

  /* TRANSPORT SELECTION — DECLARED PER SOURCE, NEVER INFERRED FROM A FAILURE.
     Some publishers refuse a plain GET: they answer an interstitial challenge, or they ship a
     shell and render the article in JavaScript. Those articles were unusable as evidence, and the
     absence looked exactly like "no qualifying source exists". A reviewed row may now declare
     transport: 'browser' and be read through browse-transport.js instead.

     The declaration is a REVIEW ACT, not a retry. This deliberately does NOT fetch, notice a
     failure and then reach for a browser: an automatic escalation would make every flaky network
     error, paywall and geo-block silently change how a citation is obtained, and nobody would be
     able to say from the ledger which transport verified what. For the same reason a row that
     declares 'browser' when no browser transport was supplied FAILS rather than falling back to
     the plain fetch it is known to fail — a fallback would turn a stated capability requirement
     into an unexplained verification failure. */
  const declaredTransport = String((source && source.transport) || 'https').toLowerCase();
  if (!NEWS_TRANSPORTS.has(declaredTransport)) {
    problems.push(`${label}: unknown transport "${declaredTransport}"; declare one of ${[...NEWS_TRANSPORTS].join(', ')}`);
    return { problems, fetched: null };
  }
  if (declaredTransport === 'browser' && typeof options.browserTransport !== 'function') {
    problems.push(`${label}: declares transport "browser" but no browser transport was supplied; `
      + 'refusing to substitute a plain fetch this source is declared to fail');
    return { problems, fetched: null };
  }
  const transport = declaredTransport === 'browser' ? options.browserTransport : fetchArticle;

  const fetched = await transport(source.url);
  if (!fetched.ok) {
    problems.push(`${label}: live ${declaredTransport} read failed (${fetched.reason})`);
    return { problems, fetched };
  }
  const extracted = extractArticle(fetched.body, fetched.finalUrl);
  if (extracted.canonicalUrl !== normalizeUrl(source.resolvedUrl)) {
    problems.push(`${label}: resolved URL drifted to ${extracted.canonicalUrl}`);
  }
  const finalGate = classifyHost(fetched.finalUrl);
  if (!finalGate.ok) problems.push(`${label}: redirect landed on a rejected source (${finalGate.reason})`);
  if (!extracted.headline) problems.push(`${label}: headline could not be extracted from the fetched page`);
  if (!extracted.publisher) problems.push(`${label}: publisher could not be extracted from the fetched page`);
  if (!extracted.publishedAt) problems.push(`${label}: publication date could not be extracted from the fetched page`);
  if (extracted.headline && collapse(extracted.headline) !== collapse(source.headline)) {
    problems.push(`${label}: headline changed materially since review`);
  }
  if (extracted.publishedAt && source.publishedAt
      && extracted.publishedAt.slice(0, 10) !== String(source.publishedAt).slice(0, 10)) {
    problems.push(`${label}: publication date changed since review`);
  }
  if (!quotePresent(extracted.mainText, source.quote)) {
    problems.push(`${label}: the reviewed supporting quote is no longer present in the article`);
  }
  const drifted = extracted.textSha256 !== source.textSha256;
  if (drifted && options.requireStableText) {
    problems.push(`${label}: article main text changed since review`);
  }
  return { problems, fetched, extracted, textDrift: drifted, transport: declaredTransport };
}

module.exports = {
  NEWS_GROUPS,
  NEWS_MAPPINGS,
  NEWS_SOURCES,
  NEWS_QUALITY_CLASSES,
  NEWS_TRANSPORTS,
  REJECTED_HOSTS,
  canonicalUrl,
  classifyHost,
  collapse,
  decodeEntities,
  detectBotChallenge,
  extractArticle,
  extractMainText,
  fetchArticle,
  normalizeForQuote,
  normalizeUrl,
  quotePresent,
  registrableHost,
  renderedPublishedDate,
  sha256,
  verifyNewsSource,
};
