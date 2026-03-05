/**
 * @file logger.ts
 * @description Provides a logger instance for consistent logging across the application
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */
import {Log, LogTransportBase, LogTransportBaseOptions, Severity,} from "@cross/log";
import { Grafana } from "./grafana.ts";

const consoleMap: Record<Severity, (...data: unknown[]) => void> = {
  [Severity.Debug]: console.debug,
  [Severity.Info]: console.info,
  [Severity.Warn]: console.warn,
  [Severity.Error]: console.error,
  [Severity.Log]: console.log
};

/**
 * Create custom Transport by extending LogTransportBase
 */
class CustomLogger extends LogTransportBase {
  override options: LogTransportBaseOptions;
  private readonly grafana: Grafana | undefined;
  private readonly env: string;

  constructor() {
    super();
    this.env = Deno.env.get("APP_ENV") || "dev";
    const level: Severity = ["prod", "qa"].includes(this.env) ? Severity.Info : Severity.Debug;
    const options: LogTransportBaseOptions = {
      minimumSeverity: level
    };
    this.options = {...this.defaults, ...options};
    this.grafana = Grafana.getInstance();
  }

  override log(level: Severity, _scope: string, data: unknown[], _timestamp: Date) {
    if (!this.shouldLog(level)) {
      return;
    }

    const message = data.join(" ");
    const prefixMatch = message.match(/^{whereis-api:[^}]+}/);
    const prefix = prefixMatch ? prefixMatch[0] : "{whereis-api:unknown}";
    const logMessage = prefixMatch ? message.substring(prefixMatch[0].length).trim() : message;

    (consoleMap[level])(logMessage);

    // Send log to Grafana
    if (this.grafana !== undefined) {
      const { service_name, type} = parsePrefix(prefix);
      this.grafana.log(service_name, this.env, type, level, logMessage);
    }
  }
}

let loggerInstance: Log | null = null;

/**
 * Determines the logging severity level based on the application's environment.
 * It reads the `APP_ENV` environment variable.
 *
 * @returns The logging severity level. Returns `Severity.Info` for "prod" and "qa" environments,
 * and `Severity.Debug` for "dev" or any other environment.
 */

/**
 * Generates a standardized log prefix string for Eagle1-specific logs.
 * This prefix helps in categorizing and filtering logs. The format is `{EG1:type}` or `{EG1:type:tag}`.
 *
 * @param type A string representing the category or type of the log (e.g., "Startup", "API").
 * @param tag An optional string for additional context or sub-categorization.
 * @returns A formatted string to be used as a prefix in log messages.
 */
export function whereIsAPI(type: string, tag?: string): string {
  return `{whereis-api:${type}${tag ? `:${tag}` : ""}}`;
}

/**
 * Parses a log message to extract the application, type, and an optional tag from a prefix.
 * The prefix is expected to be in the format `{EG1:type:tag}`.
 *
 * @param prefix The log message string to parse.
 * @returns An object containing the parsed `app`, `type`, and optional `tag`.
 *          Returns default values if the prefix is not found or malformed.
 */
function parsePrefix(prefix: string): { service_name: string, type: string; tag?: string } {
  const result: { service_name: string; type: string; tag?: string } = {
    service_name: "whereis-api",
    type: ""
  };

  const parts = prefix.substring(1, prefix.length - 1).split(":");
  if (parts.length >= 2) {
    result.service_name = parts[0];
    result.type = parts[1];
  }
  if (parts.length === 3) {
    result.tag = parts[2];
  }
  return result;
}

// create a lazy-loaded logger with a consistent interface.
export const logger = new Proxy({} as Log, {
  get: (_target, prop) => {
    if (!loggerInstance) {
      const customLogger: CustomLogger = new CustomLogger();
      loggerInstance = new Log([customLogger]);
    }
    return loggerInstance[prop as keyof Log];
  }
});