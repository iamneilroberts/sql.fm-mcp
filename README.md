# sql.fm-mcp

A read-only [Model Context Protocol](https://modelcontextprotocol.io) server for the
[SQL.FM](https://sql.fm/) SQL Server feature matrix — so ChatGPT, Claude, Codex, and other MCP
clients answer SQL Server version, edition, and Azure SQL support questions from a cited
reference instead of from memory.

> **Not affiliated with, endorsed by, or sponsored by SQL.FM or Mike Scalise.** SQL.FM is
> created and maintained by Mike Scalise. This is a proposal offered for adoption as a
> first-party SQL.FM component — see [`docs/handoff.md`](docs/handoff.md).
>
> **Not affiliated with Microsoft.** SQL.FM is itself an independent reference site.
>
> **Ships synthetic data.** No SQL.FM content is in this repository, and none may be added
> until data-use permission is explicit. See [`ATTRIBUTION.md`](ATTRIBUTION.md).

## Tools

| Tool | Use it for |
|---|---|
| `search` | Find features by name, keyword, or natural language. Returns canonical `sql.fm` URLs for citation |
| `fetch` | One feature's full record: support across every release and edition, Azure status, history, conditions, Microsoft docs |
| `compare_feature_support` | Compare one feature across chosen versions, editions, and Azure environments |

Plus three discovery resources: `sqlfm://environments`, `sqlfm://categories`,
`sqlfm://dataset/meta`.

All three tools are read-only, deterministic, and closed-world (`readOnlyHint: true`,
`openWorldHint: false`). `search` and `fetch` follow OpenAI's deep-research contract, so the
server works in ChatGPT unmodified.

## The rule the whole design turns on

SQL.FM distinguishes six support states, and collapsing them would make the server confidently
wrong:

```
available | unavailable | conditional | preview | not_applicable | unknown
```

`unknown` means *not recorded*. `not_applicable` means *that edition did not exist yet*.
**Neither is ever reported as "unsupported."** There is no boolean anywhere in the pipeline —
nothing to coerce to — and a property test over randomized datasets asserts the invariant end
to end.

Edition matters just as much. Ask *"does SQL Server 2019 support online index rebuilds?"* and a
release-level yes or no is a wrong answer: it is available in Enterprise and Developer,
unavailable in Standard and Express. Release-level queries aggregate through an explicit
lattice and return `conditional` with the split spelled out.

## Quick start

```bash
npm install
npm test                 # 199 tests
npm run dev:stdio        # stdio, for MCP Inspector and local clients
npm run dev              # local HTTP on the workerd runtime: :8787/mcp and /health
```

Connect a client — MCP Inspector, ChatGPT, Claude, Codex — with
[`docs/clients.md`](docs/clients.md).

```bash
npx @modelcontextprotocol/inspector npx tsx src/stdio.ts
```

## Architecture in one paragraph

A stateless TypeScript server on the **Cloudflare Workers runtime**, built on **MCP SDK v2**
(spec `2026-07-28`) with Streamable HTTP at `/mcp`, serving a versioned `dataset.v1.json`
bundled at build time. SQL.FM already runs on Cloudflare, so the same code deploys three ways
behind a ~15-line adapter: a **standalone Worker** today, a **Pages Function inside the SQL.FM
project** on adoption (one repo, one deploy, dataset always in sync), and eventually a single
Worker serving both site and `/mcp`. A **local stdio** entry point is supported throughout.

Search is deterministic and local — nine documented ranking tiers, trigram-filtered
Damerau–Levenshtein for misspellings, a curated synonym layer. No LLM, no embeddings, no vector
database: ranking that cannot be reproduced cannot be tested, and a reference tool has to be
testable. **Search selects which features to return; it never touches what their support status
is.**

Full design: [`docs/architecture.md`](docs/architecture.md).

## Security posture

The server never executes SQL, never connects to a database, never fetches a user-supplied URL,
and never writes anything. In the default configuration it makes **no outbound requests at
all**, so the SSRF surface is empty. Feature text is treated as data, never as instructions.
Query text is never logged.

Details: [`SECURITY.md`](SECURITY.md).

## Repository layout

```
src/
  handler.ts        shared fetch handler — everything real lives here
  index.ts          Shape A: standalone Worker
  pages.ts          Shape B: Cloudflare Pages Function adapter
  stdio.ts          local stdio entry
  server.ts         McpServer factory: tools, resources, instructions
  domain/           pure core — no I/O, no clock, no env
  search/           normalization, ranking tiers, fuzzy matching
  providers/        fixture / local / http, behind one two-method interface
  tools/ resources/ the MCP surface
fixtures/synthetic/ invented data — no SQL.FM content
schemas/            generated JSON Schema for dataset.v1
scripts/            fixture + schema generation, dataset and synonym validation
test/               unit · property · providers · schema · transport · e2e · acceptance
docs/               architecture, data schema, clients, deployment, handoff
```

## Documentation

| | |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Full design: stack, hosting shapes, data strategy, tool schemas, ranking, threat model, alternatives, open questions |
| [`docs/data-schema.md`](docs/data-schema.md) | The `dataset.v1` contract, for whoever writes the generator |
| [`docs/clients.md`](docs/clients.md) | MCP Inspector, ChatGPT, Claude, Codex, raw HTTP |
| [`docs/deployment.md`](docs/deployment.md) | Deploy, configure, refresh, roll back |
| [`docs/handoff.md`](docs/handoff.md) | Adoption checklist for Mike Scalise |
| [`SECURITY.md`](SECURITY.md) · [`ATTRIBUTION.md`](ATTRIBUTION.md) | Threat model summary; attribution and permission status |

## Status

Phase 2 complete against synthetic fixtures. **Nothing is deployed, and no SQL.FM data has been
used.** What needs the owner's decision is collected in
[`docs/handoff.md`](docs/handoff.md) — the first three questions gate everything else.

## Licence

MIT — see [`LICENSE`](LICENSE). Covers this repository's code and documentation only. It grants
no rights to SQL.FM's data or content.
