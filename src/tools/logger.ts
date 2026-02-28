/**
 * @file logger.ts
 * @description Provides a logger instance for consistent logging across the application
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */
import {Log, LogTransportBase, LogTransportBaseOptions, Severity,} from "@cross/log";
import { Grafana } from "./grafana.ts";

/**
 * Determines the logging severity level based on the application's environment.
 * It reads the `APP_ENV` environment variable.
 *
 * @returns The logging severity level. Returns `Severity.Info` for "prod" and "qa" environments,
 * and `Severity.Debug` for "dev" or any other environment.
 */
function getLogLevel(): Severity {
  const env = Deno.env.get("APP_ENV") || "dev";
  switch (env) {
    case "prod":
      return Severity.Info;
    case "qa":
      return Severity.Info;
    case "dev":
    default:
      return Severity.Debug;
  }
}

/**
 * Create custom Transport by extending LogTransportBase
 */
class CustomLogger extends LogTransportBase {
  override options: LogTransportBaseOptions;
  grafana: Grafana | undefined;

  constructor(options?: LogTransportBaseOptions) {
    super();
    this.options = { ...this.defaults, ...options };
  }

  public setGrafana(grafana: Grafana | undefined) {
    this.grafana = grafana;
  }

  override log(level: Severity, _scope: string, data: unknown[], _timestamp: Date) {
    if (this.shouldLog(level)) {
      let formattedMessage;
      const message = data.join(" ");
      if (message.startsWith("{EG1:")) {
        const idx = message.indexOf("}");
        const prefix = message.slice(0, idx + 1);
        // eg: {EG1:Startup} Info Whereis API Release 0.3
        formattedMessage = `${prefix} ${level} ${message.substring(idx + 1).trim()}`;
      } else {
        formattedMessage = `{EG1:Unknow} ${level} ${message}`;
      }
      if (level === Severity.Error) {
        console.error(formattedMessage);
      } else {
        console.log(formattedMessage);
      }

      // Send log to Grafana
      if (this.grafana !== undefined) {
        const { app, type} = parsePrefix(formattedMessage);
        this.grafana.log(app, type, formattedMessage, level);
      }
    }
  }
}

let loggerInstance: Log | null = null;
let customLogger: CustomLogger | null = null;

/**
 * Retrieves the singleton logger instance.
 * If the logger instance does not exist, it creates one with a custom transport.
 * This ensures a single, consistent logger is used throughout the application.
 *
 * @returns The singleton `Log` instance.
 */
function getLogger(): Log {
  if (!loggerInstance) {
    customLogger = new CustomLogger({minimumSeverity: getLogLevel()});
    loggerInstance = new Log([customLogger]);
  }
  return loggerInstance;
}

/**
 * Generates a standardized log prefix string for Eagle1-specific logs.
 * This prefix helps in categorizing and filtering logs. The format is `{EG1:type}` or `{EG1:type:tag}`.
 *
 * @param type A string representing the category or type of the log (e.g., "Startup", "API").
 * @param tag An optional string for additional context or sub-categorization.
 * @returns A formatted string to be used as a prefix in log messages.
 */
export function eg1(type: string, tag?: string): string {
  return `{EG1:${type}${tag ? `:${tag}` : ""}}`;
}

/**
 * Sets the Grafana instance for the custom logger.
 * This allows the logger to send logs to Grafana Loki. If the custom logger
 * has not been initialized yet, this function will have no effect until the logger is initialized.
 *
 * @param grafana The Grafana instance to use for sending logs.
 */
export function setGrafana(grafana: Grafana) {
  if (customLogger) {
    customLogger.setGrafana(grafana);
  }
}

/**
 * Parses a log message to extract the application, type, and an optional tag from a prefix.
 * The prefix is expected to be in the format `{EG1:type:tag}`.
 *
 * @param message The log message string to parse.
 * @returns An object containing the parsed `app`, `type`, and optional `tag`.
 *          Returns default values if the prefix is not found or malformed.
 */
function parsePrefix(message: string): { app: string, type: string; tag?: string } {
  const result: { app: string; type: string; tag?: string } = {
    app: "EG1",
    type: ""
  };
  if (message.startsWith("{EG1:")) {
    const idx = message.indexOf("}");
    const prefix = message.slice(1, idx);
    const parts = prefix.split(":");
    if (parts.length >= 2) {
      result.app = parts[0];
      result.type = parts[1];
    }
    if (parts.length === 3) {
      result.tag = parts[2];
    }
  }
  return result;
}

// create a lazy-loaded logger with a consistent interface.
export const logger = new Proxy({} as Log, {
  get: (_target, prop) => {
    return getLogger()[prop as keyof Log];
  }
});