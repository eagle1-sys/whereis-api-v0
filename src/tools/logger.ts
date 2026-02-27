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

function getLogger(): Log {
  if (!loggerInstance) {
    customLogger = new CustomLogger({minimumSeverity: getLogLevel()});
    loggerInstance = new Log([customLogger]);
  }
  return loggerInstance;
}

export function eg1(type: string, tag?: string): string {
  return `{EG1:${type}:${tag ?? ""}}`;
}

export function setGrafana(grafana: Grafana) {
  if (customLogger) {
    customLogger.setGrafana(grafana);
  }
}

function parsePrefix(message: string): { app: string, type: string; tag?: string } {
  const result: { app: string; type: string; tag?: string } = {
    app: "EG1",
    type: ""
  };
  if (message.startsWith("{EG1:")) {
    const idx = message.indexOf("}");
    const prefix = message.slice(1, idx + 1);
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