/**
 * @file logger.ts
 * @description Provides a logger instance for consistent logging across the application
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */
import {Log, LogTransportBase, LogTransportBaseOptions, Severity,} from "@cross/log";
import { Grafana } from "./grafana.ts";

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
export class CustomLogger extends LogTransportBase {
  override options: LogTransportBaseOptions;
  private grafana: Grafana | undefined;

  constructor(options?: LogTransportBaseOptions) {
    super();
    this.options = { ...this.defaults, ...options };
    try {
      this.grafana = Grafana.getInstance();
    } catch (e) {
      console.error("Failed to initialize Grafana instance:", e);
    }
  }

  override log(level: Severity, scope: string, data: unknown[], _timestamp: Date) {
    if (this.shouldLog(level)) {
      // Custom implementation below
      const formattedMessage = `${level} ${scope} ${data.join(" ")}`;
      if (level === Severity.Error) {
        console.error(formattedMessage);
      } else {
        console.log(formattedMessage);
      }

      // Send log to Grafana
      if (this.grafana !== undefined) {
        this.grafana.log(formattedMessage, level);
      }
    }
  }
}

let loggerInstance: Log | null = null;

export function getLogger(): Log {
  if (!loggerInstance) {
    loggerInstance = new Log([
      new CustomLogger({ minimumSeverity: getLogLevel() }),
    ]);
  }
  return loggerInstance;
}

// create a lazy-loaded logger with a consistent interface.
export const logger = new Proxy({} as Log, {
  get: (_target, prop) => {
    return getLogger()[prop as keyof Log];
  },
});