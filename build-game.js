'use strict';
if (require.main === module) require('./pipeline-lock').guard('build:game');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {sha,extractCanonical,buildProjection} = require('./game-source');
const ROOT = __dirname;

async function deriveGame() {
  const read = name => fs.readFileSync(path.join(ROOT,name),'utf8');
  const canonical = await extractCanonical(read('index.html'),read('app.js'));
  return buildProjection({canonical,predictions:JSON.parse(read('predictions.json')),
    author:JSON.parse(read('author.json')),mapping:JSON.parse(read('game-map.json')),
    core:await import('./game-core.mjs')});
}

function verifyVendor({write = false} = {}) {
  const policy = JSON.parse(fs.readFileSync(path.join(ROOT,'game-policy.json'),'utf8'));
  const moduleRoot = path.resolve(path.dirname(require.resolve('three')),'..');
  const packageInfo = JSON.parse(fs.readFileSync(path.join(moduleRoot,'package.json'),'utf8'));
  assert.equal(packageInfo.version,policy.vendor.version,'Three.js version changed.');
  for (const [name,pin] of Object.entries(policy.vendor.files)) {
    const original = fs.readFileSync(path.join(moduleRoot,pin.packagePath));
    assert.equal(original.length,pin.bytes,`Vendor size differs: ${name}`);
    assert.equal(sha(original),pin.sha256,`Vendor integrity differs: ${name}`);
    const destination = path.join(ROOT,name);
    if (write) {
      if (!fs.existsSync(destination)) fs.writeFileSync(destination,original,{flag:'wx'});
      else assert.equal(sha(fs.readFileSync(destination)),pin.sha256,`Refuse to overwrite modified vendor: ${name}`);
    } else assert.equal(sha(fs.readFileSync(destination)),pin.sha256,`Vendored bytes differ: ${name}`);
  }
  for (const name of policy.vendor.retiredBeforeFirstPublication)
    assert(!fs.existsSync(path.join(ROOT,name)),`Withdrawn renderer must not remain in the source/publish set: ${name}`);
}

async function main() {
  const write = process.argv.includes('--write');
  verifyVendor({write});
  const projection = await deriveGame();
  const output = JSON.stringify(projection,null,2)+'\n';
  const policy = JSON.parse(fs.readFileSync(path.join(ROOT,'game-policy.json'),'utf8'));
  assert(Buffer.byteLength(output) <= policy.byteCeilings['game-content.json'],'Generated game content exceeds the approved file budget.');
  const target = path.join(ROOT,'game-content.json');
  if (write) {
    if (!fs.existsSync(target) || fs.readFileSync(target,'utf8') !== output) {
      const temporary = path.join(ROOT,`game-content.${process.pid}.tmp`);
      try { fs.writeFileSync(temporary,output,{flag:'wx'}); fs.renameSync(temporary,target); }
      finally { if(fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    }
  } else assert.equal(fs.readFileSync(target,'utf8'),output,'Game projection is stale. Regenerate from current canonical sources.');
  console.log(`Game projection: ${projection.coverage.status}; ${projection.coverage.mapped}/${projection.coverage.forecasts} forecasts; `
    + `${projection.coverage.chapters} complete book entries; ${projection.coverage.sections} site sections; ${Buffer.byteLength(output)} bytes.`);
  if (projection.coverage.pending.length) console.log(JSON.stringify(projection.coverage.pending,null,2));
}

if (require.main === module) main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports = {deriveGame,verifyVendor};
