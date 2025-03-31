/**
 * @file Logger module for application-wide logging functionality
 * @description Provides a configured Winston logger instance for consistent logging across the application
 * @author samshdn
 * @version 0.1.1
 */

import { FileLogger, Log } from "@cross/log";

export const logger = new Log([
  new FileLogger({
    filePath: "./app.log",
    fileFormat: "txt",
  }),
]);
