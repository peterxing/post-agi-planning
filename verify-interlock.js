'use strict';
/**
 * verify-interlock.js — proves the pap-deploy concurrency interlock still holds.
 *
 * Two halves:
 *   STATIC    the lock file can never be served, deployed, staged or committed.
 *   BEHAVIOUR a second actor defers instead of proceeding; a stale, dead-PID or corrupt lock is
 *             reclaimed; a crashed holder never wedges the pipeline.
 *
 * Behavioural checks run against a throwaway lock path (PAP_LOCK_FILE) in the system temp
 * directory, so running this verifier never disturbs a live run's real lock.
 *
 * Usage: node verify-interlock.js [http://127.0.0.1:8787]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync, spawn } = require('child_process');

const DIR = __dirname;
const SITE = 'C:\\Users\\peterxing\\pap-site';
const LOCK_NAME = '.pipeline.lock';
const SANDBOX = path.join(os.tmpdir(), `pap-interlock-${process.pid}.lock`);
const problems = [];
const notes = [];

function check(condition, message) {
  if (!condition) problems.push(message);
}

function readOr(file, fallback = '') {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}

function runLock(args, env = {}) {
  return spawnSync(process.execPath, [path.join(DIR, 'pipeline-lock.js'), ...args], {
    cwd: DIR,
    encoding: 'utf8',
    env: { ...process.env, PAP_LOCK_FILE: SANDBOX, PAP_PIPELINE_OWNER: '', ...env },
  });
}

// ---------------------------------------------------------------- STATIC CONTRACT

const publish = readOr(path.join(DIR, 'publish-github.ps1'));
check(/\\\.pipeline\\\.lock/.test(publish) || publish.includes('.pipeline\\.lock'),
  'publish-github.ps1 forbidden pattern does not name .pipeline.lock');
check(!/'\.pipeline\.lock'/.test(publish),
  'publish-github.ps1 must never place .pipeline.lock on an allow-list');
check(publish.includes("'pipeline-lock.js'"),
  'publish-github.ps1 should mirror pipeline-lock.js as public source');

const deploy = readOr(path.join(SITE, 'deploy.ps1'));
check(deploy.includes('.pipeline.lock'), 'deploy.ps1 does not reject .pipeline.lock');
check(/\$runtimeFiles -contains '\.pipeline\.lock'/.test(deploy),
  'deploy.ps1 must assert .pipeline.lock is not a runtime file');
check(!/^\s*'\.pipeline\.lock',?\s*$/m.test(deploy),
  'deploy.ps1 must never list .pipeline.lock as a runtime file');

const vercelIgnore = readOr(path.join(SITE, '.vercelignore'));
check(vercelIgnore.split(/\r?\n/).map(l => l.trim()).includes(LOCK_NAME),
  '.vercelignore does not exclude .pipeline.lock');

const server = readOr(path.join(DIR, 'server.js'));
check(!server.includes(LOCK_NAME), 'server.js must not reference the lock file at all');
check(/ALLOW_EXT\s*=\s*new Set\(\[(?![^\]]*\.lock)/.test(server),
  'server.js ALLOW_EXT must not permit .lock');

check(!fs.existsSync(path.join(SITE, LOCK_NAME)),
  'a .pipeline.lock is present in the production bundle directory');

// Every guarded entry point must claim the tree before it reads protected files.
const guarded = [
  'refresh-signals.js', 'x-archive.js', 'validate-predictions.js', 'verify-site.js',
  'verify-signal-matcher.js', 'verify-perpred.js', 'verify-reality.js', 'verify-author.js',
  'verify-observatory.js', 'verify-performance.js', 'verify-direct-coverage.js',
  'verify-archive-corpus.js', 'verify-external-evidence.js', 'verify-peter-evidence.js',
  'review-evidence-candidates.js',
];
const PROTECTED = ['predictions.json', 'signals.json', 'evidence-approvals.json', 'evidence-floors.json'];
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

for (const file of guarded) {
  const text = readOr(path.join(DIR, file));
  const guardAt = text.indexOf("require('./pipeline-lock').guard(");
  if (guardAt < 0) {
    problems.push(`${file} does not acquire the interlock`);
    continue;
  }
  const firstRequire = text.search(/^\s*(?:const|let|var)\s.*=\s*require\(/m);
  if (firstRequire >= 0 && guardAt > firstRequire) {
    problems.push(`${file} acquires the interlock after loading other modules`);
  }
  // Only real code counts: header comments naming a data file are not reads of it.
  const beforeGuard = stripComments(text.slice(0, guardAt));
  for (const protectedFile of PROTECTED) {
    if (new RegExp(`['"\`]${protectedFile.replace('.', '\\.')}['"\`]`).test(beforeGuard)) {
      problems.push(`${file} references ${protectedFile} in code before acquiring the interlock`);
    }
  }
}

// ---------------------------------------------------------------- BEHAVIOUR

function clearSandbox() {
  try {
    fs.unlinkSync(SANDBOX);
  } catch {
    /* already gone */
  }
}

clearSandbox();

// 1. A second live actor must defer, not proceed.
let result = runLock(['acquire', '--owner=holder-a', '--purpose=scheduled-forecast']);
check(result.status === 0, `sandbox acquire failed: ${result.stderr || result.stdout}`);
result = runLock(['acquire', '--owner=holder-b', '--purpose=scheduled-author']);
check(result.status === 75, `a second actor must exit 75 DEFERRED, got ${result.status}`);
check(/DEFERRED/.test(result.stderr || ''), 'deferral must say DEFERRED plainly');
check(/missed run/i.test(result.stderr || ''), 'deferral must tell the next run to treat it as a missed run');

// 2. The owner inherits its own lock rather than deadlocking on it.
result = runLock(['acquire', '--owner=holder-a', '--purpose=scheduled-forecast']);
check(result.status === 0 && /inherited/.test(result.stdout || ''),
  'an actor must inherit its own live lock');

// 3. A live lock is never force-broken by a non-owner.
result = runLock(['release', '--owner=holder-b']);
check(result.status !== 0, 'a non-owner must not be able to release a live lock');
runLock(['release', '--owner=holder-a']);
check(!fs.existsSync(SANDBOX), 'release must remove the lock');

// 4. Stale-by-age locks are reclaimed loudly.
const stale = new Date(Date.now() - 100 * 60000).toISOString();
fs.writeFileSync(SANDBOX, JSON.stringify({
  owner: 'ghost', purpose: 'scheduled-forecast', mode: 'session', pid: null,
  startedAt: stale, heartbeatAt: stale,
}));
result = runLock(['acquire', '--owner=fresh', '--purpose=interactive']);
check(result.status === 0, 'a lock past the age ceiling must be reclaimable');
check(/reclaimed stale lock/i.test(`${result.stdout}${result.stderr}`),
  'stale reclamation must be reported loudly');
runLock(['release', '--owner=fresh']);

// 5. Dead-PID and corrupt locks are reclaimed.
fs.writeFileSync(SANDBOX, JSON.stringify({
  owner: 'pid:999997@x', purpose: 'manual', mode: 'process', pid: 999997,
  startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(),
}));
result = runLock(['acquire', '--owner=fresh2', '--purpose=interactive']);
check(result.status === 0 && /not alive/.test(`${result.stdout}${result.stderr}`),
  'a lock whose holder pid is dead must be reclaimed');
runLock(['release', '--owner=fresh2']);

fs.writeFileSync(SANDBOX, 'not json');
result = runLock(['acquire', '--owner=fresh3', '--purpose=interactive']);
check(result.status === 0, 'a corrupt lock must be reclaimable');
runLock(['release', '--owner=fresh3']);

// 6. Normal exit releases automatically.
result = spawnSync(process.execPath, ['-e', "require('./pipeline-lock').guard('selftest')"], {
  cwd: DIR, encoding: 'utf8', env: { ...process.env, PAP_LOCK_FILE: SANDBOX, PAP_PIPELINE_OWNER: '' },
});
check(result.status === 0, 'an unguarded tool must acquire when the tree is free');
check(!fs.existsSync(SANDBOX), 'a normal exit must release the implicit lock');

// 7. A crashed holder must not wedge the pipeline.
(async () => {
  const holder = spawn(process.execPath,
    ['-e', "require('./pipeline-lock').guard('crashtest'); setInterval(() => {}, 1000);"],
    { cwd: DIR, env: { ...process.env, PAP_LOCK_FILE: SANDBOX, PAP_PIPELINE_OWNER: '' }, stdio: 'ignore' });
  await new Promise(resolve => setTimeout(resolve, 1500));
  const held = fs.existsSync(SANDBOX);
  check(held, 'a running holder must own the lock');
  holder.kill('SIGKILL');
  await new Promise(resolve => setTimeout(resolve, 1200));
  check(fs.existsSync(SANDBOX), 'a hard-killed holder leaves the lock behind (expected)');
  const after = runLock(['acquire', '--owner=after-crash', '--purpose=scheduled-forecast']);
  check(after.status === 0, 'the next actor must reclaim a crashed holder cleanly');
  check(/not alive/.test(`${after.stdout}${after.stderr}`), 'crash reclamation must name the dead holder');
  runLock(['release', '--owner=after-crash']);
  clearSandbox();
  notes.push('crash release: hard-killed holder reclaimed by the next actor');

  // 7b. A crashed SESSION run must not wedge the tree for the whole stale ceiling.
  // A scheduled run acquires a session lock and then dies without releasing. Its heartbeat stops,
  // but nothing can prove the holder is gone, so every later run defers until the 90 minute ceiling
  // expires. That is the stall this guards against: a dead acquiring shell plus an idle lock must be
  // reclaimed after the much shorter orphan grace, while a FRESH lock is still strictly respected.
  const orphanEnv = { PAP_LOCK_ORPHAN_MINUTES: '2' };
  const sessionOrphan = {
    owner: 'scheduled-forecast-crashed', purpose: 'scheduled-forecast', mode: 'session',
    pid: null, supervisorPid: 999996, activity: null, host: os.hostname(),
    startedAt: new Date(Date.now() - 30 * 60000).toISOString(),
    heartbeatAt: new Date(Date.now() - 30 * 60000).toISOString(),
  };
  fs.writeFileSync(SANDBOX, JSON.stringify(sessionOrphan));
  result = runLock(['acquire', '--owner=after-session-crash', '--purpose=scheduled-forecast'], orphanEnv);
  check(result.status === 0, 'a crashed session run must not wedge the tree until the stale ceiling');
  check(/reclaimed stale lock/i.test(`${result.stdout}${result.stderr}`),
    'session orphan reclamation must be reported loudly');
  clearSandbox();

  // The same orphan rule must NOT steal a lock that is still being heartbeated by a live run.
  fs.writeFileSync(SANDBOX, JSON.stringify({
    ...sessionOrphan, owner: 'scheduled-forecast-live',
    startedAt: new Date(Date.now() - 30 * 60000).toISOString(),
    heartbeatAt: new Date().toISOString(),
  }));
  result = runLock(['acquire', '--owner=other-actor', '--purpose=scheduled-forecast'], orphanEnv);
  check(result.status === 75, 'a heartbeating session holder must still defer other actors, not be reclaimed');
  clearSandbox();
  notes.push('session orphan: crashed run reclaimed after the orphan grace, live run still respected');

  // 8. The live server must refuse the lock file.
  const base = process.argv[2];
  if (base) {
    const status = await new Promise(resolve => {
      http.get(`${base}/${LOCK_NAME}`, response => {
        response.resume();
        resolve(response.statusCode);
      }).on('error', () => resolve(null));
    });
    if (status == null) notes.push('server not reachable; skipped the live no-serve check');
    else {
      check(status === 403 || status === 404, `the server must refuse ${LOCK_NAME}, got HTTP ${status}`);
      notes.push(`server refuses /${LOCK_NAME} with HTTP ${status}`);
    }
  }

  finish();
})();

function finish() {
  clearSandbox();
  if (fs.existsSync(path.join(SITE, LOCK_NAME))) {
    problems.push('a .pipeline.lock leaked into the production bundle during this run');
  }
  for (const note of notes) console.log(`- ${note}`);
  if (problems.length) {
    console.error(`RESULT: FAIL — ${problems.length} interlock problem(s):`);
    for (const problem of problems) console.error(`  · ${problem}`);
    process.exit(1);
  }
  console.log(`Guarded entry points: ${guarded.length}; deferral exit code 75; stale ceiling 90 minutes.`);
  console.log('RESULT: PASS — the tree interlock defers concurrent actors, reclaims stale/dead/corrupt locks, survives a crashed holder, and is never served, deployed or committed.');
}
