/**
 * @file config.ts
 * @description This file contains the configuration settings for the application.
 * It defines various configuration parameters for different aspects of the application.
 *
 * Some of these configuration values can be overridden by environment variables,
 * typically set in a .env file, such as database settings.
 * This allows for flexible configuration across different deployment environments without changing the code.
 */
export const config = {
  app: {
    port: 8080,      // application server port, can be overridden by ENV variable: APP_PORT
    pullInterval: 5, // auto-pull interval from data sources, in minutes. Can be overridden by ENV variable: APP_PULL_INTERVAL
  },
  database: {
    port: 5432,         // default database port, can be overridden by ENV variable: DB_PORT
    name: "whereis",    // default database name, can be overridden by ENV variable: DB_NAME
  },
  fdx: {
    apiUrl: "https://apis.fedex.com/oauth/token",
    trackApiUrl: "https://apis.fedex.com/track/v1/trackingnumbers",
  },
  sfex: {
    apiUrl: "https://bspgw.sf-express.com/std/service",
  },
};
