# Eagle1 Whereis API + MCP

Track any shipment with one simple API — or let an AI agent do it over MCP.

## Goal
Built for developers and AI agents. Fully open-source. Track any shipment with one simple API or MCP.

### Problem
Since different logistics providers have their own APIs and data formats, integrating various logistics data poses a significant challenge for app developers.

### Why we built this
During COVID, we wanted to systematically track critical packages containing masks without checking each carrier's website manually. We learned that integrating with various logistics carriers was nearly impossible. It took way too much time and brain cells to understand and connect their APIs. Thus, we are fixing it the open-source way. Now we can help ourselves and fellow developers stay prepared for the next global supply chain event.

## Design
1. This prototype is written in TypeScript and runs on the [Deno runtime](https://deno.com).
2. We have defined [standard status codes](metadata/status-codes.jsonc) and a consistent format for global logistics data.
3. Initially it supports two logistics operators: FedEx and SF Express, with a [future roadmap](https://github.com/eagle1-sys/whereis-api-v0/discussions/97) planned. Code review is on [DeepWiki](https://deepwiki.com/eagle1-sys/whereis-api-v0).
4. By default, every deployment also serves a [Model Context Protocol](https://modelcontextprotocol.io) endpoint at `/mcp`, so the same tracking tools work in AI hosts (Claude Desktop, VS Code, Cursor, DeepSeek Harness) without a second service.

### Intentions
- **Beyond Simple Mapping**: Transform raw carrier data into meaningful, standardized information.
- **Developer-Centric**: Provide consistent, easy-to-understand API responses.
- **Continuous Improvement**: Mapping rules evolve based on real-world data patterns via a two-stage process: (Stage 1: rule-based mapping; Stage 2: AI-assisted enhancement).

### Documentation
- [Wiki](https://github.com/eagle1-sys/whereis-api-v0/wiki)
- [Real-world use case](https://github.com/orgs/eagle1-sys/discussions/429#discussioncomment-16349481)

## Two ways to use it

| Surface    | Endpoint                 |
| ---------- | ------------------------ |
| REST API   | `https://api.eg1.io/v0`  |
| Hosted MCP | `https://api.eg1.io/mcp` |

Both share the same [standard status codes](metadata/status-codes.jsonc), and the MCP tools call the same `/v0` routes. The payload shape differs: the REST API returns `{entity, events}`, whereas `track_shipment` flattens it into a single object — shipment fields at the top level, `additional` fields hoisted into each event, and `eventCount` / `truncated` / `omittedEventCount` beside `events`. Both are open source and self-hostable: `make whereis` runs the API with `/mcp` mounted.

## API keys

- `list_operators` and the latest status are public. No key needed.
- Everything else needs one, including `/v0/whereis/{id}`, `track_shipment`,
  and `POST /v0/push/{operator}`. Send it as `Authorization: Bearer <key>`.
- A key only works on the server that made it. `api.eg1.io` and `api.eagl.io`
  issue their own.
- In the local container, make one with `make api-key`.

## Examples

### Track from an AI host (MCP)

Point an MCP-capable host at the hosted server:

```json
{
  "mcpServers": {
    "whereis": {
      "type": "http",
      "url": "https://api.eg1.io/mcp"
    }
  }
}
```

Then ask "Where is fdx-888877776666?" and the host calls `get_latest_status`. `sfex-…` IDs also need the recipient's last four phone digits. See [mcp/README.md](mcp/README.md) for per-client setup.

### Track locations over time

#### cURL
```shell
curl https://api.eg1.io/v0/whereis/{{trackingID}} -H "Authorization: Bearer YOUR-TOKEN"
```

> ***{{trackingID}}*** uses the structure `operatorCode-trackingNum`. Example: a FedEx trackingID is `fdx-888877776666`.

#### TypeScript
```TypeScript
const url = "https://api.eg1.io/v0/whereis/{{trackingID}}";
const response = await fetch(url, {
  method: "GET",
  headers: {
    Authorization: "Bearer YOUR-TOKEN",
  },
});
```

#### Response (consistent format for all logistics providers)
```JSON
{
  "entity": {
    "id": "fdx-888877776666",
    "type": "waybill",
    "uuid": "37ebed64-f8fb-457b-be21-5df1f519fbc4",
    "createdAt": "2024-11-11T14:16:48-06:00",
    "additional": {
      "origin": "San Francisco CA United States",
      "destination": "CENTRAL  Hong Kong SAR, China",
      "isCrossBorder": true,
      "processingTimeMs": 3.7
    }
  },
  "events": [{
    "status": 3000,
    "what": "Transport Bill Created",
    "whom": "FedEx",
    "when": "2024-11-11T14:16:48-06:00",
    "where": "Customer location",
    "notes": "Shipment information sent to FedEx",
    "additional": {
      "trackingNum": "888877776666",
      "operatorCode": "fdx",
      "dataProvider": "FedEx",
      "updateMethod": "manual-pull",
      "updatedAt": "2025-02-20T12:23:43.892Z"
    }
  }]
}
```

---

### The latest status and location

#### cURL
```shell
curl https://api.eg1.io/v0/status/{{trackingID}}
```

#### TypeScript
```TypeScript
const url = 'https://api.eg1.io/v0/status/{{trackingID}}';
const response = await fetch(url, {
  method: "GET"
});
```

#### Response
```json
{
  "id": "fdx-888877776666",
  "status": 3000,
  "what": "Transport Bill Created",
  "whom": "FedEx",
  "when": "2024-11-11T14:16:48-06:00",
  "where": "Customer location",
  "notes": "Shipment information sent to FedEx"
}
```

---

## MCP server

The hosted endpoint is `https://api.eg1.io/mcp`. The `mcp/` directory exposes the same tracking API as [Model Context Protocol](https://modelcontextprotocol.io) tools, so AI hosts (Claude Desktop, VS Code, Cursor, DeepSeek Harness) can track shipments directly. The local container serves the same endpoint at `http://localhost:8037/mcp`.

Tools: `list_operators`, `get_latest_status`, and `track_shipment`, plus a
`whereis://reference/status-codes` resource. The tool set is read-only by
default. `push_tracking_events` is the one write tool: it appears only when
`WHEREIS_MCP_ENABLE_WRITE=true` and the request sends a key, and it pushes
events for the `eg1` operator through `POST /v0/push/eg1`, a separate REST
route unaffected by that flag.

The API server also serves the endpoint at `/mcp` on its own port, so a running
stack needs no extra process:

```bash
curl -sS https://api.eg1.io/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

For a self-hosted stack, use `http://localhost:8037/mcp` in place of that URL, and
set `MCP_ENABLED=false` to turn the endpoint off.

See [mcp/README.md](mcp/README.md) for client configuration, self-hosting, and
security notes.

---

# Getting started

There are only three commands to deploy locally with Docker! Detailed, step-by-step instructions can be found in the [How-to Guide](https://github.com/eagle1-sys/whereis-api-v0/wiki/How%E2%80%90to:-Local-DEV-deployment-using-docker).

```bash
git clone https://github.com/eagle1-sys/whereis-api-v0
cd whereis-api-v0
make whereis
```

That's it. Enjoy!

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the branch, review, and
deployment workflow.
