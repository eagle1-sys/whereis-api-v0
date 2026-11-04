/**
 * @file log.ts
 * @description stderr-only logging for the Whereis MCP server.
 *
 * stdio is the MCP protocol channel, so every log line must go to stderr.
 * Never log API keys, bearer headers, or full upstream responses.
 *
 * @copyright (c) 2026, the Eagle1 authors
 * @license BSD 3-Clause License
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let currentLevel: LogLevel = "info";

/** Sets the minimum level that is written to stderr. */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function write(level: LogLevel, message: string): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[currentLevel]) return;
  console.error(`[whereis-mcp] ${level}: ${message}`);
}

export const log = {
  debug(message: string): void {
    write("debug", message);
  },
  info(message: string): void {
    write("info", message);
  },
  warn(message: string): void {
    write("warn", message);
  },
  error(message: string): void {
    write("error", message);
  },
};

/** Renders an unknown thrown value without leaking a stack trace. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
