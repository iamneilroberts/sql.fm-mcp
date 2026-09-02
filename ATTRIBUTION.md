# Attribution and data use

## SQL.FM

[SQL.FM](https://sql.fm/) is created and maintained by **Mike Scalise**. The SQL Server feature
matrix — the features, their support statuses, the qualifications, and the Microsoft source
links — is his work.

**This project is not affiliated with, endorsed by, or sponsored by SQL.FM or Mike Scalise.**
It is an unsolicited proposal, offered for adoption as a first-party SQL.FM component. If it is
adopted, this notice comes out because it will no longer be true.

## Microsoft

SQL.FM is itself an independent reference site and states that it is not affiliated with,
endorsed by, or sponsored by Microsoft. **Neither is this project.** SQL Server, Azure SQL
Database, and Azure SQL Managed Instance are Microsoft products. Microsoft Learn URLs carried
in the dataset are passed through unmodified so that any claim can be checked at its source.

## Permission status

**Data-use permission has not been requested or granted.** Until it is, in writing:

- **No SQL.FM data is in this repository.** `data/dataset.*.json` is gitignored, and CI fails
  the build if such a file is ever committed.
- Development and tests run entirely against **synthetic fixtures** with invented feature names
  (see `fixtures/synthetic/README.md`). Those fixtures contain no SQL.FM content.
- **No provider reads sql.fm at runtime by default.** The HTTP provider is disabled unless
  explicitly configured, and its origin allowlist is empty until an endpoint is named.
- **No scraping provider exists** — not of the HTML, not of the site's JavaScript bundle.

`https://sql.fm/robots.txt` currently disallows `GPTBot`, `ClaudeBot`, `CCBot`,
`Google-Extended` and others outright, and signals `Content-Signal: ai-train=no, use=reference`.
That is treated as the owner's expressed position and is not worked around. See
[`docs/architecture.md` §4](docs/architecture.md#4-permission-ownership-and-what-this-design-refuses-to-do).

## How attribution reaches the caller

Attribution is structural, not decorative — models drop prose, and structured fields survive
summarization:

- Every `search`, `fetch`, and `compare_feature_support` result carries `attribution`,
  `disclaimer`, and `source` fields.
- Every result carries the **canonical SQL.FM URL** (`https://sql.fm/features/{slug}/`), which
  is what ChatGPT and Claude use to cite.
- Microsoft documentation URLs are passed through as `microsoft_docs[]` on features and
  `sources[]` on individual cells and conditions.
- The server's `instructions`, returned at discovery, name the data source and the
  non-affiliation.

The attribution and disclaimer strings live in the dataset itself (`source.attribution`,
`source.disclaimer`), so the owner controls their exact wording without a code change.

## Licence

The code and documentation in this repository are MIT licensed (see `LICENSE`).

**The licence covers this repository only. It grants no rights whatsoever to SQL.FM's data or
content.** Those remain Mike Scalise's, and any use of them requires his permission.
