// Routing Middleware: peterxing.com opens on The Singularity Daily at the bare domain.
//
// Only the document root runs through here (`config.matcher`). It is rewritten, without changing the address, to the
// Daily's site on GitHub Pages (repo peterxing/singularity-daily); the page loads its files from /daily/*, which
// vercel.json proxies to the same site, and `/daily` stays as an alias. Everything else is served exactly as before,
// including the unchanged Guide at /guide. Deleting this file puts the Guide back at "/".
export const config = { matcher: ['/'] };

const DAILY = 'https://peterxing.github.io/singularity-daily/';

export default function middleware(): Response {
  return new Response(null, { headers: { 'x-middleware-rewrite': DAILY } });
}
