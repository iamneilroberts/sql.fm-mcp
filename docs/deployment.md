# Deployment and operations

## Prerequisites

- Node 22+
- A Cloudflare account (`npx wrangler login`)
- For a `sql.fm` URL: access to that zone — **the owner's account**

## Reproducible build

```bash
npm ci            # strictly from the committed lockfile
npm run typecheck
npm test
npm run deploy:dry
```

`deploy:dry` bundles without publishing and reports the upload size. Current size with the
synthetic fixture: **~1.26 MB raw / ~218 KB gzipped**, against a 3 MB compressed limit on the
free plan. A real dataset of the size SQL.FM publishes today would add roughly another
150 KB gzipped, so there is a wide margin.

## Deploying (Shape A — standalone Worker)

```bash
npx wrangler login
npm run deploy
```

This publishes to `https://sqlfm-mcp.<account>.workers.dev`, with `/mcp` and `/health`.

To serve from a first-party URL, uncomment the `routes` block in `wrangler.jsonc`:

```jsonc
"routes": [{ "pattern": "sql.fm/mcp*", "zone_name": "sql.fm" }]
```

This requires the `sql.fm` zone, so it is the owner's step, not something to do on his behalf.

## Deploying (Shape B — Pages Function inside SQL.FM)

The adoption path. See [architecture.md §5.3.1](architecture.md#531-three-deployment-shapes-on-cloudflare).

1. Copy `src/` into the SQL.FM Pages project (e.g. as `mcp/`).
2. Add `functions/mcp/[[path]].ts`:

   ```ts
   export { onRequest } from '../../mcp/pages';
   ```

3. Have the SQL.FM build write `dataset.v1.json` and point `src/data/bundled.ts` at it.
4. Deploy the site as usual. `/mcp` ships with it.

No code below `src/handler.ts` changes. Data and server are then in sync by construction —
the build that generates the dataset is the build that ships the server, so there is no second
deploy to remember and no refresh interval to tune.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `SQLFM_DATASET_URL` | unset | Enables the opt-in HTTP provider. **Unset means no outbound requests at all** — the recommended mode |
| `SQLFM_ALLOWED_ORIGINS` | unset | Comma-separated exact origins the HTTP provider may fetch. Required when `SQLFM_DATASET_URL` is set; an empty allowlist is a startup error |
| `SQLFM_REFRESH_SECONDS` | `900` | HTTP provider refresh interval |
| `SQLFM_LOG_QUERIES` | `false` | Local debugging only. Logs query text. Do not enable in production |

Do not point `SQLFM_DATASET_URL` at sql.fm without the owner's written permission
([ATTRIBUTION.md](../ATTRIBUTION.md)).

## Dataset refresh

**Bundled (recommended):** refresh is a redeploy.

```
SQL.FM data change → SQL.FM build → dataset.v1.json → npm run validate:dataset → npm run deploy
```

Under Shape B this collapses into the site's own deploy.

**HTTP provider:** the Worker revalidates on its own schedule with `If-None-Match` /
`If-Modified-Since`. A failed refresh serves last-known-good and flags `stale: true` — it never
errors a tool call and never returns empty. Confirm with `/health`.

Before deploying any dataset:

```bash
npm run validate:dataset -- path/to/dataset.v1.json
```

This checks matrix row lengths, legend coverage, release references, duplicate ids, orphaned
rows, and non-`https` documentation URLs — the cross-checks the JSON Schema cannot express.

## Health

```bash
curl -s https://<host>/health | jq
```

- `status: "ok"` — serving current data
- `status: "degraded"` — serving last-known-good after a failed refresh (`stale: true`)
- `status: "error"` — no dataset could be loaded

`synthetic: true` means the deployment is serving fixtures, not real data. Watch that field:
it is how a demo deployment is prevented from quietly passing itself off as the real thing.

The same payload is available to MCP clients as `sqlfm://dataset/meta`.

## Rate limiting

Configure Cloudflare **Rate Limiting Rules** in front of the Worker — dashboard configuration,
no code, no state. Suggested starting point:

- Match: `http.request.uri.path eq "/mcp"`
- 60 requests per minute per IP, burst 120
- Action: block, 10-second timeout

## Logs

Structured JSON to stderr, visible in `wrangler tail` and Workers Logs:

```json
{"ts":"...","level":"info","tool":"search","ok":true,"latency_ms":3,
 "result_count":5,"query_len":24,"error_code":null,"dataset_version":"..."}
```

Query text is never logged. See [SECURITY.md](../SECURITY.md#privacy).

## Versioned releases

```bash
git tag -a v1.0.0 -m "..." && git push origin v1.0.0
npm run deploy
```

Tag the commit that was deployed, so a version maps to an exact bundle and an exact
`content_hash` (visible at `/health`).

## Rollback

Cloudflare keeps prior versions:

```bash
npx wrangler deployments list
npx wrangler rollback [<version-id>]
```

Because code and data are bundled together, **a rollback reverts both atomically**. There is no
state in which new code runs against old data. Confirm with `/health` that `content_hash` is
the expected one.

If the HTTP provider is enabled, rollback reverts code only — the data is whatever upstream is
currently serving. That asymmetry is one of the reasons the bundled provider is the default.

## Troubleshooting

| Symptom | Cause | Action |
|---|---|---|
| `400` with `Invalid _meta envelope` | Client sent a `2026-07-28` request without `clientCapabilities` | Client-side; see [clients.md](clients.md#raw-http) |
| `400` with code `-32020` | `Mcp-Method` header disagrees with the body | Client-side |
| `/health` reports `degraded` | HTTP provider refresh failing | Check upstream; the server is still serving last-known-good |
| Startup fails with "No dataset origins are allowlisted" | `SQLFM_DATASET_URL` set without `SQLFM_ALLOWED_ORIGINS` | Set both, or unset both to use the bundled dataset |
| Worker exceeds the size limit | Dataset grew a lot | See [architecture.md §18.5](architecture.md#185-if-the-scale-assumption-breaks) |
