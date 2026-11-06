/**
 * @file config.ts
 * @description Environment configuration for the Whereis MCP server.
 *
 * Values come from the process environment; the API loads .env before mounting.
 * The API key is never logged.
 *
 * @copyright (c) 2026, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import { WhereisError } from "./errors.ts";

export interface McpConfig {
  apiUrl: string;
  apiKey?: string;
  requestTimeoutMs: number;
  refreshTimeoutMs: number;
  maxEvents: number;
  enableWrite: boolean;
}

export const DEFAULT_API_URL = "https://api.eg1.io";

function configError(message: string, hint: string): WhereisError {
  return new WhereisError({ code: "CONFIG", message, hint });
}

function read(key: string): string | undefined {
  const value = Deno.env.get(key);
  if (value !== undefined && value.trim().length > 0) return value.trim();
  return undefined;
}

function readInteger(
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = read(key);
  if (raw === undefined) return fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw configError(
      `${key} must be an integer between ${minimum} and ${maximum}.`,
      `Set ${key} to a number in that range, or unset it to use the default (${fallback}).`,
    );
  }
  return parsed;
}

function readBoolean(
  key: string,
  fallback: boolean,
): boolean {
  const raw = read(key);
  if (raw === undefined) return fallback;

  const normalized = raw.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;

  throw configError(
    `${key} must be a boolean (true/false).`,
    `Set ${key} to true or false, or unset it to use the default (${fallback}).`,
  );
}

function normalizeApiUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw configError(
      `WHEREIS_API_URL is not a valid URL: ${raw}`,
      `Use an absolute http(s) URL such as ${DEFAULT_API_URL}.`,
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw configError(
      "WHEREIS_API_URL must use http or https.",
      `Use ${DEFAULT_API_URL} or a self-hosted http://localhost:8037.`,
    );
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw configError(
      "WHEREIS_API_URL must not contain embedded credentials.",
      "Keep the API key in WHEREIS_API_KEY, not in the URL.",
    );
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw configError(
      "WHEREIS_API_URL must not contain a query string or fragment.",
      "Use only the origin and an optional path prefix.",
    );
  }

  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

/** Loads and validates the MCP server configuration. */
export function loadConfig(): McpConfig {
  return {
    apiUrl: normalizeApiUrl(read("WHEREIS_API_URL") ?? DEFAULT_API_URL),
    apiKey: undefined,
    requestTimeoutMs: readInteger(
      "WHEREIS_TIMEOUT_MS",
      30_000,
      1_000,
      300_000,
    ),
    refreshTimeoutMs: readInteger(
      "WHEREIS_REFRESH_TIMEOUT_MS",
      90_000,
      1_000,
      300_000,
    ),
    maxEvents: readInteger("WHEREIS_MAX_EVENTS", 500, 1, 5_000),
    enableWrite: readBoolean("WHEREIS_MCP_ENABLE_WRITE", false),
  };
}
