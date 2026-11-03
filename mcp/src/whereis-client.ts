/**
 * @file whereis-client.ts
 * @description HTTP backend for the Eagle1 Whereis `/v0` API.
 *
 * The backend owns URL construction, bearer auth, timeouts, retries, and error
 * mapping. Tools only see normalized results and WhereisError instances.
 *
 * @copyright (c) 2026, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import { isRecord } from "./coerce.ts";
import type { McpConfig } from "./config.ts";
import { mapApiError, WhereisError } from "./errors.ts";
import {
  normalizeOperators,
  normalizePush,
  normalizeStatus,
  normalizeTrack,
} from "./normalize.ts";
import type { NormalizedTrackingId } from "./tracking-id.ts";
import type {
  OperatorInfo,
  PushEventInput,
  PushResult,
  StatusResult,
  TrackResult,
} from "./types.ts";
import { SERVER_NAME, SERVER_VERSION } from "./version.ts";

/** Minimal fetch signature, injectable for tests. */
export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

/** Sleep signature, injectable for fast retry tests. */
export type SleepLike = (milliseconds: number) => Promise<void>;

export interface StatusRequest {
  trackingId: NormalizedTrackingId;
  signal?: AbortSignal;
}

export interface TrackRequest {
  trackingId: NormalizedTrackingId;
  refresh: boolean;
  signal?: AbortSignal;
}

/** The operations the MCP tools need from a Whereis backend. */
export interface WhereisBackend {
  listOperators(signal?: AbortSignal): Promise<OperatorInfo[]>;
  getLatestStatus(request: StatusRequest): Promise<StatusResult>;
  trackShipment(request: TrackRequest): Promise<TrackResult>;
  pushEvents(
    events: PushEventInput[],
    signal?: AbortSignal,
  ): Promise<PushResult>;
}

interface RequestOptions {
  method?: "GET" | "POST";
  query?: Record<string, string | undefined>;
  body?: unknown;
  timeoutMs: number;
  requireAuth?: boolean;
  retries: number;
  /** Defaults to true; set false when a timeout should not be retried. */
  retryOnTimeout?: boolean;
  signal?: AbortSignal;
}

const API_KEY_HINT =
  "Add WHEREIS_API_KEY to the environment or the repo .env file. Generate a full key with `deno task api_key`; the seeded `eagle1` token is restricted.";

const defaultSleep: SleepLike = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function backoffMs(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) return retryAfterMs;
  const base = 500 * 2 ** attempt;
  return base + Math.floor(Math.random() * 250);
}

/** HTTP implementation of the Whereis backend. */
export class HttpWhereisBackend implements WhereisBackend {
  private readonly config: McpConfig;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: SleepLike;

  constructor(
    config: McpConfig,
    fetchImpl: FetchLike = fetch,
    sleep: SleepLike = defaultSleep,
  ) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
  }

  async listOperators(signal?: AbortSignal): Promise<OperatorInfo[]> {
    const raw = await this.request<unknown>("/v0/operators", {
      timeoutMs: Math.min(this.config.requestTimeoutMs, 15_000),
      retries: 1,
      signal,
    });
    return normalizeOperators(raw);
  }

  async getLatestStatus(request: StatusRequest): Promise<StatusResult> {
    const raw = await this.request<unknown>(
      `/v0/status/${encodeURIComponent(request.trackingId.id)}`,
      {
        query: { phonenum: request.trackingId.phoneLast4 },
        timeoutMs: this.config.requestTimeoutMs,
        retries: 2,
        signal: request.signal,
      },
    );

    if (
      raw === undefined || raw === null ||
      (isRecord(raw) && Object.keys(raw).length === 0)
    ) {
      throw new WhereisError({
        code: "EMPTY",
        message: `No status was returned for ${request.trackingId.id}.`,
        hint:
          "The shipment may have no events yet. Try track_shipment with refresh=true, or verify the tracking ID.",
        retryable: false,
      });
    }

    return normalizeStatus(raw, request.trackingId);
  }

  async trackShipment(request: TrackRequest): Promise<TrackResult> {
    const raw = await this.request<unknown>(
      `/v0/whereis/${encodeURIComponent(request.trackingId.id)}`,
      {
        query: {
          phonenum: request.trackingId.phoneLast4,
          refresh: request.refresh ? "true" : undefined,
        },
        timeoutMs: request.refresh
          ? this.config.refreshTimeoutMs
          : this.config.requestTimeoutMs,
        requireAuth: true,
        retries: request.refresh ? 1 : 2,
        // A refresh timeout means the carrier pull is still slow; retrying
        // would start another pull. Network failures remain retryable.
        retryOnTimeout: !request.refresh,
        signal: request.signal,
      },
    );

    return normalizeTrack(raw, request.trackingId, this.config.maxEvents);
  }

  async pushEvents(
    events: PushEventInput[],
    signal?: AbortSignal,
  ): Promise<PushResult> {
    const raw = await this.request<unknown>("/v0/push/eg1", {
      method: "POST",
      body: { eg1DataVersion: 1, events },
      timeoutMs: this.config.requestTimeoutMs,
      requireAuth: true,
      retries: 0,
      signal,
    });

    return normalizePush(raw);
  }

  private async request<T>(
    path: string,
    options: RequestOptions,
  ): Promise<T> {
    let lastError: WhereisError | undefined;

    for (let attempt = 0; attempt <= options.retries; attempt++) {
      try {
        return await this.requestOnce<T>(path, options);
      } catch (error) {
        const whereisError = error instanceof WhereisError
          ? error
          : new WhereisError({
            code: "INTERNAL",
            message: error instanceof Error ? error.message : String(error),
            hint:
              "Retry the request. If the problem persists, check the server logs.",
            retryable: false,
          });

        lastError = whereisError;
        const timeoutRetryDisabled = whereisError.code === "TIMEOUT" &&
          options.retryOnTimeout === false;
        if (
          !whereisError.retryable ||
          timeoutRetryDisabled ||
          attempt >= options.retries
        ) {
          throw whereisError;
        }

        await this.sleep(backoffMs(attempt, whereisError.retryAfterMs));
      }
    }

    throw lastError ?? new WhereisError({
      code: "INTERNAL",
      message: "The request failed.",
      hint: "Retry the request.",
      retryable: false,
    });
  }

  private async requestOnce<T>(
    path: string,
    options: RequestOptions,
  ): Promise<T> {
    if (options.requireAuth === true && !this.config.apiKey) {
      throw new WhereisError({
        code: "CONFIG",
        message: "WHEREIS_API_KEY is not configured for this MCP server.",
        hint: API_KEY_HINT,
        retryable: false,
      });
    }

    const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
    const signal = options.signal === undefined
      ? timeoutSignal
      : AbortSignal.any([timeoutSignal, options.signal]);

    const url = new URL(`${this.config.apiUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": `${SERVER_NAME}-mcp/${SERVER_VERSION}`,
    };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }

    try {
      const response = await this.fetchImpl(url.toString(), {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined
          ? undefined
          : JSON.stringify(options.body),
        signal,
      });
      const bodyText = await response.text();

      if (!response.ok) {
        throw mapApiError(
          response.status,
          response.statusText,
          bodyText,
          response.headers.get("retry-after"),
        );
      }

      if (bodyText.trim().length === 0) {
        return undefined as T;
      }

      try {
        return JSON.parse(bodyText) as T;
      } catch {
        throw new WhereisError({
          code: "PARSE",
          message: "The Eagle1 API returned a non-JSON response.",
          hint:
            "Retry the request. If it persists, check WHEREIS_API_URL and whether the API is behind a proxy or login page.",
          retryable: false,
        });
      }
    } catch (error) {
      if (error instanceof WhereisError) throw error;

      if (options.signal?.aborted === true) {
        throw new WhereisError({
          code: "CANCELLED",
          message: "The request was cancelled by the MCP client.",
          hint: "Retry the tool call if the result is still needed.",
          retryable: false,
          cause: error,
        });
      }

      if (timeoutSignal.aborted) {
        throw new WhereisError({
          code: "TIMEOUT",
          message:
            `The Eagle1 API did not respond within ${options.timeoutMs}ms.`,
          hint:
            "Retry. If this happens with refresh=true, the carrier pull may be slow; try again without refresh or later.",
          retryable: true,
          cause: error,
        });
      }

      throw new WhereisError({
        code: "NETWORK",
        message: `Could not reach the Eagle1 API at ${this.config.apiUrl}.`,
        hint:
          "Check network connectivity and WHEREIS_API_URL. If you are self-hosting, confirm the API is running.",
        retryable: true,
        cause: error,
      });
    }
  }
}
