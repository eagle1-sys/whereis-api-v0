/**
 * @file mount.ts
 * @description Mounts the Whereis MCP endpoint onto an existing Hono app.
 *
 * `http.ts` owns a listener of its own and refuses to bind a non-loopback
 * address without a token. This module covers the opposite deployment: the
 * Whereis API already listens and terminates TLS, so the MCP endpoint is
 * mounted at `/mcp` next to `/v0/*` and authenticated per request with a
 * Whereis API key.
 *
 * A request without an `Authorization` header is served anonymously, which
 * keeps the public status lookup and the operator list available. A request
 * carrying a key is validated by the caller-supplied `authenticate` hook, and
 * that same key is forwarded to the API so tools act as the calling principal.
 * An anonymous request never inherits a key configured on the host.
 *
 * @copyright (c) 2026, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import {
  createMcpHandler,
  DEFAULT_MAX_REQUEST_BODY_SIZE,
  isJsonContentType,
  readRequestBody,
} from "@modelcontextprotocol/server";
import type { Context, Hono, Next } from "hono";
import type { McpConfig } from "./config.ts";
import { createMcpServer } from "./server.ts";
import { HttpWhereisBackend, type WhereisBackend } from "./whereis-client.ts";

const BEARER_PREFIX = "Bearer ";
const PAYLOAD_TOO_LARGE = -32000;

/** Hono context variables as written by the MCP JSON body middleware. */
interface BodyVariables {
  get(key: "parsedBody"): unknown;
  set(key: "parsedBody", value: unknown): void;
}

/** Result of reading the `Authorization` header of an incoming request. */
type Authorization =
  | { kind: "anonymous" }
  | { kind: "authorized"; token: string }
  | { kind: "rejected" };

function parseAuthorization(header: string | undefined): Authorization {
  if (header === undefined || header.trim().length === 0) {
    return { kind: "anonymous" };
  }
  if (!header.startsWith(BEARER_PREFIX)) return { kind: "rejected" };

  const token = header.slice(BEARER_PREFIX.length).trim();
  if (token.length === 0) return { kind: "rejected" };

  return { kind: "authorized", token };
}

/**
 * Parses a JSON request body into `c.get("parsedBody")`, mirroring what
 * `createMcpHonoApp` installs. Parsing a clone leaves the original stream
 * readable for the transport.
 */
function jsonBodyMiddleware(maxBytes: number) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const variables = c as unknown as BodyVariables;
    if (variables.get("parsedBody") !== undefined) return await next();
    if (!isJsonContentType(c.req.header("content-type"))) return await next();

    try {
      const body = await readRequestBody(c.req.raw.clone(), maxBytes);
      if (body.tooLarge) {
        return c.json({
          jsonrpc: "2.0",
          error: {
            code: PAYLOAD_TOO_LARGE,
            message:
              `Payload Too Large: Request body must not exceed ${maxBytes} bytes`,
          },
          id: null,
        }, 413);
      }
      variables.set("parsedBody", JSON.parse(body.text));
    } catch {
      return c.text("Invalid JSON", 400);
    }

    return await next();
  };
}

function unauthorized(c: Context): Response {
  c.header("WWW-Authenticate", 'Bearer realm="whereis-mcp"');
  return c.text("Unauthorized", 401);
}

/** Options for {@link mountMcp}. */
export interface MountMcpOptions {
  /** Base configuration; the per-request API key overrides `config.apiKey`. */
  config: McpConfig;
  /** Path to mount on. Defaults to `/mcp`. */
  path?: string;
  /** Upper bound on a JSON request body. Defaults to 4 MiB. */
  maxRequestBodySize?: number;
  /**
   * Validates a presented API key. When omitted, any well-formed bearer token
   * is accepted. A rejected key answers `401` before the MCP handler runs.
   */
  authenticate?: (token: string) => boolean | Promise<boolean>;
  /** Builds the backend for one request. Exposed for tests. */
  createBackend?: (config: McpConfig) => WhereisBackend;
}

/**
 * Mounts the MCP endpoint on `app`.
 *
 * The handler builds one server per HTTP request, so the caller's key never
 * leaks into another request's tools.
 */
export function mountMcp(app: Hono, options: MountMcpOptions): void {
  const path = options.path ?? "/mcp";
  const maxBytes = options.maxRequestBodySize ?? DEFAULT_MAX_REQUEST_BODY_SIZE;
  const createBackend = options.createBackend ??
    ((config: McpConfig) => new HttpWhereisBackend(config));

  const handler = createMcpHandler((context) => {
    const token = context.authInfo?.token;
    // An anonymous request never inherits a key configured on the server, so a
    // hosted endpoint cannot be used to spend the operator's own quota.
    const config = token === undefined
      ? { ...options.config, apiKey: undefined }
      : { ...options.config, apiKey: token };

    return createMcpServer({ backend: createBackend(config), config });
  });

  app.use(path, jsonBodyMiddleware(maxBytes));

  app.all(path, async (c) => {
    const authorization = parseAuthorization(c.req.header("Authorization"));

    if (authorization.kind === "rejected") return unauthorized(c);

    if (authorization.kind === "authorized" && options.authenticate) {
      let valid = false;
      try {
        valid = await options.authenticate(authorization.token);
      } catch {
        valid = false;
      }
      if (!valid) return unauthorized(c);
    }

    const parsedBody = (c as unknown as { get(key: string): unknown })
      .get("parsedBody");

    return await handler.fetch(c.req.raw, {
      parsedBody,
      authInfo: authorization.kind === "authorized"
        ? {
          token: authorization.token,
          clientId: "whereis-api-key",
          scopes: [],
        }
        : undefined,
    });
  });
}
