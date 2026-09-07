'use strict';

// Shared, side-effect-free validation; the authenticated collector stays operator-local.
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
  if (caps.recentSearchAvailable !== true) {
    throw new Error(`authored-post search unavailable: ${caps.recentSearchNote || 'no successful response'}. `
      + 'REFUSING to overwrite the existing cache with a partial harvest.');
  }
}

module.exports = { assertCompleteHarvest };
