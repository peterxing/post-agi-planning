'use strict';

const { fork } = require('node:child_process');

class PdfReadError extends Error {}

function parseReferencePdf(bytes, { timeoutMs = 10000, maxPages = 128, maxTextBytes = 1024 * 1024, pages } = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length > 8 * 1024 * 1024
    || Buffer.from(bytes.subarray(0, 5)).toString('ascii') !== '%PDF-')
    return Promise.reject(new PdfReadError('Missing PDF signature or oversized PDF input.'));
  if (pages && (!Array.isArray(pages) || !pages.length || pages.length > 32
    || new Set(pages).size !== pages.length || !pages.every(n => Number.isInteger(n) && n >= 1 && n <= maxPages)))
    return Promise.reject(new PdfReadError('Invalid PDF page selection.'));
  return new Promise((resolve, reject) => {
    // A process also isolates native PDF-library faults, which a worker thread cannot contain.
    const worker = fork(__filename, [], {
      execArgv:['--max-old-space-size=160'], serialization:'advanced', silent:true,
    });
    worker.stdout.resume();
    worker.stderr.resume();
    let settled = false;
    const finish = (error, body) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const complete = () => error ? reject(error) : resolve(body);
      if (worker.exitCode !== null || worker.signalCode !== null) complete();
      else { worker.once('exit', complete); worker.kill(); }
    };
    const timer = setTimeout(() => finish(new PdfReadError('PDF text extraction timed out.')), timeoutMs);
    worker.once('message', result => finish(result.error ? new PdfReadError(result.error) : null, result.body));
    worker.once('error', error => finish(error));
    worker.once('exit', code => {
      if (!settled) finish(new Error(`PDF worker exited before returning text (${code}).`));
    });
    worker.send({ bytes, maxPages, maxTextBytes, pages });
  });
}

if (require.main === module) {
  if (!process.send) throw new Error('The internal PDF worker requires its parent IPC channel.');
  process.once('message', workerData => {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data:workerData.bytes, verbosity:0, isEvalSupported:false,
      useSystemFonts:false, useWorkerFetch:false });
    (async () => {
      try {
        const info = await parser.getInfo();
        if (!Number.isInteger(info.total) || info.total < 1 || info.total > workerData.maxPages)
          throw new PdfReadError(`PDF page limit exceeded (${info.total} pages; limit ${workerData.maxPages}).`);
        if (workerData.pages?.some(n => n > info.total)) throw new PdfReadError('Reviewed PDF page no longer exists.');
        const result = await parser.getText(workerData.pages ? { partial:workerData.pages } : undefined);
        if (!result.text || Buffer.byteLength(result.text, 'utf8') > workerData.maxTextBytes)
          throw new PdfReadError('PDF text is empty or exceeds the extracted-text limit.');
        process.send({ body:result.text });
      } catch (error) {
        if (error instanceof PdfReadError || ['InvalidPDFException', 'PasswordException', 'FormatError',
          'UnknownErrorException', 'ResponseException'].includes(error.name)) {
          process.send({ error:`PDF source refused: ${error.message}` });
        } else throw error;
      } finally { await parser.destroy(); }
    })().catch(error => { throw error; });
  });
}

module.exports = { parseReferencePdf, PdfReadError };
