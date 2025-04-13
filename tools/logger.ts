/**
 * @file logger.ts
 * @description Provides a logger instance for consistent logging across the application
 */

import { ConsoleLogger, Log, Severity } from "@cross/log";
export const logger = new Log([
  new ConsoleLogger({
    minimumSeverity: Severity.Info,
  }),
]);
