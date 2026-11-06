/**
 * @file whereis-client_test.ts
 * @description Tests the HTTP backend with an injected fetch implementation.
 *
 * @copyright (c) 2026, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { DEFAULT_API_URL } from "../src/config.ts";
import { WhereisError } from "../src/errors.ts";
import { normalizeTrackingId } from "../src/tracking-id.ts";
import { type FetchLike, HttpWhereisBackend } from "../src/whereis-client.ts";
import { makeConfig } from "./test-config.ts";

interface RecordedCall {
  url: string;
  init?: RequestInit;
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function recordingFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): { fetchImpl: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  };
  return { fetchImpl, calls };
}

async function expectWhereisError(
  run: () => Promise<unknown>,
): Promise<WhereisError> {
  const error = await assertRejects(run);
  assert(error instanceof WhereisError);
  return error;
}

Deno.test("lists operators with the configured bearer token", async () => {
  const { fetchImpl, calls } = recordingFetch(() =>
    jsonResponse({
      operators: [{ code: "fdx", name: "FedEx", active: true }],
    })
  );
  const backend = new HttpWhereisBackend(
    makeConfig({ apiUrl: "https://api.example.test" }),
    fetchImpl,
    async () => {},
  );

  const operators = await backend.listOperators();

  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, "https://api.example.test/v0/operators");
  assertEquals(
    new Headers(calls[0].init?.headers).get("authorization"),
    "Bearer test-key",
  );
  assertEquals(operators, [{ code: "fdx", name: "FedEx", active: true }]);
});

Deno.test("builds a FedEx tracking URL with refresh", async () => {
  const { fetchImpl, calls } = recordingFetch(() =>
    jsonResponse({ entity: { id: "fdx-888877776666" }, events: [] })
  );
  const backend = new HttpWhereisBackend(
    makeConfig({ apiUrl: "https://api.example.test" }),
    fetchImpl,
    async () => {},
  );

  await backend.trackShipment({
    trackingId: normalizeTrackingId("fdx-888877776666"),
    refresh: true,
  });

  assertEquals(
    calls[0].url,
    "https://api.example.test/v0/whereis/fdx-888877776666?refresh=true",
  );
  assertEquals(
    new Headers(calls[0].init?.headers).get("authorization"),
    "Bearer test-key",
  );
});

Deno.test("sends phonenum for SF Express status lookups", async () => {
  const { fetchImpl, calls } = recordingFetch(() =>
    jsonResponse({
      id: "sfex-SF1234123412341",
      status: 3500,
      what: "Delivered",
    })
  );
  const backend = new HttpWhereisBackend(
    makeConfig(),
    fetchImpl,
    async () => {},
  );

  await backend.getLatestStatus({
    trackingId: normalizeTrackingId("sfex-SF1234123412341", "6993"),
  });

  assertEquals(
    calls[0].url,
    "https://api.example.test/v0/status/sfex-SF1234123412341?phonenum=6993",
  );
});

Deno.test("fails fast when a tracking call has no API key", async () => {
  const { fetchImpl, calls } = recordingFetch(() => jsonResponse({}));
  const backend = new HttpWhereisBackend(
    makeConfig({ apiKey: undefined }),
    fetchImpl,
    async () => {},
  );

  const error = await expectWhereisError(() =>
    backend.trackShipment({
      trackingId: normalizeTrackingId("fdx-888877776666"),
      refresh: false,
    })
  );

  assertEquals(error.code, "AUTH_REQUIRED");
  assert(error.message.includes("requires a Whereis API key"));
  assert(error.hint.includes("Authorization: Bearer"));
  assert(error.hint.includes("make api-key"));
  assertEquals(calls.length, 0);
});

Deno.test("maps a 404-01 response to a carrier-data hint", async () => {
  const { fetchImpl } = recordingFetch(() =>
    jsonResponse(
      { error: "404-01", message: "No data available from carrier" },
      404,
    )
  );
  const backend = new HttpWhereisBackend(
    makeConfig(),
    fetchImpl,
    async () => {},
  );

  const error = await expectWhereisError(() =>
    backend.getLatestStatus({
      trackingId: normalizeTrackingId("fdx-888877776666"),
    })
  );

  assertEquals(error.code, "404-01");
  assertEquals(error.httpStatus, 404);
  assert(error.hint.includes("carrier has no data"));
});

Deno.test("maps 401 and 403 responses to configuration hints", async () => {
  const unauthorized = recordingFetch(() =>
    jsonResponse({ error: "401-02", message: "Invalid token" }, 401)
  );
  const unauthorizedBackend = new HttpWhereisBackend(
    makeConfig(),
    unauthorized.fetchImpl,
    async () => {},
  );
  const authError = await expectWhereisError(() =>
    unauthorizedBackend.getLatestStatus({
      trackingId: normalizeTrackingId("fdx-888877776666"),
    })
  );
  assertEquals(authError.code, "401-02");
  assert(authError.hint.includes("rejected"));

  const forbidden = recordingFetch(() =>
    jsonResponse({ error: "403-01", message: "Forbidden" }, 403)
  );
  const forbiddenBackend = new HttpWhereisBackend(
    makeConfig(),
    forbidden.fetchImpl,
    async () => {},
  );
  const forbiddenError = await expectWhereisError(() =>
    forbiddenBackend.trackShipment({
      trackingId: normalizeTrackingId("fdx-888877776666"),
      refresh: false,
    })
  );
  assertEquals(forbiddenError.code, "403-01");
  assert(forbiddenError.hint.includes("restricted"));
});

Deno.test("explains an inactive local operator module", async () => {
  const { fetchImpl, calls } = recordingFetch(() =>
    jsonResponse({
      error: "500-01",
      message:
        "Internal Server Error:  [ERR-GATEWAY-C: Operator module not found: fdx]",
    }, 500)
  );
  const backend = new HttpWhereisBackend(
    makeConfig(),
    fetchImpl,
    async () => {},
  );

  const error = await expectWhereisError(() =>
    backend.trackShipment({
      trackingId: normalizeTrackingId("fdx-888877776666"),
      refresh: true,
    })
  );

  assertEquals(error.code, "500-01");
  assert(error.hint.includes("FDX_CLIENT_ID"));
  assert(error.hint.includes(DEFAULT_API_URL));
  assertEquals(error.retryable, false);
  assertEquals(calls.length, 1);
});

Deno.test("retries a retryable status once", async () => {
  let attempts = 0;
  const { fetchImpl, calls } = recordingFetch(() => {
    attempts += 1;
    if (attempts === 1) {
      return jsonResponse({ error: "500-01", message: "boom" }, 503);
    }
    return jsonResponse({ operators: [] });
  });
  const backend = new HttpWhereisBackend(
    makeConfig(),
    fetchImpl,
    async () => {},
  );

  const operators = await backend.listOperators();

  assertEquals(calls.length, 2);
  assertEquals(operators, []);
});

Deno.test("does not retry a 404", async () => {
  const { fetchImpl, calls } = recordingFetch(() =>
    jsonResponse({ error: "404-01", message: "missing" }, 404)
  );
  const backend = new HttpWhereisBackend(
    makeConfig(),
    fetchImpl,
    async () => {},
  );

  await expectWhereisError(() =>
    backend.getLatestStatus({
      trackingId: normalizeTrackingId("fdx-888877776666"),
    })
  );

  assertEquals(calls.length, 1);
});

Deno.test("honors Retry-After when backing off", async () => {
  const sleeps: number[] = [];
  let attempts = 0;
  const { fetchImpl } = recordingFetch(() => {
    attempts += 1;
    if (attempts === 1) {
      return jsonResponse({ error: "429-01", message: "slow down" }, 429, {
        "Retry-After": "2",
      });
    }
    return jsonResponse({ operators: [] });
  });
  const backend = new HttpWhereisBackend(
    makeConfig(),
    fetchImpl,
    (milliseconds) => {
      sleeps.push(milliseconds);
      return Promise.resolve();
    },
  );

  await backend.listOperators();

  assertEquals(sleeps, [2_000]);
});

Deno.test("maps a timeout to a retryable TIMEOUT error", async () => {
  let attempts = 0;
  const fetchImpl: FetchLike = (_url, init) => {
    attempts += 1;
    return new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted === true) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
  };

  const backend = new HttpWhereisBackend(
    makeConfig({ requestTimeoutMs: 25 }),
    fetchImpl,
    async () => {},
  );

  const error = await expectWhereisError(() =>
    backend.getLatestStatus({
      trackingId: normalizeTrackingId("fdx-888877776666"),
    })
  );

  assertEquals(error.code, "TIMEOUT");
  assertEquals(error.retryable, true);
  assertEquals(attempts, 3);
});

Deno.test("does not retry a timeout when refreshing from the carrier", async () => {
  let attempts = 0;
  const fetchImpl: FetchLike = (_url, init) => {
    attempts += 1;
    return new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted === true) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
  };

  const backend = new HttpWhereisBackend(
    makeConfig({ refreshTimeoutMs: 25 }),
    fetchImpl,
    async () => {},
  );

  const error = await expectWhereisError(() =>
    backend.trackShipment({
      trackingId: normalizeTrackingId("fdx-888877776666"),
      refresh: true,
    })
  );

  assertEquals(error.code, "TIMEOUT");
  assertEquals(attempts, 1);
});

Deno.test("still retries a network error when refreshing", async () => {
  let attempts = 0;
  const { fetchImpl } = recordingFetch(() => {
    attempts += 1;
    if (attempts === 1) {
      throw new TypeError("network down");
    }
    return jsonResponse({ entity: { id: "fdx-888877776666" }, events: [] });
  });

  const backend = new HttpWhereisBackend(
    makeConfig(),
    fetchImpl,
    async () => {},
  );

  const result = await backend.trackShipment({
    trackingId: normalizeTrackingId("fdx-888877776666"),
    refresh: true,
  });

  assertEquals(attempts, 2);
  assertEquals(result.id, "fdx-888877776666");
});

Deno.test("reports a non-JSON upstream error", async () => {
  const { fetchImpl } = recordingFetch(() =>
    new Response("<html>bad gateway</html>", { status: 502 })
  );
  const backend = new HttpWhereisBackend(
    makeConfig(),
    fetchImpl,
    async () => {},
  );

  const error = await expectWhereisError(() => backend.listOperators());

  assertEquals(error.code, "502");
  assert(error.message.includes("bad gateway"));
});

Deno.test("reports an empty status response", async () => {
  const { fetchImpl } = recordingFetch(() => new Response("", { status: 200 }));
  const backend = new HttpWhereisBackend(
    makeConfig(),
    fetchImpl,
    async () => {},
  );

  const error = await expectWhereisError(() =>
    backend.getLatestStatus({
      trackingId: normalizeTrackingId("fdx-888877776666"),
    })
  );

  assertEquals(error.code, "EMPTY");
});

Deno.test("reports a non-JSON 200 response as a parse error", async () => {
  const { fetchImpl } = recordingFetch(() =>
    new Response("not json", { status: 200 })
  );
  const backend = new HttpWhereisBackend(
    makeConfig(),
    fetchImpl,
    async () => {},
  );

  const error = await expectWhereisError(() =>
    backend.getLatestStatus({
      trackingId: normalizeTrackingId("fdx-888877776666"),
    })
  );

  assertEquals(error.code, "PARSE");
});
