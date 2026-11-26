# The shared index (server)

What Recorders filed on shift 5 of Clearance (SAD, ALONE, WAITING, IN A HURRY, TIRED, DOES NOT BELONG, SUSPICIOUS, OUT OF PLACE, ABANDONED, A PLACE TO HIDE), pooled from every unit whose Recorder turned on **Settings ▸ SHARE WITH THE INDEX** (off by default). The camera shows it on **THE INDEX** screen (title screen and the in-shift menu); the web page is `../index/` (published with the game at `/clearance/index/`).

This folder is a Cloudflare Worker with a D1 (SQLite) database: `src/worker.js` (routes), `src/rules.js` (what it accepts), `migrations/` (the tables), `wrangler.toml` (settings), `admin.mjs` (William's tools), `test/api.mjs`.

## What is kept, and what isn't

Each entry is a 40×30 two-tone print (150 bytes: the game's lowest grade, SENSOR I / TONE I, made on the phone by `Developer.bits`), the label it was filed under and the day it arrived (UTC, set by the server). That's all.

- The Worker refuses any upload that isn't exactly `{label, bits}` with a known label and 150 bytes.
- Never sent by the game: the 640×480 frame, the Recorder's own (sharper) print, the CLIP embedding, the time of day, a location, a device or unit id.
- Addresses are used only for the rate limit, as an HMAC with a secret salt, in a row deleted after the hour. Workers Logs are off (`[observability] enabled = false`).
- Each upload returns a random key; its SHA-256 is stored, the key stays on the phone (`save.shared`) and withdraws that print (archive ▸ ▾, or THE INDEX ▸ YOURS ▸ ▾). The keys survive NEW RECORDER and ERASE EVERYTHING, so a Recorder can still withdraw.
- Limits: 30 uploads per address per hour, 1000 per day for the whole index (then 503 until the next day), 1 KB bodies, uploads and deletes only from the game's own pages (`ALLOWED_ORIGINS`, plus `serve.py --tunnel` links while `ALLOW_TUNNELS` is "1").
- `HOLD_NEW = "1"` in `wrangler.toml` makes new prints wait for William's approval before anyone sees them (a 40×30 bitmap is big enough for a few words, so this is the switch if someone posts junk).

## API

| | |
|---|---|
| `POST /api/entries` `{"label":"sadness","bits":"<200 chars of base64>"}` | 201 `{id, key, day, status}` |
| `GET /api/index?per=N` | every label's count and its newest N prints (N ≤ 200) |
| `GET /api/entries?label=K&before=ID&limit=N` | older prints of one label, `more` if there are more |
| `DELETE /api/entries/ID` | with `X-Delete-Key: <key>` (the sender) or `Authorization: Bearer <ADMIN_TOKEN>` |
| `POST /api/entries/ID/approve` | admin, for held prints |
| `GET /api/admin/entries?status=held\|live\|all` | admin |

Bits: 40×30, row by row, high bit first, 1 = paper (`packBits` in `../src/game/shared-index.js`).

## Run it on the Mac (no Cloudflare account involved)

```bash
cd server && npm install
npm run dev          # http://localhost:8787, local database in .wrangler/, admin key "dev-admin"
```

Then the game at `http://localhost:8077/?index=http://localhost:8787` (with `python3 serve.py`) and the page at `http://localhost:8077/index/?index=http://localhost:8787`.

Tests: `npm test` here (the Worker in the real Workers runtime with a fresh local database: uploads, refusals, origins, rate limit, daily cap, withdraw, admin, held prints); `cd ../tools && npm test` (the game side, no server); `node test/playthrough.mjs` (the opt-in, uploads, THE INDEX screen, withdrawing, against a stand-in index); `node test/index-e2e.mjs` (game → Worker → page → withdraw → admin delete, against `npm run dev` or `INDEX=<url> INDEX_ADMIN=<key>`).

## Deployed

Since Nov 21 2026 (William said "Yes, deploy"): **https://clearance-index.clearance-index.workers.dev**, on William's Cloudflare account (william.yao24@gmail.com). D1 database `clearance-index` (id in `wrangler.toml`, region ENAM). The admin key is in the Keychain (service `clearance-index`, account `admin`) and is the Worker's `ADMIN_TOKEN` secret. The account had no workers.dev subdomain, so the first `wrangler deploy` registered `clearance-index` (hence the doubled name); it can be renamed in the Cloudflare dashboard (Workers & Pages ▸ your subdomain), after which `INDEX_API` in `../src/config.js` needs the new address. Checked end to end on the deployed index the same day (`index-e2e.mjs`: two prints in, shown on the page and the camera, one withdrawn, one deleted by the admin), then the test rows and the numbering were cleared, so the first real print is 0001.

`INDEX_API` points at it. Published with the game on Nov 21 2026 (public commit 1ceeca5): THE INDEX, the Settings row and the page (https://thewilliamyao.github.io/clearance/index/) are live. The live index accepts uploads only from https://thewilliamyao.github.io and the local test origins (checked with a preflight the same evening).

Update the Worker after changing `src/` or `wrangler.toml`: `npm test`, then `npx wrangler deploy`. A new table or column: a new file in `migrations/`, then `npx wrangler d1 migrations apply clearance-index --remote`.

## Deploy from scratch (William's Cloudflare account; ask him first)

Uses the wrangler login already on the Mac (account william.yao24@gmail.com, see `portfolio/DEPLOY.md`).

```bash
cd server
npx wrangler d1 create clearance-index          # copy the database_id it prints into wrangler.toml
npx wrangler d1 migrations apply clearance-index --remote
node admin.mjs new-token                        # makes the admin key, keeps it in the Keychain
security find-generic-password -s clearance-index -a admin -w | npx wrangler secret put ADMIN_TOKEN
npx wrangler deploy                             # prints https://clearance-index.<subdomain>.workers.dev
```

Then put that address in `INDEX_API` in `../src/config.js`, check it end to end (`INDEX=<url> INDEX_ADMIN=$(security find-generic-password -s clearance-index -a admin -w) node ../tools/test/index-e2e.mjs`, which removes what it adds), and publish the game (`../publish/publish.sh`) so the public copy uses it.

Free plan limits that matter: 100,000 Worker requests a day, 5 million D1 rows read a day (a look at the index reads about 10 × per rows plus one per print for the counts), 100,000 rows written a day.

## Admin

```bash
node admin.mjs list --prints     # newest first, drawn in the terminal
node admin.mjs delete 12 13      # take prints down for everyone
node admin.mjs approve 14        # when HOLD_NEW is on
node admin.mjs token             # the admin key on the clipboard, for the page
```

On the page: open `…/clearance/index/?admin`, paste the key once (kept for that tab only), open a print, DELETE or APPROVE. The page's footer tells people to write to hello@thewilliamyao.com with a print's number to have it taken down.
