# Handoff to SQL.FM

This project exists to be given away. This page is the checklist for doing that.

## What this is

A read-only MCP server that lets ChatGPT, Claude, Codex, and any other MCP client answer SQL
Server / Azure SQL feature-support questions from SQL.FM's matrix, with citations, instead of
from the model's memory. Three tools: `search`, `fetch`, `compare_feature_support`.

It is written to be handed over: MIT licensed, two runtime dependencies, no service dependency
on the author, no accounts to transfer, and no hosted infrastructure that anyone but the owner
would need to run.

## What has and has not been done

**Built, tested, and working** — against synthetic fixtures:

- Three MCP tools plus three discovery resources, on MCP `2026-07-28` (Streamable HTTP at
  `/mcp`, stateless, with 2025-client compatibility).
- 199 automated tests: unit, property, provider, schema-contract, transport, end-to-end through
  a real MCP client, and the 14 acceptance scenarios.
- Worker bundles and passes `wrangler deploy --dry-run` (~218 KB gzipped).
- Local stdio entry point for development and MCP Inspector.

**Not done, and needs you:**

- **No real SQL.FM data has been used, copied, or committed.** Everything runs on invented
  fixtures.
- Nothing has been deployed to a public URL.
- No client has been connected to a live server.

## What needs your decision

Full list with rationale: [architecture.md §15](architecture.md#15-open-questions-for-mike-scalise).
These three gate everything:

| | Question |
|---|---|
| **Q1** | Is there a SQL.FM source repository, and can a dataset export be added to its build? |
| **Q2** | May a stable `dataset.v1.json` be generated, and where should it live? |
| **Q3** | Permission to expose SQL.FM data through an MCP server, with attribution? |

On Q3, note that `sql.fm/robots.txt` currently disallows `GPTBot`, `ClaudeBot`, `CCBot` and
others, and signals `ai-train=no, use=reference`. A cited reference tool is arguably inside
`use=reference` and is certainly not training — but that reading is yours to make, not ours,
which is why nothing here touches the site.

Also worth an answer, but not blocking: **Q4** (compatibility level is absent from the data —
should it be added?), **Q5** (should on-premises support gain a `conditional` status?), **Q6**
(would you take the synonym list upstream as aliases?), **Q12** (standalone Worker, or a Pages
Function inside the SQL.FM project?).

## Adopting it

### 1. Generate a dataset

Write a generator that emits [`dataset.v1`](data-schema.md) from SQL.FM's source data. Given
what the site's existing data asset looks like — a clean relational export with releases,
editions, categories, features, a compact matrix, cloud support, timeline events, and aliases —
this should be close to a serialize step. `scripts/build-fixture.mjs` is a worked example of
the output shape.

Then:

```bash
npm run validate:dataset -- path/to/dataset.v1.json
```

Three additions to the payload would help and cost the build almost nothing: `dataset_version`,
`generated_at`, and — if you ever record them — compatibility-level requirements.

### 2. Point the server at it

In `src/data/bundled.ts`, change the import to your generated file and set
`bundledIsSynthetic` to `false`. That is the whole change; the provider abstraction means real
and synthetic data follow identical code paths.

Then rewrite `data/synonyms.json` against your real slugs (`npm run check:synonyms` verifies
every target resolves), and re-point the acceptance tests at real features.

### 3. Pick a deployment shape

[architecture.md §5.3.1](architecture.md#531-three-deployment-shapes-on-cloudflare) has the
detail. Short version: a **Pages Function inside the SQL.FM project** is the better answer once
the code is yours — one repo, one deploy, and the dataset is always in sync because the build
that generates it is the build that ships the server. A standalone Worker is the fallback if
you would rather keep MCP out of the site repo.

### 4. Remove the disclaimers

Once this is first-party, the non-affiliation wording is no longer true. Remove it from:

- `README.md`, `ATTRIBUTION.md`, `docs/architecture.md`
- the `INSTRUCTIONS` string in `src/server.ts`
- `source.attribution` and `source.disclaimer` in the dataset itself

Those last two are data, not code, so you can word them however you like without touching the
server. The Microsoft non-affiliation line should stay — that one remains true.

### 5. Transfer

Transfer or fork the repository, and re-point the CI badge and links. There is nothing else:
no accounts, no secrets, no external services, no scheduled jobs.

## Ongoing cost

Close to zero, integrated first-party:

| Task | Frequency | Effort |
|---|---|---|
| Dataset refresh | Every data change | Zero as a Pages Function — the site deploy *is* the server deploy |
| A new SQL Server release | Every 2–3 years | **Zero code.** The environment grammar and matrix width derive from the data |
| A new Azure environment | Occasional | One `cloud_targets` row, plus an id alias if you want a friendly name |
| MCP spec revisions | 2–3× a year | Usually an SDK bump. The SDK absorbs most of it |
| Dependencies | Monthly | Two runtime dependencies; Dependabot handles it |

## If you would rather not

That is a complete answer, and no follow-up is needed. Nothing has been deployed, nothing of
yours has been copied, and there is nothing to take down.
