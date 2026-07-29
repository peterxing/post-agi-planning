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
const STALE_MINUTES = Math.max(5, Number(process.env.PAP_LOCK_STALE_MINUTES) || 90);
const POLL_MS = Math.max(200, Number(process.env.PAP_LOCK_POLL_MS) || 5000);
const EXIT_DEFERRED = 75;
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
    fs.writeFileSync(LOCK_FILE, JSON.stringify({ ...lock, heartbeatAt: nowIso() }, null, 2) + '\n');
  } catch {
    /* a heartbeat failure must never break the run it is protecting */
  }
}

function describe(lock) {
  if (!lock) return 'free';
  if (lock.corrupt) return 'corrupt';
  return `${lock.purpose || 'unknown'} owner=${lock.owner} mode=${lock.mode} since=${lock.startedAt}`;
}

function buildPayload({ owner, purpose, mode, pid, activity }) {
  return {
    owner,
    purpose,
    mode,
    pid: pid == null ? null : Number(pid),
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
  for (;;) {
    const existing = readLock();
    if (existing && !existing.corrupt && existing.owner === owner) {
      touchHeartbeat(existing);
      return { ok: true, state: 'inherited', lock: existing, reclaimed, waited };
    }
    if (existing) {
      const stale = staleReason(existing);
      if (stale) {
        reclaimed = `${describe(existing)} — ${stale}`;
        reclaim(reclaimed);
        continue;
      }
    } else if (writeLockExclusive(buildPayload({ owner, purpose, mode, pid, activity }))) {
      return { ok: true, state: 'acquired', lock: readLock(), reclaimed, waited };
    } else {
      continue; // lost a creation race; re-inspect
    }
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
    process.on('uncaughtException', error => {
      releaseImplicit();
      throw error;
    });
  }
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
  STALE_MINUTES,
  acquire,
  release,
  guard,
  readLock,
  staleReason,
  pidAlive,
};
