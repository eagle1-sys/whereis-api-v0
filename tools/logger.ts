/**
 * @file logger.ts
 * @description Provides a logger instance for consistent logging across the application
  */

import { FileLogger, Log } from "@cross/log";

export const logger = new Log([
  new FileLogger({
    filePath: "./app.log",
    fileFormat: "txt",
  }),
]);