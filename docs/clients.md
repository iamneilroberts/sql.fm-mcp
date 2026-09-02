# Connecting a client

The server speaks **Streamable HTTP at `/mcp`** (MCP `2026-07-28`, with stateless compatibility
for 2025-era clients), and also runs over **stdio** for local use.

Everything below serves **synthetic fixture data**. See
[`ATTRIBUTION.md`](../ATTRIBUTION.md) for why.

---

## Local development

```bash
npm install

# stdio — the fastest loop, no network, no deploy
npm run dev:stdio

# local HTTP on the workerd runtime (the same runtime as production)
npm run dev            # serves http://localhost:8787/mcp and /health
```

`npm run dev` runs `wrangler dev`, so the local server is the production runtime rather than a
Node approximation of it.

Check it is alive:

```bash
curl -s http://localhost:8787/health | jq
```

```json
{
  "status": "ok",
  "dataset": {
    "schema_version": "1.0.0",
    "dataset_version": "synthetic-fixture-1",
    "source_kind": "local",
    "stale": false,
    "synthetic": true,
    "feature_count": 12,
    "environment_count": 42
  },
  "server": { "name": "sqlfm-mcp", "version": "0.1.0" }
}
```

`"synthetic": true` is the signal that this deployment is **not** serving real data. A
first-party deployment reports `false`.

---

## MCP Inspector

The fastest way to see the tools, their schemas, and their annotations.

**Over stdio:**

```bash
npx @modelcontextprotocol/inspector npx tsx src/stdio.ts
```

**Over HTTP** (with `npm run dev` running in another terminal):

```bash
npx @modelcontextprotocol/inspector
```

then in the UI choose **Streamable HTTP** and enter `http://localhost:8787/mcp`.

What to check:

- **Tools** lists exactly `search`, `fetch`, `compare_feature_support` — in that order.
- Each shows a title, a description, an input schema, an output schema, and
  `readOnlyHint: true`.
- **Resources** lists `sqlfm://environments`, `sqlfm://categories`, `sqlfm://dataset/meta`.
- Calling `search` with `{"query": "widget-agg"}` returns both `structuredContent` and a
  JSON-encoded text block.

---

## Claude

### Claude Code (CLI)

Remote:

```bash
claude mcp add --transport http sqlfm https://<your-worker>.workers.dev/mcp
```

Local stdio:

```bash
claude mcp add sqlfm -- npx tsx /absolute/path/to/sql.fm-mcp/src/stdio.ts
```

### Claude Desktop / claude.ai

Add a **custom connector** in settings and give it the server URL, ending in `/mcp`. The URL
must be publicly reachable over HTTPS — Claude connects from Anthropic's infrastructure, not
from your machine, so `localhost` will not work for a hosted connector. Use MCP Inspector or
Claude Code for local testing.

For a local stdio server in Claude Desktop, add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sqlfm": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/sql.fm-mcp/src/stdio.ts"]
    }
  }
}
```

Try: *"Does SQL Server 2019 Standard support sparkle compression?"* — with fixtures loaded,
the answer should be **no for Standard, yes for Enterprise**, not a release-level yes/no.

---

## ChatGPT

Add the server as a **custom connector / MCP server** in settings, using the `/mcp` URL over
public HTTPS.

The server satisfies OpenAI's deep-research contract:

- `search` takes a single required `query` string.
- `fetch` takes a single required `id` string.
- Both return `structuredContent` **and** a JSON-encoded `content[0].text`.
- Search results carry `id`, `title`, and `url`, so ChatGPT can cite them.

The optional filters on `search` are additive: deep research omits them and the tool behaves
exactly as the contract expects. `compare_feature_support` is visible in developer mode; deep
research uses only `search` and `fetch`.

---

## Codex

Add to `~/.codex/config.toml`:

```toml
# Remote
[mcp_servers.sqlfm]
url = "https://<your-worker>.workers.dev/mcp"

# Or local stdio
[mcp_servers.sqlfm]
command = "npx"
args = ["tsx", "/absolute/path/to/sql.fm-mcp/src/stdio.ts"]
```

---

## Raw HTTP

Useful for debugging. Under `2026-07-28` there is no `initialize` handshake — every request
carries its own protocol version and client capabilities in `_meta`, and the `Mcp-Method`
header must agree with the body.

```bash
curl -s http://localhost:8787/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'mcp-method: tools/list' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {
      "_meta": {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": { "name": "curl", "version": "0" }
      }
    }
  }' | jq '.result.tools[].name'
```

A `tools/call` additionally needs `Mcp-Name` naming the tool:

```bash
curl -s http://localhost:8787/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'mcp-method: tools/call' -H 'mcp-name: compare_feature_support' \
  -d '{
    "jsonrpc": "2.0", "id": 2, "method": "tools/call",
    "params": {
      "name": "compare_feature_support",
      "arguments": {
        "id": "sparkle-compression",
        "environments": ["mssql-2019-standard", "mssql-2019-enterprise", "azure-sql-db"]
      },
      "_meta": {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {}
      }
    }
  }' | jq '.result.structuredContent.rows[] | {environment, status}'
```

---

## Manual compatibility matrix

Automated tests assert the tool *shapes* these clients require
(`test/e2e/discovery.test.ts`), but real client behaviour cannot be fully asserted in CI.
Re-run this by hand after any change to tool names, schemas, or annotations, and after an SDK
major bump.

| Client | Transport | Check | Verified |
|---|---|---|---|
| MCP Inspector | stdio | tools, resources, schemas, annotations render | ☐ |
| MCP Inspector | Streamable HTTP | same, plus `/health` | ☐ |
| Claude Code | HTTP | `claude mcp add`, then an edition-specific question | ☐ |
| Claude Desktop | HTTP connector | tool discovery, citation of the canonical URL | ☐ |
| ChatGPT | HTTP connector | `search` + `fetch` accepted; deep research cites sql.fm URLs | ☐ |
| Codex | stdio and HTTP | tool discovery and a comparison call | ☐ |

These boxes are unticked because the server has not been deployed to a public URL yet — that
needs an account and, for real data, the owner's permission.
