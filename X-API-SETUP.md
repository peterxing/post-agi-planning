# X API setup — realtime @peterxing signals

The REHOBOAM timeline matches each prediction to a real **@peterxing** signal, pulled **realtime from
the X API v2** by `refresh-signals.js` (via `x-client.js` → `harvestActivity()`), then written to
`signals.json` (which the site loads at runtime). This runs every day.

All credentials live **only** in `C:\Users\peterxing\pap-secrets\.env` — a directory that is **never
served or deployed** (the static server blocks dotfiles; `pap-site` / Vercel never see it). Nothing
secret is committed.

---

## What works right now (no action needed)

With app-only **Bearer** auth (already configured), the daily harvest pulls @peterxing's realtime:

| Signal       | Status        | Auth required                                   |
|--------------|---------------|-------------------------------------------------|
| **Posts**    | ✅ active      | App-only Bearer (configured)                    |
| **Reposts**  | ✅ active      | App-only Bearer (configured)                    |
| **Likes**    | ⬜ opt-in      | OAuth 1.0a **or** OAuth 2.0 user context        |
| **Bookmarks**| ⬜ opt-in      | OAuth 2.0 user context **only** (`bookmark.read`) |

The latest run harvested **~300 realtime items (posts + reposts)**, newest dated **today**, and matched
real reposts to ~9 of the 11 prediction years. Likes/bookmarks join automatically once a user-context
token exists (below) — no code change required.

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

## How the daily harvest uses these

`x-client.js` picks the richest auth it has, per call:

- **Likes** — uses OAuth 2.0 user token if present, else OAuth 1.0a user context.
- **Bookmarks** — uses OAuth 2.0 user token only.
- **Posts + reposts** — app-only Bearer (always).

`harvestActivity()` returns a normalized, de-duplicated activity stream (`kind` ∈ post/repost/like/
bookmark). `refresh-signals.js` scores every item against each prediction and surfaces the single best
real signal per year (past-week preferred, else most-recent on topic, else a live search). The raw
activity dump is written to `pap-secrets\x-activity.json` (**not** served); only the curated
`signals.json` is public — so private bookmarks are never exposed wholesale, just the one matched per
prediction.

## Security

- Secrets live **only** in `pap-secrets\.env`; the static server returns 403 for any dotfile or path
  escaping the web root, and `pap-site`/Vercel never contain the file.
- `x-activity.json` (full activity, may include private bookmarks once active) stays in `pap-secrets`.
- Never commit, print, serve, or deploy any value from `.env`.
