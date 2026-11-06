# Whereis MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) server for the
Eagle1 Whereis API. It lets an AI host list carriers, look up the latest
shipment status, and retrieve a full tracking timeline without hand-writing HTTP
calls.

The server is a thin client of the public `/v0` API. It works against
`https://api.eg1.io` or a self-hosted instance such as `http://localhost:8037`;
it does not import the API server internals.

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

## Requirements

- Deno 2.x
- A Whereis API key for `track_shipment`

## Setup

### 1. Choose the API URL

The default is the hosted API:

```bash
export WHEREIS_API_URL=https://api.eg1.io
```

For a self-hosted instance, see the
[How-to Guide](https://github.com/eagle1-sys/whereis-api-v0/wiki/How%E2%80%90to:-Local-DEV-deployment-using-docker)
and use `http://localhost:8037`.

### 2. Provide an API key

`list_operators` and `get_latest_status` work without a key. `track_shipment`
needs a **full** key.

Generate a local key from the repository (with the database available):

```bash
deno task api_key                 # prints a new sk-... key
# or, inside the Docker container:
make api-key
```

Then either export it:

```bash
export WHEREIS_API_KEY=sk-...
```

or put it in the repository's `.env` file (ignored by git):

```bash
echo "WHEREIS_API_KEY=sk-..." >> .env
```

> The seeded `eagle1` token is intentionally restricted: it can only access
> `eg1` and cannot push. Using it for `fdx`/`sfex` returns `403-01`. Generate a
> real key instead.

The server loads `.env` from its working directory by default. Set
`WHEREIS_ENV_FILE` to an absolute path when the host launches it from a
different directory, or set it to an empty string to disable file loading.
Process environment variables always win.

## Run

### stdio (local MCP hosts)

```bash
cd whereis-api-v0
deno task mcp
```

The process speaks JSON-RPC on stdout and logs to stderr. It exits when the host
closes stdin.

### Streamable HTTP

```bash
deno task mcp:http
# listening on http://127.0.0.1:8038/mcp
```

The default bind is loopback and unauthenticated. To expose it:

```bash
export MCP_HOST=0.0.0.0
export MCP_PORT=8038
export MCP_AUTH_TOKEN="$(openssl rand -hex 32)"
export MCP_ALLOWED_HOSTS=whereis-mcp.example.com
deno task mcp:http
```

The server refuses to bind a non-loopback address without both `MCP_AUTH_TOKEN`
and `MCP_ALLOWED_HOSTS`. Put it behind TLS and an authenticating reverse proxy
when exposing it beyond your machine.

Health check: `GET /healthz`.

### Mounted on the API (`/mcp`)

The API server also serves the same endpoint at `/mcp` on its own port, so a
deployment needs neither a second process nor a reverse proxy. The hosted
deployment is `https://api.eg1.io/mcp`:

```bash
curl -sS https://api.eg1.io/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

For a self-hosted stack, use `http://localhost:8037/mcp` in place of that URL.

The mounted endpoint authenticates per request instead of with a single
`MCP_AUTH_TOKEN`:

| Request                                   | Served as                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| No `Authorization` header                 | anonymous; `list_operators` and `get_latest_status` work, `track_shipment` returns a key-required error |
| `Authorization: Bearer <Whereis API key>` | that key's owner; every tool works, and the API sees the caller's own key                               |
| Unknown key                               | `401` with `WWW-Authenticate: Bearer`                                                                   |

An anonymous request never falls back to a key configured on the server, so a
hosted endpoint cannot spend the operator's quota. Set `MCP_ENABLED=false` to
leave `/mcp` unmounted, and point `WHEREIS_API_URL` at the API's own origin
(`http://localhost:8037` in the container) so the tools call it locally.

The MCP transport tears a request down on `request.signal`, and Deno's legacy
semantics abort that signal as soon as a response is returned, which can cut an
event stream short. `src/main/main.ts` therefore starts the API with
`--unstable-no-legacy-abort`, so the signal fires on a real disconnect instead.
The flag is unstable, so startup probes for it first and falls back to the
legacy semantics with a warning on a Deno build that rejects it. Starting
`src/main/api_server.ts` by hand should pass the same flag when available.

## Client configuration

Replace the absolute paths with your checkout and Deno binary
(`command -v deno`).

### Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "whereis": {
      "command": "/Users/you/.deno/bin/deno",
      "args": [
        "run",
        "--allow-env",
        "--allow-net",
        "--allow-read",
        "/Users/you/whereis-api-v0/mcp/src/stdio.ts"
      ],
      "env": {
        "WHEREIS_API_URL": "https://api.eg1.io",
        "WHEREIS_ENV_FILE": "/Users/you/whereis-api-v0/.env"
      }
    }
  }
}
```

An absolute `WHEREIS_ENV_FILE` avoids relying on the host's working directory.
If you prefer not to use a file, put `WHEREIS_API_KEY` in the `env` object
instead. Keep secrets out of files you commit.

### VS Code

`.vscode/mcp.json`:

```json
{
  "servers": {
    "whereis": {
      "type": "stdio",
      "command": "/Users/you/.deno/bin/deno",
      "args": [
        "run",
        "--allow-env",
        "--allow-net",
        "--allow-read",
        "mcp/src/stdio.ts"
      ],
      "cwd": "/Users/you/whereis-api-v0"
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json` uses the same shape as the Claude Desktop example.

### DeepSeek Harness

Create a small configuration-only bundle with the `@deepseek-ai/dsh-mcp-client`
plugin. The server command and `cwd` point at your checkout; the key comes from
the repository `.env`, and the timeout is raised because `refresh=true` can take
longer than the 60-second default:

```yaml
- insert:
    - id: whereis-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: whereis
        transport: stdio
        command: /Users/you/.deno/bin/deno
        args: [
          "run",
          "--allow-env",
          "--allow-net",
          "--allow-read",
          "mcp/src/stdio.ts",
        ]
        cwd: /Users/you/whereis-api-v0
        env:
          WHEREIS_API_URL: https://api.eg1.io
        toolCallTimeoutMs: 120000
        failOnStartupError: true
```

Install it with `plugin_manager` (`install_bundle`) and look for
`mcp__whereis__list_operators` / `mcp__whereis__track_shipment`.

For a shared HTTP server instead, use `transport: streamable-http`,
`url: http://127.0.0.1:8038/mcp`, and an `Authorization` header carrying
`MCP_AUTH_TOKEN`.

### HTTP clients

```json
{
  "mcpServers": {
    "whereis": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:8038/mcp",
      "headers": { "Authorization": "Bearer <MCP_AUTH_TOKEN>" }
    }
  }
}
```

## Configuration

| Variable                     | Default              | Meaning                                                                  |
| ---------------------------- | -------------------- | ------------------------------------------------------------------------ |
| `WHEREIS_API_URL`            | `https://api.eg1.io` | API origin; may include a path prefix; http/https only                   |
| `WHEREIS_API_KEY`            | none                 | Bearer token; required for `track_shipment` and push                     |
| `WHEREIS_ENV_FILE`           | `.env`               | Optional dotenv path; empty string disables file loading                 |
| `WHEREIS_TIMEOUT_MS`         | `30000`              | Normal upstream timeout                                                  |
| `WHEREIS_REFRESH_TIMEOUT_MS` | `90000`              | Timeout when `refresh=true`                                              |
| `WHEREIS_MAX_EVENTS`         | `500`                | Timeline truncation cap (oldest events are omitted)                      |
| `MCP_HOST`                   | `127.0.0.1`          | HTTP bind address                                                        |
| `MCP_PORT`                   | `8038`               | HTTP port                                                                |
| `MCP_AUTH_TOKEN`             | none                 | Bearer gate for `/mcp`; required for non-loopback binds                  |
| `MCP_ALLOWED_HOSTS`          | none                 | Comma-separated DNS-rebinding allowlist; required for non-loopback binds |
| `WHEREIS_MCP_ENABLE_WRITE`   | `false`              | Enables `push_tracking_events`                                           |
| `MCP_LOG_LEVEL`              | `info`               | `debug`, `info`, `warn`, or `error`; logs go to stderr                   |

The flag is read in the process that runs the MCP code, so it goes where that process starts:

| Where the MCP server runs                | How                                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Inside the API container (DEV)           | `environment:` in the Compose file `make` picks by `DB_TYPE`: `docker-compose.yaml` for sqlite, `docker-compose-pg.yaml` for postgres |
| QA / PROD (Fly.io, `/mcp` on the API)    | `fly secrets set WHEREIS_MCP_ENABLE_WRITE=true -a <app>`; survives a redeploy                          |
| Standalone (`deno task mcp`, `mcp:http`) | In that process's environment or its `.env`. Compose and Fly settings never reach it                   |

## Security

- The API key is never a tool argument and is never logged. It is sent only to
  `WHEREIS_API_URL`.
- The HTTP transport binds loopback by default. A public bind requires
  `MCP_AUTH_TOKEN` and `MCP_ALLOWED_HOSTS`; the adapter also validates `Host`
  and `Origin` to prevent DNS rebinding.
- The write tool is off by default. If you enable it, it always targets the
  `eg1` operator and still requires a full API key.
- `.env` is covered by the repository's `*.env` ignore rule. Do not commit it.

## Troubleshooting

| Symptom                           | Fix                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `401-01`                          | Set `WHEREIS_API_KEY`, or point `WHEREIS_ENV_FILE` at the right `.env`                                 |
| `401-02`                          | The key is invalid or was copied incorrectly                                                           |
| `403-01`                          | The key is the restricted `eagle1` token; generate a full key with `deno task api_key`                 |
| `404-01`                          | The carrier has no data for this ID; verify it, or it may be older than the carrier's retention window |
| `404-03`                          | `eg1` is push-only; it has no carrier history                                                          |
| “SF Express requires phone_last4” | Pass the recipient's last four phone digits                                                            |
| `refresh=true` times out          | Carrier pulls can be slow; retry later or use `get_latest_status`                                      |
| HTTP `403` from the MCP endpoint  | Use a hostname listed in `MCP_ALLOWED_HOSTS`; the default check is for localhost                       |
| Tools do not appear               | Check the host's MCP logs; in stdio mode, any `console.log` corrupts the protocol                      |

## Development

```bash
deno task check      # lint + type check
deno task mcp:test   # unit, in-memory, HTTP, and stdio tests
make test            # the API suite and the MCP suite, both in the container
```

The tests use an injected fetch and a local mock API; they do not need a real
API key or network access to `api.eg1.io`.

## Limitations

- Read-only by default; raw `fulldata` payloads are not exposed (call the HTTP
  API directly if you need carrier payloads).
- No pagination or bulk tracking; the timeline is capped by
  `WHEREIS_MAX_EVENTS`.
- The HTTP transport uses a static bearer token, not OAuth 2.1.
- The package is experimental and not published to JSR/npm.
