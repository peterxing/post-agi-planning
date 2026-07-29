# X evidence retrieval — archive verification plus optional API

The forecast gives priority to reviewed activity actually written by **@peterxing**, then reviewed
reposts, then reviewed authoritative external evidence. Publication does not depend on a bulk profile
timeline or authenticated X API. `x-archive.js` discovers public activity IDs through Wayback CDX,
hydrates each through X first-party status JSON, cross-checks authorship through X oEmbed, and stores
the deduplicated corpus only under `pap-secrets`. `refresh-signals.js` writes `signals.json` only at
complete, reviewed direct coverage.

All credentials live **only** in `C:\Users\peterxing\pap-secrets\.env` — a directory that is **never
served or deployed** (the static server blocks dotfiles; `pap-site` / Vercel never see it). Nothing
secret is committed.

---

## Current API status (29 Jul 2026)

The configured app-only request currently returns **HTTP 402 — credits depleted** before user lookup.
This is a plan/quota condition, not an expired credential. Add X API credits or upgrade the app plan,
then run `node x-client.js --probe` until `user_lookup` returns HTTP 200. Do not rotate credentials
unless the probe instead classifies the failure as `authentication-expired`.

The API is now a non-blocking diagnostic and optional discovery seed. Credits can be restored for
real-time discovery, but Wayback discovery plus first-party per-status verification remains the
publication source. `signals.sourceStatus` and the site evidence panel report both facts.

The former nitter/RSS, legacy profile syndication, RSSHub and mirror timeline endpoints are unavailable
and are deliberately not called. The table below describes configured API capability once credits are
available, not a publication dependency:

| Signal       | Status        | Auth required                                   |
|--------------|---------------|-------------------------------------------------|
| **Posts**    | ✅ active      | App-only Bearer (configured)                    |
| **Reposts**  | ✅ active      | App-only Bearer (configured)                    |
| **Likes**    | ⬜ opt-in      | OAuth 1.0a **or** OAuth 2.0 user context        |
| **Bookmarks**| ⬜ opt-in      | OAuth 2.0 user context **only** (`bookmark.read`) |

Routine runs re-verify every published mapping and advance a cache-aware archive batch. Use:

```powershell
npm run refresh:archive
$env:X_ARCHIVE_BACKFILL='1'
$env:X_ARCHIVE_HYDRATE_LIMIT='400'
node refresh-signals.js
```

Set `X_ARCHIVE_DISCOVERY_FORCE=1` for a fresh, fully paginated CDX sweep. IDs are sorted numerically
with `BigInt` and sampled across the whole time range, never lexicographically.
Use `node x-archive.js --account=HANDLE --hydrate=120` when curating authoritative external accounts;
the per-account cache also stays under `pap-secrets` and never self-approves a mapping.

`api.fxtwitter.com` and `api.vxtwitter.com` are permitted only as manual last-resort cross-checks when
both first-party hydration and oEmbed are inconclusive. Send only a public numeric status ID—never
credentials, private corpus content, request headers or user-context data. They are not provenance.

`.env` keys (already present, with empty opt-in placeholders):

```
X_API_KEY=…            # consumer / OAuth1 API key   (configured)
X_API_SECRET=…         # consumer / OAuth1 API secret (configured)
X_BEARER_TOKEN=…       # app-only bearer, stored verbatim/URL-encoded (configured)
X_ACCESS_TOKEN=        # ← fill to activate LIKES (see Option A)
X_ACCESS_SECRET=       # ← fill to activate LIKES (see Option A)
X_OAUTH2_CLIENT_ID=    # ← fill to activate BOOKMARKS (see Option B)
X_OAUTH2_CLIENT_SECRET=# ← only if your app is "Confidential"
X_OAUTH2_TOKEN=        # ← written automatically by x-auth.js
X_OAUTH2_REFRESH=      # ← written automatically by x-auth.js
```

---

## Option A — activate **LIKES** (1 minute, no browser flow)

Likes need a user-context token. The fastest path is OAuth 1.0a access tokens, which the developer
portal can mint for your own account in one click:

1. Go to the [X developer portal](https://developer.x.com/) → your Project → your App → **Keys and tokens**.
2. Under **Authentication Tokens → Access Token and Secret**, click **Generate**.
   - Make sure the app's **User authentication settings** permission is **Read** (or higher).
3. Copy the two values into `pap-secrets\.env`:
   ```
   X_ACCESS_TOKEN=<the Access Token>
   X_ACCESS_SECRET=<the Access Token Secret>
   ```
4. Verify: `node x-client.js --probe` → the report should show `likes: ok`.

That's it — the next daily run includes his likes (badge: ♥ *liked · @author*).

> Bookmarks are **not** reachable with OAuth 1.0a — use Option B for those.

---

## Option B — activate **BOOKMARKS** (+ likes) via OAuth 2.0 (one browser login)

Bookmarks are owner-private and require an OAuth 2.0 user-context token with the `bookmark.read` scope.
`x-auth.js` runs the PKCE login for you and saves the token.

1. In the [X developer portal](https://developer.x.com/) → your App → **User authentication settings → Set up / Edit**:
   - **App permissions:** Read
   - **Type of App:** Web App / Native App (enables **OAuth 2.0** with PKCE)
   - **Callback URI / Redirect URL:** add **exactly**
     ```
     http://127.0.0.1:8723/callback
     ```
   - Save. Then on **Keys and tokens**, copy the **OAuth 2.0 Client ID** (and **Client Secret** if the
     app type is *Confidential*).
2. Put them in `pap-secrets\.env`:
   ```
   X_OAUTH2_CLIENT_ID=<OAuth 2.0 Client ID>
   X_OAUTH2_CLIENT_SECRET=<only if your app is Confidential>
   ```
3. Run the one-time login **while logged into x.com as @peterxing in your default browser**:
   ```
   node C:\Users\peterxing\pap-deploy\x-auth.js
   ```
   It opens the X authorize page; click **Authorize app**. The script captures the redirect, exchanges
   the code, and writes `X_OAUTH2_TOKEN` + `X_OAUTH2_REFRESH` into `.env`.
4. Verify: `node x-client.js --probe` → should show `bookmarks: ok` (and `likes: ok`).

The OAuth2 token expires periodically; the daily job auto-refreshes it with the saved refresh token:
```
node C:\Users\peterxing\pap-deploy\x-auth.js --refresh
```
(`refresh-signals.js`/the workflow call this before harvesting when a refresh token is present.)

---

## How the daily workflow uses these

`x-client.js` probes optional API capability:

- **Likes** — uses OAuth 2.0 user token if present, else OAuth 1.0a user context.
- **Bookmarks** — uses OAuth 2.0 user token only.
- **Posts + reposts** — app-only Bearer (always).

Peter evidence includes authored posts, quotes/replies with Peter's own words, and reposts. Active
approvals retain public-safe status/activity IDs, authorship relationship, review date, verification
date, exact prediction text and rationale. Run `node verify-peter-evidence.js --update` before refresh:
it first hydrates every original status through X first-party JSON, then uses oEmbed to independently
cross-check the original author and Peter activity URL. Only then does it update `lastVerifiedAt`.
Deleted, protected or author-mismatched records fail closed.

Matching maximizes unique reviewed posts first, then permits reuse only within one declared compatible
evidence family. External evidence must be in
the reviewed public-safe ledger, first-party hydrate, identify its authoritative account/source
quality, independently cross-check through oEmbed, and
stay within one reviewed scenario or threshold-series reuse group. The private history remains under
`pap-secrets` (**not** served). If source freshness, the 24-mapping sticky Peter floor, the
10-mapping Peter-authored floor, 103/103 direct
coverage, provenance, the 10-use ceiling, or reuse compatibility fails, refresh exits nonzero and
leaves the last complete public file unchanged.

## Security

- Secrets live **only** in `pap-secrets\.env`; the static server returns 403 for any dotfile or path
  escaping the web root, and `pap-site`/Vercel never contain the file.
- `x-activity.json`, `x-activity-history.json`, `x-wayback-status-ids.json` and
  `x-status-corpus.json` stay in `pap-secrets`.
- Never commit, print, serve, or deploy any value from `.env`.
