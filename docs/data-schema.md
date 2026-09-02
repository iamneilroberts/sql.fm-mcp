# `dataset.v1` — the dataset contract

Machine-readable schema: [`schemas/dataset.v1.schema.json`](../schemas/dataset.v1.schema.json),
generated from the Zod schema in `src/providers/validate.ts`. **The Zod schema is the single
source of truth** — it validates at runtime and produces the published JSON Schema, so the two
cannot drift. CI fails if the committed file is stale.

This page is for whoever writes the generator. The design rationale is in
[architecture.md §7](architecture.md#7-normalized-feature-data-schema-datasetv1).

## The one rule that matters

```
available | unavailable | conditional | preview | not_applicable | unknown
```

**`unknown` and `not_applicable` are not negatives.**

- `unknown` = the answer has not been recorded. Absence of data.
- `not_applicable` = the environment did not exist in that release (Express before 2005, say).
  A statement about history.

Neither may be emitted, aggregated, or defaulted as `unavailable`. There is deliberately no
boolean `supported` field anywhere in the contract — there is nothing to coerce to. A property
test over randomized datasets asserts the invariant end to end
(`test/property/no-gap-as-unavailable.test.ts`).

If a generator does not know a value, it must emit `unknown` or omit the record. It must never
emit `unavailable` as a default.

## Structure

```jsonc
{
  "schema_version": "1.0.0",       // semver of THIS contract; the server accepts 1.x only
  "dataset_version": "...",        // opaque upstream build id
  "generated_at": "2026-09-02T14:00:00Z",   // or null

  "source": {
    "name": "SQL.FM",
    "url": "https://sql.fm/",
    "feature_url_template": "https://sql.fm/features/{slug}/",
    "attribution": "...",          // returned verbatim on every tool result
    "disclaimer": "..."            // returned verbatim on every tool result
  },

  "releases":      [{ "id": "mssql-2019", "name": "SQL Server 2019", "major": "15.0", "year": 2019, "sort": 180 }],
  "editions":      [{ "id": "standard", "name": "Standard", "sort": 10 }],
  "cloud_targets": [{ "id": "azure-sql-db", "name": "Azure SQL Database", "short": "Azure SQL DB", "docs": "https://…", "sort": 10 }],
  "categories":    [{ "id": 9, "name": "String Functions", "parent_id": 1, "parent_name": "Functions", "sort": 11 }],

  "support_matrix": { /* see below */ },
  "features":      [ /* see below */ ]
}
```

`attribution` and `disclaimer` live in the data, not the code, so the owner controls their exact
wording without a code change.

### Environments are derived, not stored

The server derives the full environment registry from `releases`, `editions`, and
`cloud_targets`:

| Form | Example |
|---|---|
| `<release.id>` | `mssql-2019` — the release as a whole, aggregated across editions |
| `<release.id>-<edition.id>` | `mssql-2019-standard` |
| `<cloud_target.id>` | `azure-sql-db`, `azure-sql-mi` |

For 19 releases and 4 editions that is `19 × 5 + 2 = 97` addressable environments. Deriving
rather than storing means the environment list and `support_matrix.release_order` cannot drift
apart. Generators do not emit an `environments` array.

### `support_matrix`

SQL.FM's compact encoding, preserved — it is small and it decodes trivially.

```jsonc
{
  "encoding": "compact-v1",
  "legend": { "a": "available", "u": "unavailable", "n": "not_applicable", "?": "unknown", "p": "preview" },
  "release_order": ["mssql-2000", "…", "mssql-2025"],
  "edition_order": ["standard", "enterprise", "developer", "express"],
  "rows": { "string-agg": "uuun…aaaa" }
}
```

- One row per feature, keyed by feature id.
- Row length **must** be exactly `release_order.length × edition_order.length`. Validation
  rejects anything else rather than silently decoding short rows to `unknown`.
- Cell `(r, e)` is at index `r * edition_order.length + e`.
- Every character **must** appear in `legend`.
- `legend` is in-band so the file is self-describing; the codes above are the current ones but
  the server reads the legend rather than assuming them.
- Every `release_order` entry must name a declared release.

### `features[]`

```jsonc
{
  "id": "string-agg",              // the slug: stable public id AND the canonical URL segment
  "upstream_id": 5,                // or null; retained for traceability
  "name": "STRING_AGG",
  "slug": "string-agg",
  "url": "https://sql.fm/features/string-agg/",
  "type": "function",
  "category": { "id": 11, "name": "Aggregate Functions", "parent_name": "Functions" },
  "summary": "Concatenates row values with a separator.",
  "aliases": [],
  "microsoft_docs": ["https://learn.microsoft.com/…"],

  "cloud_support": {
    "azure-sql-db": { "status": "available", "note": null, "sources": ["https://…"] }
  },

  "timeline":  [{ "event": "introduced", "environment": "mssql-2017", "edition": null, "summary": "…", "source": null }],
  "conditions":[{ "environment": null, "edition": null, "note": "…", "source": "https://…" }],

  "requirements": { "compatibility_level": null, "platform": null, "other": [] },
  "attributes": []                 // opaque passthrough; not interpreted
}
```

Notes for generators:

- **`id` must equal `slug`**, and must match `^[a-z0-9][a-z0-9-]{0,63}$`. Making the slug the
  public id is what lets `search` → `fetch` → citation round-trip with no lookup table.
- **Omit a `cloud_support` key you have no data for.** An absent entry reads as `unknown`,
  which is correct. Do not write `"unavailable"` to fill a hole.
- `note` on a `conditional` cloud status is treated as *the condition*. On any other status it
  is context that does not narrow the answer.
- `conditions[]` with `environment: null` apply everywhere; otherwise they are scoped to a
  release (or cloud) id and optionally an edition.
- `requirements.compatibility_level` is **`null` for every record in the current upstream
  data** — the concept is not recorded there. The field is reserved so it can be populated
  without a schema change, and the server reports "not recorded in SQL.FM" rather than
  inventing a value. This is open question Q4.
- All URLs must be absolute `https`. Non-`https` URLs are **dropped** on ingest, not passed
  through, so a poisoned record cannot become a hostile citation.

## Sanitization on ingest

Every free-text field is sanitized when the dataset loads, once, so no render path can emit
raw upstream text: control characters, ANSI escapes, bidirectional overrides, and zero-width
characters are removed, and fields are length-capped. Words and punctuation are untouched —
factual content is preserved exactly.

## Versioning

`schema_version` is semver over this contract.

- **Minor** — additive fields. Older servers ignore what they do not know.
- **Major** — anything a consumer could break on. The server **refuses** a non-`1.x` dataset
  with a clear error rather than misreading it. On the HTTP provider that means the previous
  dataset is kept and `stale: true` is flagged — a bad upstream file can degrade freshness, but
  never corrupt live answers.

Tool output schemas are versioned independently, so the dataset can gain fields without moving
the MCP contract.

## Validating

```bash
npm run validate:dataset -- path/to/dataset.v1.json
```

Checks the schema plus the cross-checks it cannot express: row lengths, legend coverage,
release references, duplicate ids, orphaned matrix rows, and non-`https` documentation URLs.
