'use strict';

// Shared, side-effect-free validation; every collector and importer stays operator-local.

/* The private cache's item schema, field for field. The archive importer must produce exactly what
   the paid collector produced so that x-signals.js and every gate downstream cannot tell the
   transport apart; verify-x-archive.js asserts the parity. */
const CACHE_ITEM_KEYS = ['id', 'sourceId', 'kind', 'author', 'authorship', 'created', 'text', 'likes', 'rts', 'statusId'];

function assertCompleteHarvest(payload) {
  if (!Array.isArray(payload.items) || !payload.items.length) {
    throw new Error('harvest produced 0 items. REFUSING to overwrite the existing cache - '
      + 'an outage must not be published as an empty timeline.');
  }
  const caps = payload.caps;
  if (!caps || !Array.isArray(caps.timelinePageFailures)) {
    throw new Error('harvest completeness is unrecorded. REFUSING to overwrite the existing cache.');
  }
  if (caps.partial || caps.timelinePageFailures.length) {
    const pages = caps.timelinePageFailures.map(f => `p${f.page}:HTTP ${f.status}`).join(', ');
    throw new Error(`harvest is PARTIAL: ${payload.items.length} item(s)`
      + `${pages ? ` (${pages})` : ''}. REFUSING to overwrite the existing cache.`);
  }
  if (payload.source === 'x-archive') {
    assertCompleteArchive(payload);
    return;
  }
  if (caps.recentSearchAvailable !== true) {
    throw new Error(`authored-post search unavailable: ${caps.recentSearchNote || 'no successful response'}. `
      + 'REFUSING to overwrite the existing cache with a partial harvest.');
  }
}

/* An archive import has no pages and needs no search: X writes the whole account into one export.
   Its completeness is therefore checked differently — X must not have marked the archive partial,
   every declared tweets file must have been parsed in full, and nothing may postdate the archive's
   own generation date. A payload that claims to be an archive and cannot show all of that is
   refused exactly like a partial API harvest. */
function assertCompleteArchive(payload) {
  const fail = message => {
    throw new Error(`archive import ${message}. REFUSING to overwrite the existing cache.`);
  };
  const { archive, caps } = payload;
  if (!archive || archive.isPartialArchive !== false || typeof archive.userName !== 'string'
    || archive.userName.toLowerCase() !== String(payload.account || '').toLowerCase()
    || 'accountId' in archive || 'userId' in payload) {
    fail('provenance is missing, marks a partial archive, names another account or retains an account id');
  }
  const generated = Date.parse(archive.generationDate);
  if (!Number.isFinite(generated) || payload.harvestedAt !== archive.generationDate) fail('carries no valid archive generation date');
  if (!Array.isArray(archive.files) || !archive.files.length || archive.files.some(file => !Number.isInteger(file.declaredCount)
    || file.declaredCount !== file.parsedCount || !/^[a-f0-9]{64}$/.test(String(file.sha256)))) {
    fail('is truncated: a declared tweets file was not parsed in full');
  }
  if (caps.archiveComplete !== true || caps.timelineComplete !== true || caps.declaredTweets !== caps.parsedTweets) {
    fail('is not recorded as complete');
  }
  for (const item of payload.items) {
    if (!item || Object.keys(item).join('|') !== CACHE_ITEM_KEYS.join('|')) fail(`item ${item && item.id} does not match the cache schema`);
    if (!(Date.parse(item.created) <= generated)) fail(`item ${item.id} is dated after the archive was generated`);
    const repost = item.kind === 'repost';
    if (!['post', 'quote', 'repost'].includes(item.kind) || item.authorship !== (repost ? 'reposted' : 'authored')
      || item.statusId !== item.id) {
      fail(`item ${item.id} has an inconsistent kind or authorship`);
    }
  }
}

/* An archive-sourced layer may surface ONLY posts that X's public embed service confirmed during the
   verification run for THAT import (x-oembed.js). The record is bound to the import by its
   importedAt and harvestedAt, so a verification left over from an earlier archive cannot vouch for
   a later one. A post kept on its last-good verification because X was rate-limiting counts, and
   carries its original check date; a post verified as gone, or never checked, does not. */
function verificationFor(harvest, cache) {
  if (harvest.source !== 'x-archive') return null;
  const run = cache && cache.lastRun;
  if (!cache || cache.schemaVersion !== 1 || !cache.entries || typeof cache.entries !== 'object' || !run
    || run.importedAt !== harvest.importedAt || run.harvestedAt !== harvest.harvestedAt
    || !Number.isFinite(Date.parse(run.completedAt)) || !run.statuses || typeof run.statuses !== 'object') {
    throw new Error('the oEmbed verification record does not belong to this archive import. '
      + 'Run node x-oembed.js --verify-signals for the current import first.');
  }
  const entry = item => cache.entries[item.statusId] || null;
  const usable = item => ['verified', 'last-good'].includes(run.statuses[item.statusId])
    && Boolean(entry(item)) && entry(item).status === 'ok';
  return { run, entry, usable, status: item => run.statuses[item.statusId] || null };
}

module.exports = { assertCompleteHarvest, verificationFor, CACHE_ITEM_KEYS };
