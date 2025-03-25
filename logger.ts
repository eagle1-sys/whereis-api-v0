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

/**
 * A configured Winston logger instance
 * @type {winston.Logger}
 * @property {string} level - Log level set to 'info'
 * @property {Object} format - Log format configuration
 * @property {Object[]} transports - Log output destinations
 */
// export const logger0 = winston.createLogger({
//   /**
//    * The minimum level of messages to log
//    * @type {string}
//    */
//   level: "info",
//   format: winston.format.combine(
//     winston.format.timestamp(), // timestamp
//     winston.format.printf(({ timestamp, level, message }) => {
//       return `${timestamp} [${level}]: ${message}`;
//     }),
//   ),
//   transports: [
//     // output to console
//     new winston.transports.Console(),
//     // output to file
//     new winston.transports.File({ filename: "combined.log" }),
//   ],
// });
