/**
 * @file config.ts
 * @description Environment configuration for the Whereis MCP server.
 *
 * Precedence: process environment > optional dotenv file > defaults.
 * The API key is never logged.
 *
 * @copyright (c) 2026, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import { load } from "@std/dotenv";
import { WhereisError } from "./errors.ts";
import type { LogLevel } from "./log.ts";

export type Transport = "stdio" | "http";

export interface HttpConfig {
  host: string;
  port: number;
  authToken?: string;
  allowedHosts?: string[];
}

export interface McpConfig {
  apiUrl: string;
  apiKey?: string;
  envFile: string;
  requestTimeoutMs: number;
  refreshTimeoutMs: number;
  maxEvents: number;
  enableWrite: boolean;
  logLevel: LogLevel;
  http: HttpConfig;
}

export const DEFAULT_API_URL = "https://api.eg1.io";
export const DEFAULT_HTTP_PORT = 8038;

const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

function configError(message: string, hint: string): WhereisError {
  return new WhereisError({ code: "CONFIG", message, hint });
}

async function loadDotEnv(
  envFile: string,
): Promise<Record<string, string>> {
  if (envFile.trim().length === 0) return {};

  try {
    return await load({ envPath: envFile, export: false });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return {};
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[whereis-mcp] warn: could not read ${envFile}: ${message}`);
    return {};
  }
}

function read(
  env: Record<string, string>,
  key: string,
): string | undefined {
  const processValue = Deno.env.get(key);
  if (processValue !== undefined && processValue.trim().length > 0) {
    return processValue.trim();
  }
  const fileValue = env[key];
  if (fileValue !== undefined && fileValue.trim().length > 0) {
    return fileValue.trim();
  }
  return undefined;
}

function readInteger(
  env: Record<string, string>,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = read(env, key);
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
  env: Record<string, string>,
  key: string,
  fallback: boolean,
): boolean {
  const raw = read(env, key);
  if (raw === undefined) return fallback;

  const normalized = raw.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;

  throw configError(
    `${key} must be a boolean (true/false).`,
    `Set ${key} to true or false, or unset it to use the default (${fallback}).`,
  );
}

function readLogLevel(env: Record<string, string>): LogLevel {
  const raw = read(env, "MCP_LOG_LEVEL")?.toLowerCase();
  if (raw === undefined) return "info";
  if ((LOG_LEVELS as readonly string[]).includes(raw)) {
    return raw as LogLevel;
  }
  throw configError(
    `MCP_LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}.`,
    "Set MCP_LOG_LEVEL to debug, info, warn, or error.",
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

function isLoopbackHost(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1";
}

function readHttpConfig(
  env: Record<string, string>,
  transport: Transport,
): HttpConfig {
  const host = read(env, "MCP_HOST") ?? "127.0.0.1";
  const port = readInteger(env, "MCP_PORT", DEFAULT_HTTP_PORT, 1, 65535);
  const authToken = read(env, "MCP_AUTH_TOKEN");
  const allowedHostsRaw = read(env, "MCP_ALLOWED_HOSTS");
  const allowedHosts = allowedHostsRaw
    ?.split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (transport === "http" && !isLoopbackHost(host)) {
    if (authToken === undefined) {
      throw configError(
        "MCP_AUTH_TOKEN is required when MCP_HOST is not a loopback address.",
        "Set MCP_AUTH_TOKEN to a long random value, or bind MCP_HOST to 127.0.0.1.",
      );
    }
    if (allowedHosts === undefined || allowedHosts.length === 0) {
      throw configError(
        "MCP_ALLOWED_HOSTS is required when MCP_HOST is not a loopback address.",
        "Set MCP_ALLOWED_HOSTS to the comma-separated hostnames clients use, e.g. whereis-mcp.example.com.",
      );
    }
  }

  if (transport === "http" && host === "0.0.0.0" && authToken === undefined) {
    throw configError(
      "Refusing to bind 0.0.0.0 without MCP_AUTH_TOKEN.",
      "Set MCP_AUTH_TOKEN, or bind to 127.0.0.1.",
    );
  }

  return { host, port, authToken, allowedHosts };
}

/** Loads and validates the MCP server configuration. */
export async function loadConfig(
  transport: Transport = "stdio",
): Promise<McpConfig> {
  const envFileValue = Deno.env.get("WHEREIS_ENV_FILE");
  const envFile = envFileValue === undefined ? ".env" : envFileValue.trim();
  const dotenv = await loadDotEnv(envFile);

  const apiUrl = normalizeApiUrl(
    read(dotenv, "WHEREIS_API_URL") ?? DEFAULT_API_URL,
  );
  const apiKey = read(dotenv, "WHEREIS_API_KEY");

  return {
    apiUrl,
    apiKey,
    envFile,
    requestTimeoutMs: readInteger(
      dotenv,
      "WHEREIS_TIMEOUT_MS",
      30_000,
      1_000,
      300_000,
    ),
    refreshTimeoutMs: readInteger(
      dotenv,
      "WHEREIS_REFRESH_TIMEOUT_MS",
      90_000,
      1_000,
      300_000,
    ),
    maxEvents: readInteger(dotenv, "WHEREIS_MAX_EVENTS", 500, 1, 5_000),
    enableWrite: readBoolean(dotenv, "WHEREIS_MCP_ENABLE_WRITE", false),
    logLevel: readLogLevel(dotenv),
    http: readHttpConfig(dotenv, transport),
  };
}
