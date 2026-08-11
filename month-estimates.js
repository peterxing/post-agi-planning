// month-estimates.js — the canonical, auditable source of truth for Part 2 of the
// currency directive: an estimated month for each of the 96 DATED events.
//
// DESIGN RULES, enforced by validate-predictions.js and verify-currency.js:
//
//  1. ADDITIVE ONLY. Nothing here rewrites a prediction's `t`. `t` is the sticky binding
//     key for every evidence approval in evidence-approvals.json; changing one byte of it
//     silently invalidates that prediction's reviewed mapping. The month lives in separate
//     fields (m, mBand, mBasis) that no approval keys on.
//
//  2. EVERY MONTH HAS A STATED BASIS tied to a real, checkable pace signal — a measured
//     capability trend, a shipped-product cadence, a build or generation lead time, a
//     statutory or fiscal calendar, an election date, a regulatory review clock, or a
//     publication cycle. No vibes-based months.
//
//  3. THE BAND WIDENS WITH DISTANCE, monotonically and without exception. A specific month
//     in 2038 is false precision, so the band grows one month per year of distance and the
//     UI degrades the DISPLAY from month to quarter to half-year to year accordingly. The
//     month field still carries early/mid/late-year information; the band states how much
//     of that information to trust.
//
//  4. THE SEVEN POST-SUPERINTELLIGENCE HORIZON ITEMS CARRY NO MONTH, EVER. They are
//     deliberately undated. Assigning a month to the Transcension or ruliad horizon would
//     be fabrication. The UI says so explicitly rather than rendering a blank.
//
//  5. MONTHS NEVER MOVE `prob`. A pace finding that genuinely warrants a probability change
//     goes through the existing anti-churn reassessment with revisedAt + changeNote,
//     separately and visibly.

/*
 * Band schedule. Distance is measured in whole years from the forecast's own base year.
 * The 2026 band of two months is already generous for a year that is more than half gone;
 * every later year adds one month, so the band is monotonically non-decreasing by
 * construction rather than by inspection.
 */
const BASE_YEAR = 2026;
const BASE_BAND = 2;

function bandForYear(year) {
  return BASE_BAND + Math.max(0, Number(year) - BASE_YEAR);
}

/*
 * Display precision derived from the band. A band of a quarter or more can no longer honestly
 * name a month, so the UI steps down instead of showing fake precision.
 */
function precisionForBand(band) {
  if (band <= 2) return 'month';
  if (band <= 4) return 'quarter';
  if (band <= 7) return 'half';
  return 'year';
}

/*
 * The estimates. Keyed by the same `<year>-<index>` prediction id used by the evidence
 * ledger, so a drift between this table and predictions.json is a hard validation failure
 * rather than a silent mismatch. `m` is 1-12. `basis` is the pace signal, stated plainly.
 */
const MONTH_ESTIMATES = {
  // ---- 2026 · band +/-2 · displayed as a month -------------------------------------
  '2026-0': { m: 6, basis: 'Measured agent task horizons have been doubling on a months-scale cadence, and the days-to-weeks monitored-operation and test-time-compute results that drove the July 2026 reassessment already place this threshold around mid-year.' },
  '2026-1': { m: 9, basis: 'Lab compute-allocation splits become visible through model-generation announcements and quarterly infrastructure disclosure, which cluster in the Q3 release window.' },
  '2026-2': { m: 3, basis: 'Private-round repricing and public-market capitalisation both reset on the Q1 funding and earnings cycle, when annual results and new raises land together.' },
  '2026-3': { m: 10, basis: 'Humanoid deployments follow annual manufacturing planning: line commitments are made for the next production year and unit counts are disclosed in the second half.' },
  '2026-4': { m: 8, basis: 'The EU AI Act phases its high-risk and general-purpose obligations in on August application dates, and US frontier release frameworks have tracked the same annual window.' },
  '2026-5': { m: 10, basis: 'Government preparedness work is funded on the US federal fiscal year that begins 1 October and on the equivalent European annual work-programme cycle.' },
  '2026-6': { m: 12, basis: "This is Peter's own stated end-of-2026 call, so the estimate is the deadline he set rather than an independent derivation from pace evidence." },
  '2026-7': { m: 5, basis: 'Intracortical BCI outcomes publish on six-to-twelve month peer-review lead times, and cumulative home-use hour counts are reported against trial anniversaries rather than continuously.' },
  '2026-8': { m: 12, basis: 'This is a through-year negative: it can only resolve when the annual operator disclosure window closes at year end, so no earlier month is meaningful.' },

  // ---- 2027 · band +/-3 · displayed as a quarter -----------------------------------
  '2027-0': { m: 6, basis: 'Paid-agent run-rates surface in mid-year lab revenue disclosures and Q2 cloud earnings, which is the first point a monthly figure can be evidenced rather than projected.' },
  '2027-1': { m: 9, basis: 'The share of code written end-to-end by AI is measured by annual developer-ecosystem surveys and repository telemetry, both published in the second half.' },
  '2027-2': { m: 6, basis: 'Tracks the frontier release cadence of roughly two to three major model generations per year; the mid-year generation is the one that would show acceleration without full automation.' },
  '2027-3': { m: 9, basis: 'Operational disruption is forced through enterprise budget and workforce planning cycles, which conclude in Q3 for the following year.' },
  '2027-4': { m: 9, basis: 'US omnibus legislation concentrates around the 30 September fiscal deadline and the end-of-session packages that follow it.' },
  '2027-5': { m: 7, basis: 'Grid stress is seasonal: interconnection-queue decisions and utility resource plans are tested against summer peak demand.' },

  // ---- 2028 · band +/-4 · displayed as a quarter -----------------------------------
  '2028-0': { m: 11, basis: 'The US general election falls in early November 2028 and issue salience peaks in the final campaign quarter.' },
  '2028-1': { m: 9, basis: 'Occupational mix is measured on annual labour-force surveys whose benchmark revisions publish in the second half.' },
  '2028-2': { m: 5, basis: 'Training-data, expert-interview and environment programmes are disclosed alongside spring model generations, which is when the profession-by-profession structure becomes legible.' },
  '2028-3': { m: 10, basis: 'Concentration becomes measurable around annual national planning cycles and the post-election consolidation of export, procurement and licensing control.' },
  '2028-4': { m: 2, basis: 'Hyperscaler capital-expenditure guidance is set in Q4 results each January and February, which is the point it can be compared against the enacted defense topline.' },
  '2028-5': { m: 9, basis: "Peter's ungoverned branch opens the 2028-2030 window; recursive self-improvement follows the automated-coding threshold rather than leading it, so the estimate sits late in the first year of the window." },
  '2028-6': { m: 11, basis: 'Multilateral AI negotiations attach to the autumn summit and General Assembly calendar rather than opening at arbitrary dates.' },
  '2028-7': { m: 6, basis: 'Connectome milestones publish on twelve-to-eighteen month peer-review cycles after acquisition, clustering in mid-year journal issues.' },

  // ---- 2029 · band +/-5 · displayed as a half-year ---------------------------------
  '2029-0': { m: 9, basis: 'A one-quarter cognitive-labour share is confirmed against annual productivity and labour-input statistics published in the second half.' },
  '2029-1': { m: 6, basis: 'Bilateral US-China strategic dialogues convene mid-year, between the spring and autumn summit rounds.' },
  '2029-2': { m: 9, basis: 'A negotiated pause lags the dialogue round that produces it by roughly a quarter, because the verification terms have to be agreed before training stops.' },
  '2029-3': { m: 10, basis: 'Verification hardware rides datacenter refresh and fiscal-year procurement cycles that begin in Q4.' },
  '2029-4': { m: 11, basis: 'Treaty frameworks gather signatories at year-end summits and General Assembly sessions.' },
  '2029-5': { m: 5, basis: 'Fiscal responses to an eroding labour-tax base are enacted in annual budgets, which cluster in Q1 and Q2 across major economies.' },
  '2029-6': { m: 3, basis: 'Policy-shock volatility clusters around legislative and rate-decision calendars; the estimate marks the first sustained episode rather than a single dated event.' },

  // ---- 2030 · band +/-6 · displayed as a half-year ---------------------------------
  '2030-0': { m: 6, basis: 'Framed as a by-2030 threshold, so the central estimate sits mid-year with the band spanning the whole year; full automation is certified against trailing research-throughput measurement, not announced.' },
  '2030-1': { m: 12, basis: 'The AI 2040 default branch places top-expert capability within roughly one year of automated coding, so this is set two quarters after the automation threshold above and inside the same band.' },
  '2030-2': { m: 6, basis: 'Resumption requires a verification regime to be standing, which follows treaty implementation timetables measured in years; mid-year is the first credible restart point after a 2029 pause.' },
  '2030-3': { m: 9, basis: 'Audit regimes phase in on statutory implementation dates that typically fall twelve to twenty-four months after adoption.' },
  '2030-4': { m: 6, basis: 'Major regulators run a ten-to-twelve month standard review clock after filing, so candidates entering review in the prior year clear approval around mid-year.' },
  '2030-5': { m: 9, basis: 'Reflects committed physical lead times already in the ground: three to six years for generation and grid, two to four for fabs and large plants.' },

  // ---- 2031 · band +/-7 · displayed as a half-year ---------------------------------
  '2031-0': { m: 6, basis: 'A speedup multiple is measured over a trailing research-output window, so it becomes legible around mid-year once a full comparison period has closed.' },
  '2031-1': { m: 9, basis: 'Cognitive and physical labour shares are both taken from annual labour-input and capital-services statistics published in the second half.' },
  '2031-2': { m: 2, basis: 'Annual revenue totals are confirmed in Q4 results reported each January and February, which is when a government-scale comparison can be made.' },
  '2031-3': { m: 8, basis: 'Safety-case mandates take effect on statutory application dates, which for frontier obligations have clustered in Q3.' },
  '2031-4': { m: 8, basis: 'Incident-driven rulemaking has run a twelve-to-eighteen month cycle from disclosure to mandatory control cases; repeated incidents shorten deliberation but not the statutory clock.' },
  '2031-5': { m: 10, basis: 'Post-deployment capability change is taken up in annual regulatory work programmes, which are set in Q4 for the following year.' },

  // ---- 2032 · band +/-8 · displayed as a year --------------------------------------
  '2032-0': { m: 9, basis: 'The crossing point is confirmed by annual national accounts and labour-input series published in the second half.' },
  '2032-1': { m: 9, basis: 'Robot installed-base and task-coverage statistics are compiled annually and published in the second half.' },
  '2032-2': { m: 12, basis: 'An annual real-GDP growth rate only resolves once the year closes; the outturn is confirmed in the following Q1.' },
  '2032-3': { m: 2, basis: 'Capital reallocation shows up in Q4 results and forward capex guidance each January and February.' },
  '2032-4': { m: 7, basis: 'Permit and auction regimes commence on statutory dates, normally at the start of a fiscal or compliance year.' },
  '2032-5': { m: 4, basis: 'Material tax-base changes are enacted in annual budgets, which cluster in Q1 and Q2.' },

  // ---- 2033 · band +/-9 · displayed as a year --------------------------------------
  '2033-0': { m: 9, basis: 'An output-share threshold is confirmed against annual national accounts published in the second half.' },
  '2033-1': { m: 4, basis: 'A recurring dividend starts at a fiscal-year boundary legislated in the preceding annual budget.' },
  '2033-2': { m: 10, basis: 'Distributional questions attach to the autumn multilateral finance and development meetings.' },
  '2033-3': { m: 8, basis: 'Influence rules have followed a twelve-to-eighteen month cycle from documented harm to statutory application.' },
  '2033-4': { m: 6, basis: 'Consumer interface transitions track annual platform product cycles, which land their major releases mid-year.' },
  '2033-5': { m: 12, basis: 'A doubling-time claim requires a full trailing year of output data, so it can only resolve at year end.' },
  '2033-6': { m: 10, basis: 'Biodefense programmes are funded on national fiscal years that begin in Q4.' },

  // ---- 2034 · band +/-10 · displayed as a year -------------------------------------
  '2034-0': { m: 9, basis: 'Tracks the two-to-three year semiconductor process-node cadence and the annual industry capability reporting that follows each node.' },
  '2034-1': { m: 6, basis: 'Fleet-scale figures accompany mid-year infrastructure and model announcements, where copy counts are disclosed alongside capacity.' },
  '2034-2': { m: 12, basis: 'Installed compute and delivered power are totalled on annual energy and semiconductor shipment statistics that close at year end.' },
  '2034-3': { m: 11, basis: 'Arms-control style compute provisions are adopted at year-end summit rounds.' },
  '2034-4': { m: 7, basis: 'Siting follows three-to-four year datacenter build lead times, so the jurisdictional shift is visible when facilities commissioned from earlier-decade commitments come online mid-year.' },
  '2034-5': { m: 11, basis: 'Arms-control instruments open for signature at year-end diplomatic conferences.' },

  // ---- 2035 · band +/-11 · displayed as a year -------------------------------------
  '2035-0': { m: 6, basis: 'Capability claims are certified against benchmark suites refreshed on annual evaluation cycles, with the mid-year refresh the first that could show full cross-field coverage.' },
  '2035-1': { m: 9, basis: 'A pause decision lags the capability certification it responds to by roughly two to three quarters of deliberation.' },
  '2035-2': { m: 9, basis: 'An 85% labour-share threshold is measured on annual labour-input statistics published in the second half.' },
  '2035-3': { m: 4, basis: 'Permanent transfer programmes commence at fiscal-year boundaries set in preceding budgets.' },
  '2035-4': { m: 8, basis: 'International controls follow documented capability by a twelve-to-eighteen month rulemaking and ratification cycle.' },
  '2035-5': { m: 10, basis: 'Legal-status and corporate-governance changes are adopted on annual reporting and legislative cycles that conclude in Q4.' },
  '2035-6': { m: 6, basis: 'Interpretability results publish on annual conference cycles whose acceptances land mid-year.' },

  // ---- 2036 · band +/-12 · displayed as a year -------------------------------------
  '2036-0': { m: 12, basis: 'Worker and robot installed-base totals close on annual statistics at year end.' },
  '2036-1': { m: 9, basis: 'Task-coverage estimates rest on annual occupational and task-level surveys published in the second half.' },
  '2036-2': { m: 9, basis: 'Employment-population ratios are reported monthly but only confirmed on the annual benchmark revisions published in the second half.' },
  '2036-3': { m: 12, basis: 'An annual growth rate resolves only once the year closes.' },
  '2036-4': { m: 6, basis: 'Relative-scarcity shifts are assessed on annual commodity, land and national accounts data, with the mid-year update the first full comparison.' },
  '2036-5': { m: 11, basis: 'Civic leverage becomes measurable around national election cycles concentrated in the final quarter.' },
  '2036-6': { m: 9, basis: 'Curriculum and institutional mandates change on academic-year boundaries that begin in Q3.' },

  // ---- 2037 · band +/-13 · displayed as a year -------------------------------------
  '2037-0': { m: 6, basis: 'Field-level acceleration is measured against annual publication, citation and replication statistics, so a multiple is only computable after a full comparison year.' },
  '2037-1': { m: 6, basis: 'Cures clear ten-to-twelve month regulatory review clocks; generation additions follow three-to-six year build lead times, and both resolve around mid-year.' },
  '2037-2': { m: 8, basis: 'Audit mandates take effect on statutory application dates that have clustered in Q3.' },
  '2037-3': { m: 6, basis: 'Evidentiary admissibility is decided on court review cycles measured in years, so the estimate marks the midpoint of the year rather than a hearing date.' },
  '2037-4': { m: 6, basis: 'This is a distributed process rather than a dated event; the estimate marks the midpoint of the year it is judged to be underway.' },
  '2037-5': { m: 10, basis: 'Verification protocols enter force on treaty implementation timetables agreed at year-end conferences.' },

  // ---- 2038 · band +/-14 · displayed as a year -------------------------------------
  '2038-0': { m: 6, basis: 'Field maturity is judged against annual conference and replication cycles, whose mid-year proceedings are the reference point.' },
  '2038-1': { m: 6, basis: 'Tracks annual interpretability benchmark and conference cycles.' },
  '2038-2': { m: 8, basis: 'Protocol standardisation follows standards-body work programmes with Q3 publication windows.' },
  '2038-3': { m: 4, basis: 'Pilot institutions commence at fiscal or judicial-year boundaries early in the calendar year.' },
  '2038-4': { m: 12, basis: 'Global spending totals close on annual statistics at year end.' },
  '2038-5': { m: 12, basis: 'A continuing pause is reaffirmed at annual review points that fall at year end.' },

  // ---- 2039 · band +/-15 · displayed as a year -------------------------------------
  '2039-0': { m: 6, basis: 'Institutional dependence is assessed on annual governance and procurement reporting, whose mid-year cut is the reference point.' },
  '2039-1': { m: 8, basis: 'Independent safety cases publish on annual external-review cycles concluding in Q3.' },
  '2039-2': { m: 9, basis: 'Delegating final authority requires statutory or charter change adopted on annual legislative cycles.' },
  '2039-3': { m: 4, basis: 'Transfer levels are set in annual budgets and commence at fiscal-year boundaries.' },
  '2039-4': { m: 6, basis: 'The milestone requires a 90-day continuous run, so disclosure trails the enabling launch by at least two quarters; launch cadence and radiator qualification set the pace, not compute supply.' },
  '2039-5': { m: 11, basis: 'Cap-revision talks open at year-end summit rounds.' },

  // ---- 2040 · band +/-16 · displayed as a year -------------------------------------
  '2040-0': { m: 12, basis: 'A full-coverage automation claim resolves against year-end annual statistics.' },
  '2040-1': { m: 6, basis: 'A lift decision follows the preceding year of cap-revision negotiation by roughly two quarters.' },
  '2040-2': { m: 9, basis: 'Assessed against annual critical-infrastructure dependency reviews published in the second half.' },
};

/*
 * Dependency ordering. A dependent milestone may never be scheduled before its
 * prerequisite. Comparison is on (year, month) and equality is permitted, because two
 * milestones can genuinely land in the same window; only a strict inversion is an error.
 * Each edge states why it exists so a future editor can challenge it rather than guess.
 */
const PREREQUISITES = [
  { after: '2030-1', before: '2030-0', why: 'top-expert capability is defined as following automated coding, not preceding it' },
  { after: '2031-0', before: '2030-0', why: 'a 10x research speedup presupposes the fully automated R&D loop that produces it' },
  { after: '2029-2', before: '2029-1', why: 'a negotiated pause requires the negotiations that agree it' },
  { after: '2030-2', before: '2029-2', why: 'research cannot resume before the pause that suspended it' },
  { after: '2029-1', before: '2028-6', why: 'serious bilateral negotiation follows the opening of international talks' },
  { after: '2035-1', before: '2035-0', why: 'a pause at top-expert level presupposes reaching top-expert level' },
  { after: '2038-5', before: '2035-1', why: 'a continuing pause presupposes the pause it continues' },
  { after: '2040-1', before: '2038-5', why: 'lifting the pause presupposes the pause still being in force' },
  { after: '2040-1', before: '2039-5', why: 'regulators lift caps after the negotiations to loosen them begin' },
  { after: '2031-3', before: '2026-4', why: 'public external safety cases build on standard frontier release review' },
  { after: '2029-3', before: '2026-5', why: 'deployed inference-only verification builds on government compute-tracking preparedness' },
  { after: '2039-4', before: '2026-8', why: 'megawatt-class orbital compute follows the demonstrator-scale phase' },
  { after: '2031-1', before: '2029-0', why: 'a one-third cognitive-labour share follows a one-quarter share' },
  { after: '2032-0', before: '2031-1', why: 'AI exceeding human cognitive labour follows a one-third share' },
  { after: '2033-0', before: '2032-0', why: 'half of economic output follows AI exceeding human cognitive labour' },
  { after: '2035-2', before: '2033-0', why: 'an 85% labour share follows half of economic output' },
  { after: '2036-1', before: '2035-2', why: '95% task coverage follows an 85% labour share' },
  { after: '2040-0', before: '2036-1', why: 'essentially all labour follows 95% task coverage' },
  { after: '2033-1', before: '2029-5', why: 'a launched dividend follows dividends becoming mainstream policy' },
  { after: '2035-3', before: '2033-1', why: 'a permanent institution follows the first recurring dividend' },
  { after: '2039-3', before: '2035-3', why: 'seven-figure transfers follow the permanent institution that pays them' },
  { after: '2032-5', before: '2029-5', why: 'shifting the tax base follows compute and robot rents entering the policy mainstream' },
  { after: '2036-2', before: '2035-2', why: 'employment falling below half follows an 85% AI-and-robot labour share' },
];

module.exports = {
  BASE_YEAR,
  BASE_BAND,
  MONTH_ESTIMATES,
  PREREQUISITES,
  bandForYear,
  precisionForBand,
};
