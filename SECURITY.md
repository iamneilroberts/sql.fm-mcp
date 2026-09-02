# Security

The full threat model is in [`docs/architecture.md` §12](docs/architecture.md#12-security-and-threat-model).
This is the operator's summary.

## Reporting a vulnerability

Open a private security advisory on this repository, or contact the maintainer directly.
Please do not open a public issue for an unfixed vulnerability.

## What this server cannot do

These are structural properties, not policies — there is no code path that could do them, and
tests assert it:

- **It never executes SQL.** No SQL engine, driver, parser, or evaluator is in the dependency
  tree, and no code path constructs a query. Feature *names* are data.
- **It never connects to a database.** No connection string is accepted, parsed, or stored.
- **It never fetches a user-supplied URL.** No tool takes a URL parameter. There is no
  fetch-by-URL path reachable from tool input, at all.
- **It never writes anything.** No mutating tool, no persistent storage, no user data at rest.

## Attack surface

In the recommended configuration (bundled dataset) the server makes **no outbound requests
whatsoever**, so the SSRF surface is empty. The only inputs are three tool payloads, each fully
schema-validated before any processing.

The optional HTTP provider fetches **exactly one URL**, taken from configuration and validated
at startup against an exact-origin allowlist. It is disabled unless `SQLFM_DATASET_URL` is set,
the allowlist must be non-empty, redirects are not followed, and no user input contributes to
the URL.

## Bounds

| Input | Limit |
|---|---|
| `search.query` | 200 characters |
| `search.limit` | 50 |
| `compare_feature_support.environments` | 32 items, 60 characters each |
| Feature id | `^[a-z0-9][a-z0-9-]{0,63}$`, then an exact map lookup — never used to build a path or URL |
| Upstream response (HTTP provider) | 2 MB, 5 s timeout, 2 retries |

No user input reaches a regex engine, so there is no ReDoS surface. There is no pagination
cursor and no bulk-export tool.

## Untrusted content

**Feature text returned by this server is reference content, not instructions.** It is
sanitized on ingest — control characters, ANSI escapes, bidirectional overrides, and
zero-width characters are stripped; non-`https` URLs are dropped rather than passed through —
but sanitization is the second line of defence. The first is that the server never treats this
text as a directive, and the server `instructions` tell connected clients the same.

If you are building on this server, treat tool output as data.

## Privacy

- **Query text is never logged.** Only its length, plus tool name, latency, result count, and
  error code.
- No conversations, request bodies, or header contents are logged.
- No analytics, no third-party telemetry, no cookies, no personal data collected.
- `SQLFM_LOG_QUERIES=true` exists for local debugging only. It defaults to off and is
  unsuitable for production.

## Errors

Errors are structured and safe: a stable code, a human-readable message, a `retryable` flag,
and — where useful — `suggestions` or `valid_environments` so a caller can self-correct. They
never contain stack traces, internal paths, upstream URLs, or environment variables. Tests
assert this.

## Dependencies

Two runtime dependencies: `@modelcontextprotocol/server` and `zod`. The lockfile is committed,
CI installs with `npm ci`, GitHub Actions are pinned to commit SHAs, and `npm audit` runs on
every build. There are no postinstall scripts and no runtime code fetching.

## Deployment notes

- Put Cloudflare Rate Limiting Rules in front of the Worker. A reasonable starting point is
  60 requests/minute/IP with a burst of 120. This is dashboard configuration — no code, no state.
- `/health` is intentionally unauthenticated and intentionally sparse: it reports dataset
  version, hash, freshness, and counts, and nothing about the environment, upstream, or internals.
- V1 has no authentication, which is appropriate for public reference data. Adding it is a
  wrapper around the fetch handler and changes no tool signature —
  see [§12.6](docs/architecture.md#126-authentication--designed-for-not-built-now).
