'use strict';
/**
 * Advisory concurrency interlock for the C:\Users\peterxing\pap-deploy working tree.
 *
 * WHY: scheduled runs (forecast, author) and interactive sessions all read and rewrite the same
 * evidence files. Two actors in the tree at once can make a guard verify a half-applied state, or
 * make one actor's refresh overwrite another's edit. On 2026-07-29 an interactive edit landed at
 * 04:51-04:52Z while the scheduled author guard was still running; nothing broke, but the exposure
 * is real. This lock makes that impossible rather than lucky.
 *
 * PROTECTED FILES: predictions.json, signals.json, evidence-approvals.json, evidence-floors.json and
 * every runtime file. Acquire BEFORE the first read, not just before a write — reading a
 * half-applied tree is exactly the failure being prevented.
 *
 * TWO LOCK MODES
 *   session  Held across many short-lived commands by one actor (a scheduled run or an interactive
 *            session). Created by `acquire`, dropped by `release`. Liveness is heartbeat-based
 *            because the acquiring process exits immediately; every guarded tool refreshes the
 *            heartbeat while the lock is theirs.
 *   process  Created implicitly by a single guarded tool when no session lock exists, and released
 *            when that process exits (including on crash/signal). Liveness is PID-based.
 *
 * OWNERSHIP: an actor identifies itself with PAP_PIPELINE_OWNER. A guarded tool proceeds when the
 * live lock is its own, reclaims a stale lock loudly, and otherwise exits DEFERRED (75) without
 * reading or writing anything.
 *
 * EXIT CODES: 0 acquired/released/free · 75 DEFERRED (held by another live actor) · 1 usage error.
 * DEFERRED is not a failure. It means "published nothing, changed nothing" and the next scheduled
 * run must therefore treat it as a missed run and proceed as a CATCH-UP.
 *
 * CLI
 *   node pipeline-lock.js acquire --owner=ID --purpose=scheduled-forecast|scheduled-author|interactive [--wait=600] [--pid=N]
 *   node pipeline-lock.js release --owner=ID
 *   node pipeline-lock.js status [--json]
 *   node pipeline-lock.js heartbeat --owner=ID
 *
 * The lock file is local coordination state only. It is never served, deployed, staged or committed.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const LOCK_FILE = process.env.PAP_LOCK_FILE
  ? path.resolve(process.env.PAP_LOCK_FILE)
  : path.join(__dirname, '.pipeline.lock');
const LOCK_BASENAME = '.pipeline.lock';
/**
 * These three constants are the only thing standing between a live run and a false reclaim, so an
 * environment variable may make each one SAFER but never weaker — the same monotonic rule
 * evidence-floors.json applies to the coverage gates. Before this, `PAP_LOCK_ORPHAN_MINUTES=2` was
 * accepted and silently cut the orphan grace to below the measured silence between heartbeats,
 * which would have made false reclaims of healthy runs routine rather than hypothetical. A gate
 * that prose forbids but code permits is not a gate.
 */
const STALE_FLOOR_MINUTES = 90;
const ORPHAN_FLOOR_MINUTES = 30;
const HEARTBEAT_CEILING_MS = 60000;
const STALE_MINUTES = Math.max(STALE_FLOOR_MINUTES, Number(process.env.PAP_LOCK_STALE_MINUTES) || 0);
/**
 * A session lock records the pid of the shell that acquired it. That supervisor is only a hint —
 * in fresh-shell-per-command environments it exits within seconds even though the run continues —
 * so a dead supervisor alone never reclaims a lock. It reclaims only once the lock has ALSO been
 * idle past this grace.
 *
 * Read the heartbeat honestly. It advances when a guarded tool ENTERS, and then every HEARTBEAT_MS
 * only for as long as that tool's own process stays alive. Nothing beats BETWEEN guarded tools, so
 * a perfectly healthy run falls silent for however long it spends thinking, fetching, or running
 * unguarded work. Measured on live runs on 2026-08-11: bursts of beats 16-22 seconds apart while
 * tools ran back to back (faster than this timer can fire, because each beat is a fresh tool
 * entry), separated by silences of 5.4 minutes on the scheduled run and 11.3 minutes under an
 * independent monitor. HEARTBEAT AGE IS THEREFORE AN ACTIVITY SIGNAL, NOT A LIVENESS SIGNAL, and
 * this grace is sized against the worst observed silence — not against HEARTBEAT_MS.
 *
 * The grace is deliberately generous because the two failure modes are not symmetric. Waiting too
 * long merely delays a deferral. Reclaiming too early declares a LIVE run dead, and the reclaim
 * path then instructs the next run to treat that interrupted work as a missed run, corrupting run
 * continuity rather than just being noisy. Without the rule at all, a run that dies mid-flight
 * (agent crash, app restart, reboot, cancelled task) wedges the tree for the full STALE_MINUTES
 * ceiling while every scheduled run in that window burns its --wait and then defers.
 */
const ORPHAN_MINUTES = Math.max(ORPHAN_FLOOR_MINUTES, Number(process.env.PAP_LOCK_ORPHAN_MINUTES) || 0);
const HEARTBEAT_MS = Math.max(5000, Math.min(HEARTBEAT_CEILING_MS, Number(process.env.PAP_LOCK_HEARTBEAT_MS) || HEARTBEAT_CEILING_MS));
const POLL_MS = Math.max(200, Number(process.env.PAP_LOCK_POLL_MS) || 5000);
const EXIT_DEFERRED = 75;
// An instrument fault: the tool crashed rather than reaching a verdict. Distinct from DEFERRED (75),
// which means "nothing was wrong, try later", and from 1, which asserts a real evidence fault. These
// three demand different remedies — wait, fix the instrument, audit the evidence — so they must not
// share a code. 76 is verify-currency.js's existing EXIT_INSTRUMENT and is unused by every other
// guarded tool, so adopting it here unifies the vocabulary without redefining any current code.
const EXIT_INSTRUMENT = 76;
const PURPOSES = new Set(['scheduled-forecast', 'scheduled-author', 'interactive', 'manual']);

function nowIso() {
  return new Date().toISOString();
}

function ageMinutes(iso) {
  const then = Date.parse(iso || '');
  if (!Number.isFinite(then)) return Infinity;
  return (Date.now() - then) / 60000;
}

function pidAlive(pid) {
  const numeric = Number(pid);
  if (!Number.isInteger(numeric) || numeric <= 0) return false;
  try {
    process.kill(numeric, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user — still alive.
    return error.code === 'EPERM';
  }
}

function readLock() {
  try {
    const raw = fs.readFileSync(LOCK_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { corrupt: true };
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return { corrupt: true };
  }
}

/** Returns a reason string when the recorded holder is gone, otherwise null. */
function staleReason(lock) {
  if (!lock) return null;
  if (lock.corrupt) return 'lock file is unreadable or corrupt';
  const age = ageMinutes(lock.heartbeatAt || lock.startedAt);
  if (!Number.isFinite(age)) return 'lock file has no usable timestamp';
  if (age > STALE_MINUTES) return `lock is ${age.toFixed(1)} minutes old, beyond the ${STALE_MINUTES} minute ceiling`;
  if (lock.mode === 'process' && !pidAlive(lock.pid)) return `holder pid ${lock.pid} is not alive`;
  if (lock.mode === 'session' && lock.pid && !pidAlive(lock.pid)) return `supervising pid ${lock.pid} is not alive`;
  if (lock.mode === 'session' && lock.supervisorPid && !pidAlive(lock.supervisorPid) && age > ORPHAN_MINUTES) {
    return `acquiring shell pid ${lock.supervisorPid} is gone and the lock has been idle ${age.toFixed(1)} minutes, beyond the ${ORPHAN_MINUTES} minute orphan grace`;
  }
  return null;
}

function writeLockExclusive(payload) {
  let fd;
  try {
    fd = fs.openSync(LOCK_FILE, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
  try {
    fs.writeSync(fd, JSON.stringify(payload, null, 2) + '\n');
  } finally {
    fs.closeSync(fd);
  }
  return true;
}

function reclaim(reason) {
  console.error(`[pipeline-lock] RECLAIMED STALE LOCK — ${reason}. Previous holder's work was not completed; treat the interrupted run as a missed run.`);
  try {
    fs.unlinkSync(LOCK_FILE);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function touchHeartbeat(lock) {
  try {
    // Re-read before writing: a heartbeat must never resurrect a lock that has already been
    // released, and must never overwrite a lock that now belongs to somebody else.
    const current = readLock();
    if (!current || current.corrupt || current.owner !== lock.owner) return false;
    fs.writeFileSync(LOCK_FILE, JSON.stringify({ ...current, heartbeatAt: nowIso() }, null, 2) + '\n');
    return true;
  } catch {
    /* a heartbeat failure must never break the run it is protecting */
    return false;
  }
}

function describe(lock) {
  if (!lock) return 'free';
  if (lock.corrupt) return 'corrupt';
  return `${lock.purpose || 'unknown'} owner=${lock.owner} mode=${lock.mode} since=${lock.startedAt}`;
}

function buildPayload({ owner, purpose, mode, pid, activity }) {
  // The acquiring process itself exits immediately, so its own pid is useless as a liveness token.
  // Its parent — the shell driving the run — is a useful hint, recorded separately from the
  // authoritative `pid` field and only ever acted on together with the orphan idle grace.
  const supervisorPid = mode === 'session' && Number.isInteger(process.ppid) && process.ppid > 1 && pidAlive(process.ppid)
    ? process.ppid
    : null;
  return {
    owner,
    purpose,
    mode,
    pid: pid == null ? null : Number(pid),
    supervisorPid,
    activity: activity || null,
    host: os.hostname(),
    startedAt: nowIso(),
    heartbeatAt: nowIso(),
    note: 'Advisory interlock for the pap-deploy tree. Never served, deployed, staged or committed.',
  };
}

/**
 * Blocking acquisition with bounded backoff. Resolves to a result object rather than throwing so
 * callers can distinguish DEFERRED from a genuine error.
 */
function acquire({ owner, purpose, mode = 'session', waitSeconds = 0, pid = null, activity = null }) {
  if (!owner) throw new Error('pipeline-lock: owner is required');
  if (!PURPOSES.has(purpose)) throw new Error(`pipeline-lock: purpose must be one of ${[...PURPOSES].join(', ')}`);
  const deadline = Date.now() + Math.max(0, waitSeconds) * 1000;
  let reclaimed = null;
  let waited = false;
  // Reclaim/race retries used to `continue` past both the deadline check and the sleep below, so a
  // lock file that kept reappearing could spin this loop hot forever and never defer. Every
  // iteration is now bounded: unproductive retries fall through to the same deadline check.
  let spins = 0;
  for (;;) {
    const existing = readLock();
    let retryImmediately = false;
    if (existing && !existing.corrupt && existing.owner === owner) {
      touchHeartbeat(existing);
      return { ok: true, state: 'inherited', lock: existing, reclaimed, waited };
    }
    if (existing) {
      const stale = staleReason(existing);
      if (stale) {
        reclaimed = `${describe(existing)} — ${stale}`;
        reclaim(reclaimed);
        retryImmediately = true;
      }
    } else if (writeLockExclusive(buildPayload({ owner, purpose, mode, pid, activity }))) {
      return { ok: true, state: 'acquired', lock: readLock(), reclaimed, waited };
    } else {
      retryImmediately = true; // lost a creation race; re-inspect
    }
    // A handful of immediate retries is normal contention. Beyond that, treat it as a livelock and
    // fall through to the bounded wait so this can never become an unkillable busy loop.
    if (retryImmediately && ++spins <= 8) continue;
    if (Date.now() >= deadline) {
      return { ok: false, state: 'deferred', lock: existing, reclaimed, waited };
    }
    waited = true;
    const remaining = Math.max(0, deadline - Date.now());
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(POLL_MS, remaining));
  }
}

function release({ owner }) {
  const existing = readLock();
  if (!existing) return { ok: true, state: 'already-free' };
  if (existing.corrupt) {
    reclaim('lock file is unreadable or corrupt');
    return { ok: true, state: 'reclaimed-corrupt' };
  }
  if (existing.owner !== owner) {
    return { ok: false, state: 'not-owner', lock: existing };
  }
  fs.unlinkSync(LOCK_FILE);
  return { ok: true, state: 'released', lock: existing };
}

let implicitOwner = null;
function releaseImplicit() {
  if (!implicitOwner) return;
  const owner = implicitOwner;
  implicitOwner = null;
  try {
    const existing = readLock();
    if (existing && !existing.corrupt && existing.owner === owner) fs.unlinkSync(LOCK_FILE);
  } catch {
    /* best effort on the way out */
  }
}

/**
 * Entry-point guard. Call once at the top of a tool's main path, BEFORE reading protected files.
 * Inherits the caller's session lock, reclaims a stale lock, or exits DEFERRED (75).
 */
function guard(activity, { purpose = null, waitSeconds = null } = {}) {
  const sessionOwner = process.env.PAP_PIPELINE_OWNER || null;
  const wait = waitSeconds == null ? Number(process.env.PAP_LOCK_WAIT_SECONDS) || 0 : waitSeconds;
  const owner = sessionOwner || `pid:${process.pid}@${os.hostname()}`;
  const resolvedPurpose = purpose || process.env.PAP_PIPELINE_PURPOSE || (sessionOwner ? 'interactive' : 'manual');
  const result = acquire({
    owner,
    purpose: PURPOSES.has(resolvedPurpose) ? resolvedPurpose : 'manual',
    mode: sessionOwner ? 'session' : 'process',
    waitSeconds: wait,
    pid: sessionOwner ? null : process.pid,
    activity,
  });
  if (!result.ok) {
    console.error(`[pipeline-lock] DEFERRED — ${activity} did not run. The pap-deploy tree is held by ${describe(result.lock)}.`);
    console.error('[pipeline-lock] Nothing was read or written. A deferred run publishes nothing and changes nothing; the next run must treat it as a missed run and proceed as a CATCH-UP.');
    process.exit(EXIT_DEFERRED);
  }
  if (result.reclaimed) {
    console.error(`[pipeline-lock] Continuing after reclaiming a stale lock: ${result.reclaimed}`);
  }
  // Keep proving this run is alive while THIS TOOL works. A single guarded tool can run for many
  // minutes (archive hydration, the verifier suite, deploy), and without this the lock would look
  // idle even though the tool is healthy. It cannot cover the gaps BETWEEN guarded tools, because
  // this timer dies with the process that owns it — which is why ORPHAN_MINUTES is sized against
  // observed inter-tool silence rather than against HEARTBEAT_MS. unref'd so it can never hold the
  // process open — the point of this is to remove hangs, not add one.
  const beat = setInterval(() => touchHeartbeat({ owner }), HEARTBEAT_MS);
  if (typeof beat.unref === 'function') beat.unref();
  if (result.state === 'acquired' && !sessionOwner) {
    implicitOwner = owner;
    // Children inherit the owner, so nested tools reuse this lock instead of deferring on it.
    process.env.PAP_PIPELINE_OWNER = owner;
    process.on('exit', releaseImplicit);
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
      process.on(signal, () => {
        releaseImplicit();
        process.exit(130);
      });
    }
  }
  // A crash OUTSIDE a tool's own main() handler is an instrument fault, and it must report the same
  // way whether or not this process happens to own the lock. Before this was hoisted out of the
  // owner-only block above, one fault produced two undeclared codes: an owner re-threw from inside
  // this handler, which makes node exit 7, while an inheritor fell through to node's default and
  // exited 1 — the EVIDENCE code, indistinguishable at the exit status from a real evidence fault.
  // Lock ownership is unrelated to the fault, so it must not choose the code or the remedy.
  // releaseImplicit is idempotent and owner-matched, so this is a no-op for an inheriting process:
  // a tool must never release a lock its parent holds.
  const reportInstrumentFault = (error, kind) => {
    releaseImplicit();
    try {
      console.error('');
      console.error(`[pipeline-lock] INSTRUMENT FAULT — ${activity} threw ${kind} and could not`);
      console.error('[pipeline-lock] complete. This is NOT an evidence fault and NOT a deferral:');
      console.error('[pipeline-lock] the run measured nothing, so DISCARD EVERY FIGURE IT PRINTED,');
      console.error('[pipeline-lock] including any that look right. Fix the instrument and re-run.');
      console.error(error && error.stack ? error.stack : String(error));
    } catch {
      /* reporting must never mask the fault it is reporting */
    }
    process.exit(EXIT_INSTRUMENT);
  };
  process.on('uncaughtException', error => reportInstrumentFault(error, 'an uncaught exception'));
  process.on('unhandledRejection', error => reportInstrumentFault(error, 'an unhandled rejection'));
  return result;
}

function argValue(name) {
  const hit = process.argv.find(argument => argument.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function main() {
  const command = process.argv[2];
  const owner = argValue('owner') || process.env.PAP_PIPELINE_OWNER;
  if (command === 'status') {
    const lock = readLock();
    const stale = staleReason(lock);
    const payload = {
      state: !lock ? 'free' : stale ? 'stale' : 'held',
      staleReason: stale,
      staleMinutes: STALE_MINUTES,
      lock: lock || null,
    };
    if (process.argv.includes('--json')) console.log(JSON.stringify(payload, null, 2));
    else console.log(`${payload.state}: ${describe(lock)}${stale ? ` (${stale})` : ''}`);
    return;
  }
  if (command === 'acquire') {
    const result = acquire({
      owner,
      purpose: argValue('purpose') || 'manual',
      mode: 'session',
      waitSeconds: Number(argValue('wait')) || 0,
      pid: argValue('pid'),
      activity: argValue('activity'),
    });
    if (!result.ok) {
      console.error(`DEFERRED: pap-deploy is held by ${describe(result.lock)}. Nothing was read or written; treat this run as a missed run.`);
      process.exit(EXIT_DEFERRED);
    }
    console.log(`${result.state}: owner=${owner} purpose=${result.lock.purpose}${result.reclaimed ? ` (reclaimed stale lock: ${result.reclaimed})` : ''}`);
    return;
  }
  if (command === 'release') {
    const result = release({ owner });
    if (!result.ok) {
      console.error(`refused: lock is held by ${describe(result.lock)}, not ${owner}. A live lock is never force-broken.`);
      process.exit(1);
    }
    console.log(result.state);
    return;
  }
  if (command === 'heartbeat') {
    const lock = readLock();
    if (!lock || lock.corrupt || lock.owner !== owner) {
      console.error('refused: no live lock owned by this actor.');
      process.exit(1);
    }
    touchHeartbeat(lock);
    console.log('heartbeat');
    return;
  }
  console.error('usage: node pipeline-lock.js acquire|release|status|heartbeat [--owner=ID] [--purpose=P] [--wait=SECONDS] [--pid=N] [--json]');
  process.exit(1);
}

if (require.main === module) main();

module.exports = {
  LOCK_FILE,
  LOCK_BASENAME,
  EXIT_DEFERRED,
  EXIT_INSTRUMENT,
  STALE_MINUTES,
  ORPHAN_MINUTES,
  HEARTBEAT_MS,
  acquire,
  release,
  guard,
  readLock,
  staleReason,
  pidAlive,
};
