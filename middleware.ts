// Routing Middleware: peterxing.com opens on The Singularity Daily at the bare domain.
//
// Only on peterxing.com (and www) does the document root change: it is rewritten, without changing the address, to the
// Daily's site on GitHub Pages (repo peterxing/singularity-daily). The page loads its files from /daily/*, which
// vercel.json proxies to the same site, and /daily stays as an alias. The Guide is unchanged at /guide, and
// /index.html (the companion's "Back to the field guide" link) goes there too. post-agi-planning.vercel.app keeps the
// Guide at "/" exactly as before, so the Guide's live verifiers still run against a document-root Guide.
// Deleting this file puts the Guide back at "/" on every domain.
export const config = { matcher: ['/', '/index.html'] };

const DAILY = 'https://peterxing.github.io/singularity-daily/';
const BRAND = /^(www\.)?peterxing\.com$/;

export default function middleware(request: Request): Response {
  const url = new URL(request.url);
  if (BRAND.test(url.hostname)) {
    if (url.pathname === '/index.html') {
      return new Response(null, { status: 308, headers: { Location: `/guide${url.search}` } });
    }
    return new Response(null, { headers: { 'x-middleware-rewrite': DAILY } });
  }
  return new Response(null, { headers: { 'x-middleware-next': '1' } });
}
