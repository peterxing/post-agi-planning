'use strict';
if (require.main === module) require('./pipeline-lock').guard('refresh-reference-points');

const fs = require('fs');
const path = require('path');
const { buildReferencePoints, refreshSource, openReferenceBrowser, validatePublishedReferences, atomicWrite, sha } = require('./reference-points');

async function main() {
  const file = path.join(__dirname, 'signals.json');
  const predictions = JSON.parse(fs.readFileSync(path.join(__dirname, 'predictions.json'), 'utf8'));
  const ledger = JSON.parse(fs.readFileSync(path.join(__dirname, 'reference-ledger.json'), 'utf8'));
  const bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
  let previous = bundle.referencePoints;
  const receipt = process.argv.find(arg => arg.startsWith('--receipts='));
  if (receipt) {
    if (previous) throw new Error('Bootstrap receipts cannot replace an existing published reference layer.');
    previous = JSON.parse(fs.readFileSync(path.resolve(receipt.slice('--receipts='.length)), 'utf8'));
    validatePublishedReferences(previous, predictions, { requireComplete:true });
    if (previous.ledgerSha256 !== sha(JSON.stringify(ledger)))
      throw new Error('Bootstrap receipts do not match the exact reviewed ledger.');
  }
  const layer = buildReferencePoints(ledger, predictions, previous);
  if (process.argv.includes('--refresh')) {
    let browser;
    try {
      for (const [id, source] of Object.entries(layer.sources)) {
        if (source.transport === 'browser' && !browser) browser = await openReferenceBrowser();
        layer.sources[id] = await refreshSource(source, ledger.mappings.filter(row => row.sourceId === id),
          { browserTransport:browser?.read });
        console.log(`${id}: ${layer.sources[id].health.status} ${layer.sources[id].health.error || ''}`);
      }
    } finally { if (browser) await browser.close(); }
    layer.updatedAt = new Date().toISOString();
  }
  validatePublishedReferences(layer, predictions);
  if (bundle.forecastVersion?.sha256 !== layer.forecastSha256) throw new Error('Forecast/bundle mismatch; no reference update written.');
  atomicWrite(file, { ...bundle, referencePoints:layer });
  console.log(`References: ${layer.coverage.mapped}/${layer.coverage.total} mapped; ${layer.coverage.sources} canonical sources; ${layer.coverage.gaps} gaps.`);
  const unverified = Object.entries(layer.sources).filter(([, s]) => !s.health.lastVerifiedAt
    || s.health.reviewSha256 !== s.reviewSha256).map(([id]) => id);
  if (unverified.length || layer.coverage.gaps || layer.orphans.length) {
    console.error(`Reference review incomplete. Never-verified sources: ${unverified.join(', ')}; gaps: ${Object.keys(layer.gaps).join(', ')}; orphans: ${layer.orphans.join(', ')}`);
    process.exitCode = 2;
  } else if (Object.values(layer.sources).some(s => s.health.status !== 'verified')) {
    console.log('Last-good references retained with explicit source warnings. No source freshness or forecast success is inferred.');
  }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
