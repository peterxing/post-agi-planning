'use strict';

const RETRIEVED_AT = '2026-07-21';

// X RETIREMENT 2026-08-13 — every entry here was an authoritative X status. They were removed on the
// site owner's instruction to stop citing X posts. The module keeps its shape so the derivation and
// its duplicate/unknown-source throws stay live, but it now supplies NO evidence: verified news is
// the only tier, and a prediction with no qualifying in-window source renders UNCITED.
const EXTERNAL_SOURCES = {};

const EXTERNAL_GROUPS = [];

const EXTERNAL_MAPPINGS = {};
for (const group of EXTERNAL_GROUPS) {
  if (!EXTERNAL_SOURCES[group.source]) throw new Error(`Unknown external evidence source ${group.source}`);
  for (const predictionId of group.ids) {
    if (EXTERNAL_MAPPINGS[predictionId]) throw new Error(`Duplicate external evidence mapping for ${predictionId}`);
    EXTERNAL_MAPPINGS[predictionId] = {
      source: group.source,
      reuseFamily: group.reuseFamily,
      evidenceType: group.evidenceType,
      rationale: group.rationale,
      reviewedAt: group.reviewedAt || RETRIEVED_AT,
    };
  }
}

module.exports = {
  EXTERNAL_GROUPS,
  EXTERNAL_MAPPINGS,
  EXTERNAL_SOURCES,
};
