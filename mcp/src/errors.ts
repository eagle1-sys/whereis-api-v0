/**
 * @file errors.ts
 * @description Error types, upstream error mapping, and MCP tool error results.
 *
 * @copyright (c) 2026, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import type { CallToolResult } from "@modelcontextprotocol/server";
import { isRecord } from "./coerce.ts";

/** A failure that can be reported to the model with an actionable hint. */
export class WhereisError extends Error {
  /** Eagle1 error code (for example "404-01") or a local code such as "INPUT". */
  readonly code: string;
  /** HTTP status from the upstream response, when there was one. */
  readonly httpStatus?: number;
  /** Short, actionable guidance for the model. */
  readonly hint: string;
  /** Whether retrying the same request may succeed. */
  readonly retryable: boolean;
  /** Delay requested by the upstream Retry-After header, in milliseconds. */
  readonly retryAfterMs?: number;

  constructor(options: {
    code: string;
    message: string;
    hint: string;
    httpStatus?: number;
    retryable?: boolean;
    retryAfterMs?: number;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "WhereisError";
    this.code = options.code;
    this.httpStatus = options.httpStatus;
    this.hint = options.hint;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;
  }
}

const HINTS: Record<string, string> = {
  "400-01":
    "Use a tracking ID in `<operator>-<tracking_number>` form, e.g. `fdx-888877776666`.",
  "400-02":
    "Check the tracking number for this operator. SF Express numbers are `SF` followed by 13 digits.",
  "400-03":
    "For SF Express, supply phone_last4 (the last 4 digits of the recipient's phone). Remove unsupported parameters.",
  "400-04":
    "Unknown operator code. Call list_operators to see the valid codes.",
  "400-05":
    "Use exactly one hyphen between the operator and tracking number, e.g. `fdx-888877776666`.",
  "401-01":
    "WHEREIS_API_KEY is not configured for this MCP server. Add it to the environment or the repo .env file.",
  "401-02":
    "The configured WHEREIS_API_KEY was rejected. Check that it was copied correctly.",
  "403-01":
    "This API key is restricted to the `eg1` operator. Generate a full key with `deno task api_key` and update WHEREIS_API_KEY.",
  "404-01":
    "The carrier has no data for this tracking ID. Verify the number, or the shipment may be older than the carrier's retention window.",
  "404-02": "This operator does not support push.",
  "404-03":
    "Eagle1 (`eg1`) is push-only and has no carrier data source; data appears only after events are pushed.",
  "429-01":
    "Eagle1 or the carrier is rate limiting requests. Wait a little and retry.",
  "500-01":
    "The Eagle1 API hit an internal error. Retry; if it persists, check the API logs.",
  "500-02":
    "The Eagle1 API could not complete the upstream request. Retry later.",
};

const DEFAULT_HINT =
  "Retry once. If the problem persists, check WHEREIS_API_URL and the Eagle1 API status.";

const INACTIVE_OPERATOR_HINT =
  "The configured API has no active data source for this operator. For a local stack, set FDX_CLIENT_ID/FDX_CLIENT_SECRET or SFEX_PARTNER_ID/SFEX_CHECK_WORD in source-api-keys.env and recreate the container. The hosted API at https://api.eg1.io already has carrier credentials.";

/** Parses a Retry-After header expressed in seconds. */
function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(seconds * 1000, 5_000);
}

/** Keeps a non-JSON upstream body short enough to put in an error message. */
function boundedSnippet(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= 300) return collapsed;
  return `${collapsed.slice(0, 299)}…`;
}

/**
 * Converts an upstream HTTP failure into a WhereisError with a helpful hint.
 */
export function mapApiError(
  httpStatus: number,
  statusText: string,
  bodyText: string,
  retryAfterHeader: string | null,
): WhereisError {
  let code = String(httpStatus);
  let message = `HTTP ${httpStatus}${statusText ? ` ${statusText}` : ""}`;

  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (isRecord(parsed)) {
      const parsedCode = parsed.error;
      const parsedMessage = parsed.message;
      if (typeof parsedCode === "string" && parsedCode.length > 0) {
        code = parsedCode;
      }
      if (typeof parsedMessage === "string" && parsedMessage.length > 0) {
        message = parsedMessage;
      }
    }
  } catch {
    if (bodyText.trim().length > 0) {
      message = `${message}: ${boundedSnippet(bodyText)}`;
    }
  }

  const httpHint = HINTS[String(httpStatus)];
  const inactiveOperator = message.includes(
    "ERR-GATEWAY-C: Operator module not found",
  ) || message.includes("INACTIVE_OPERATOR");
  const hint = inactiveOperator
    ? INACTIVE_OPERATOR_HINT
    : (HINTS[code] ?? httpHint ?? DEFAULT_HINT);
  // A missing operator module is a deployment gap, not a transient failure:
  // retrying it only delays the hint the caller needs.
  const retryable = !inactiveOperator &&
    (httpStatus === 429 || httpStatus >= 500 || code === "429-01");

  return new WhereisError({
    code,
    message,
    hint,
    httpStatus,
    retryable,
    retryAfterMs: parseRetryAfterMs(retryAfterHeader),
  });
}

/** Builds a validation error for bad tool arguments. */
export function inputError(message: string, hint: string): WhereisError {
  return new WhereisError({ code: "INPUT", message, hint });
}

/** Converts any thrown value into an MCP tool error result. */
export function toErrorResult(error: unknown): CallToolResult {
  if (error instanceof WhereisError) {
    return {
      isError: true,
      content: [{
        type: "text",
        text:
          `Eagle1 error ${error.code}: ${error.message}\nHint: ${error.hint}`,
      }],
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text", text: `Unexpected error: ${message}` }],
  };
}
