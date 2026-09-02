# Synthetic fixtures

**Everything in `dataset.v1.json` is invented. It contains no SQL.FM content.**

The feature names (`WIDGET_AGG`, `Sparkle Compression`, `Flux Capacitor Index`, …) describe
no real product and no real capability. Do not cite them, and do not treat any status in this
file as a fact about SQL Server.

## What *is* real

The **shape**, deliberately:

- the same closed status vocabulary (`available`, `unavailable`, `conditional`, `preview`,
  `not_applicable`, `unknown`)
- the same compact matrix encoding, legend, and row-length rule
- the same environment grammar (`mssql-<year>[-<edition>]`, `azure-sql-db`, `azure-sql-mi`)
- the same sparse-data patterns observed upstream

Release names and years are public facts about Microsoft's product, not SQL.FM's curation, and
the environment grammar is defined in terms of them — so they are used as-is.

That combination is what lets the acceptance suite be meaningful evidence about production
behaviour without embedding anyone else's data.

## Coverage

Each feature exists to exercise a specific semantic edge:

| Feature | Exercises |
|---|---|
| `widget-agg` | A clean introduction boundary (unavailable → available at 2017) |
| `glyph-parse` | A later introduction (2022), for comparison ranges |
| `sparkle-compression` | **Edition restriction** — Enterprise + Developer only, so a release-level query must aggregate to `conditional` |
| `flux-capacitor-index` | **Azure divergence** — available on SQL Database, `conditional` with a note on Managed Instance |
| `quantum-replication` | **Unknown data** (`?` cells at 2025) and an **absent** Azure record, which must also read as `unknown` |
| `nimbus-cache` | **Preview** status |
| `orbit-sync` | Upstream aliases (`OS`, `OrbitSync`) |
| `zephyr-audit` | **Conditional** cloud support with explanatory note, plus a general condition |
| `prism-encrypt` | An `edition_changed` timeline event |
| `lumen-stats`, `tessellate-partition`, `beacon-restore` | Ordinary rows, category spread, and a feature unavailable in both Azure environments |

Every feature's 2000 row marks Express as `not_applicable` — the edition did not exist yet —
so the not-applicable-is-not-a-negative rule is exercised throughout.

## Regenerating

```bash
npm run build:fixture
```

`scripts/build-fixture.mjs` is the source of truth. It validates every row's length and every
code against the legend, so a hand-edit that breaks the encoding cannot slip through. CI fails
if the committed fixture differs from what the generator produces.
