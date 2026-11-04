# Eagle1 Whereis API
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/eagle1-sys/whereis-api-v0)

## Goal
Built for developers. Fully open-source. Track any shipment with one simple API.

### Problem
Since different logistics providers have their own APIs and data formats, integrating various logistics data poses a significant challenge for app developers.

### Why we built this
During COVID, we wanted to systematically track critical packages containing masks without checking each carrier's website manually. We learned that integrating with various logistics carriers was nearly impossible. It took way too much time and brain cells to understand and connect their APIs. Thus, we are fixing it the open-source way. Now we can help ourselves and fellow developers stay prepared for the next global supply chain event.

## Design
1. This prototype is written in TypeScript and runs on the [Deno runtime](https://deno.com).
2. We have defined [standard status codes](metadata/status-codes.jsonc) and a consistent format for global logistics data.
3. Initially it supports two logistics operators: FedEx and SF Express, with a [future roadmap](https://github.com/eagle1-sys/whereis-api-v0/discussions/97) planned. Code review is on [DeepWiki](https://deepwiki.com/eagle1-sys/whereis-api-v0).

### Intentions
- **Beyond Simple Mapping**: Transform raw carrier data into meaningful, standardized information.
- **Developer-Centric**: Provide consistent, easy-to-understand API responses.
- **Continuous Improvement**: Mapping rules evolve based on real-world data patterns via a two-stage process: (Stage 1: rule-based mapping; Stage 2: AI-assisted enhancement).

### Documentation
- [Wiki](https://github.com/eagle1-sys/whereis-api-v0/wiki)
- [Real-world use case](https://github.com/orgs/eagle1-sys/discussions/429#discussioncomment-16349481)

## Examples

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

## MCP server (experimental)

The `mcp/` directory exposes the tracking API as
[Model Context Protocol](https://modelcontextprotocol.io) tools so AI hosts
(Claude Desktop, VS Code, Cursor, DeepSeek Harness) can track shipments directly.

Tools: `list_operators`, `get_latest_status`, and `track_shipment`, plus a
`whereis://reference/status-codes` resource. The tool set is read-only by
default. An extra write tool, `push_tracking_events`, appears only when
`WHEREIS_MCP_ENABLE_WRITE=true`; it pushes events for the `eg1` operator
through `POST /v0/push/eg1`, which is a separate REST route gated by an API
key and unaffected by that flag.

```bash
# Put a full API key in .env (gitignored) or export it:
echo "WHEREIS_API_KEY=sk-..." >> .env

deno task mcp        # stdio, for local MCP hosts
deno task mcp:http   # Streamable HTTP on http://127.0.0.1:8038/mcp
```

The API server also serves the endpoint at `/mcp` on its own port, so a running
stack needs no extra process:

```bash
curl -sS http://localhost:8037/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Requests without a key get the public tools; `Authorization: Bearer <key>` runs
the tools as that key's owner. The server's own `WHEREIS_API_KEY` is never used
for anonymous requests on this endpoint; it only seeds the local servers above.
Set `MCP_ENABLED=false` to turn the endpoint off.

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
