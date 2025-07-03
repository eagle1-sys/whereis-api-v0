/**
 * @file logger.ts
 * @description Provides a logger instance for consistent logging across the application
 */
import { ConsoleLogger, Log, Severity } from "@cross/log";

function getLogLevel(): Severity {
  const env = Deno.env.get("APP_ENV") || "dev";
  switch (env) {
    case "prod":
      return Severity.Warn;
    case "qa":
      return Severity.Info;
    case "dev":
    default:
      return Severity.Debug;
  }
}

let loggerInstance: Log | null = null;

export function getLogger(): Log {
  if (!loggerInstance) {
    loggerInstance = new Log([
      new ConsoleLogger({
        minimumSeverity: getLogLevel(),
      }),
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
