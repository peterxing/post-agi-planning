// Routing Middleware: peterxing.com opens on The Singularity Daily at the bare domain.
//
// Only on peterxing.com (and www) is the document root rewritten, without changing the address, to the Daily's site on
// GitHub Pages (repo peterxing/singularity-daily). The page loads its files from /daily/*, which vercel.json proxies to
// the same site, and /daily stays as an alias. The Guide is unchanged at /guide; links into it from the AI timeline and
// the game, which point at "/", are forwarded there by the Daily's route.js. post-agi-planning.vercel.app keeps the
// Guide at "/" exactly as before, so the Guide's live verifiers still open a document-root Guide.
// Deleting this file puts the Guide back at "/" on every domain.
export const config = { matcher: ['/'] };

const DAILY = 'https://peterxing.github.io/singularity-daily/';
const BRAND = /^(www\.)?peterxing\.com$/;

export default function middleware(request: Request): Response {
  if (BRAND.test(new URL(request.url).hostname)) {
    return new Response(null, { headers: { 'x-middleware-rewrite': DAILY } });
  }
  return new Response(null, { headers: { 'x-middleware-next': '1' } });
}
