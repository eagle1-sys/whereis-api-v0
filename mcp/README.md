# Whereis MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) server for the
Eagle1 Whereis API. It lets an AI host list carriers, look up the latest
shipment status, and retrieve a full tracking timeline without hand-writing HTTP
calls.

The server runs inside the API container and listens on the API's own port, so
there is no second process to start:

```
http://localhost:8037/mcp
```

The hosted deployment serves the same path at `https://api.eg1.io/mcp`.

## Tools

| Tool                   | Endpoint               | API key      | Purpose                                                                        |
| ---------------------- | ---------------------- | ------------ | ------------------------------------------------------------------------------ |
| `list_operators`       | `GET /v0/operators`    | not required | Resolve a carrier name to the `fdx` / `sfex` / `eg1` code used in tracking IDs |
| `get_latest_status`    | `GET /v0/status/{id}`  | not required | Cheapest lookup: current status and last known location                        |
| `track_shipment`       | `GET /v0/whereis/{id}` | required     | Full event timeline; `refresh=true` forces a carrier pull                      |
| `push_tracking_events` | `POST /v0/push/eg1`    | required     | Opt-in write tool, enabled only with `WHEREIS_MCP_ENABLE_WRITE=true`           |

Plus one resource: `whereis://reference/status-codes` (Eagle1 status and
exception codes).

Tracking IDs use the form `<operator>-<tracking_number>`, for example
`fdx-888877776666` or `sfex-SF1234123412341`. SF Express requires `phone_last4`,
the last four digits of the recipient's phone number.

## Before you start

- The local container is running and healthy: `make start`, or `make whereis` the
  first time. See the
  [How-to Guide](https://github.com/eagle1-sys/whereis-api-v0/wiki/How%E2%80%90to:-Local-DEV-deployment-using-docker).
- An API key, if you want `track_shipment`.

## Create an API key

`list_operators` and `get_latest_status` work without a key. `track_shipment`
needs a **full** key. Make it inside the container — that is the database the API
uses:

```bash
make api-key                        # prints a new sk-... key
make api-key ARGS="--user=alice"    # store it under a name
```

Then send it from the client with every request, as `Authorization: Bearer sk-...`.
The container's own environment does not need it.

A key is only valid on the server that made it: a key from the local container is
rejected by `api.eg1.io` and `api.eagl.io`, which issue their own.

> The seeded `eagle1` token is intentionally restricted: it can only access
> `eg1` and cannot push. Using it for `fdx`/`sfex` returns `403-01`. Generate a
> real key instead.

## Connect a host

Point the host at `http://localhost:8037/mcp`. This is the shape Claude Code
(`.mcp.json`) and Cursor (`~/.cursor/mcp.json`) read:

```json
{
  "mcpServers": {
    "whereis": {
      "type": "http",
      "url": "http://localhost:8037/mcp",
      "headers": { "Authorization": "Bearer sk-..." }
    }
  }
}
```

VS Code uses the same object under a top-level `servers` key. Drop the `headers`
line to stay anonymous. Claude Desktop's config file only takes servers it can
spawn itself, so it cannot use this block.

Each request is authenticated on its own:

| Request                                   | Served as                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| No `Authorization` header                 | anonymous; `list_operators` and `get_latest_status` work, `track_shipment` returns a key-required error |
| `Authorization: Bearer <full key from this server>` | runs as that key's owner, and the API sees the caller's own key. A restricted `eagle1` key reaches only `eg1`; the write tool also needs the flag |
| Unknown key                               | `401` with `WWW-Authenticate: Bearer`                                                                   |

Smoke test:

```bash
curl -sS http://localhost:8037/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Write tool (opt-in)

`push_tracking_events` appears only when the container starts with
`WHEREIS_MCP_ENABLE_WRITE=true` **and** the call carries a full API key. It writes
only to the `eg1` operator and ignores duplicate events.

| Environment           | How                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| DEV (local container) | `WHEREIS_MCP_ENABLE_WRITE: "true"` in the `environment:` block of the Compose file `make` picks by `DB_TYPE` |
| QA / PROD (Fly.io)    | `fly secrets set WHEREIS_MCP_ENABLE_WRITE=true -a <app>`; survives a redeploy                          |

## Container settings

Set these in the Compose file's `environment:` block:

| Variable                     | Default              | Meaning                                          |
| ---------------------------- | -------------------- | ------------------------------------------------ |
| `WHEREIS_API_URL`            | `https://api.eg1.io` | origin the tools call                            |
| `WHEREIS_MCP_ENABLE_WRITE`   | `false`              | enables `push_tracking_events`                   |
| `MCP_ENABLED`                | `true`               | `false` leaves `/mcp` unmounted                  |
| `WHEREIS_TIMEOUT_MS`         | `30000`              | normal upstream timeout                          |
| `WHEREIS_REFRESH_TIMEOUT_MS` | `90000`              | timeout when `refresh=true`                      |
| `WHEREIS_MAX_EVENTS`         | `500`                | timeline truncation cap (oldest events omitted)  |

The Compose samples point `WHEREIS_API_URL` at the container itself
(`http://localhost:8037`, or `http://whereis-api-v0:8037` with postgres), so the
tools call the local API instead of the hosted one. Clients need only the URL;
the key travels in the `Authorization` header.

## Security

- The API key is never a tool argument and is never logged.
- The key set in the container is not used for endpoint requests; each request
  brings its own, so an anonymous caller never spends the operator's quota.
- The write tool is off by default. If you enable it, it always targets the
  `eg1` operator and still requires a full API key.
- A key is only valid on the server that issued it.

## Troubleshooting

| Symptom                           | Fix                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `401-01`                          | Send `Authorization: Bearer <key>`; `track_shipment` needs a key                                       |
| `401-02`                          | The key is invalid, or it was made on a different server. The local container, `api.eg1.io` and `api.eagl.io` each have their own keys |
| `403-01`                          | The key is the restricted `eagle1` token; make a full one with `make api-key`                          |
| `404-01`                          | The carrier has no data for this ID; verify it, or it may be older than the carrier's retention window |
| `404-03`                          | `eg1` is push-only; it has no carrier history                                                          |
| “SF Express requires phone_last4” | Pass the recipient's last four phone digits                                                            |
| `refresh=true` times out          | Carrier pulls can be slow; retry later or use `get_latest_status`                                      |
| Nothing answers on 8037           | Start the container with `make start`; check the log for `MCP endpoint mounted`                        |

## Development

```bash
make test    # the API suite and the MCP suite, both in the container
```

The tests use an injected fetch and a local mock API; they do not need a real API
key.

## Limitations

- Read-only by default; raw `fulldata` payloads are not exposed (call the HTTP API
  directly if you need carrier payloads).
- No pagination or bulk tracking; the timeline is capped by `WHEREIS_MAX_EVENTS`.
- The package is experimental and not published to JSR/npm.
