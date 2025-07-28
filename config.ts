export const config = {
  database: {
    // Default values. Can be overridden by ENV variables: DB_PORT, DB_NAME, APP_PULL_INTERVAL
    port: 5432,
    name: "whereis",
    pullInterval: 5,   // in minutes
  },
  fdx: {
    apiUrl: "https://apis.fedex.com/oauth/token",
    trackApiUrl: "https://apis.fedex.com/track/v1/trackingnumbers",
  },
  sfex: {
    apiUrl: "https://bspgw.sf-express.com/std/service",
  },
  testing: {
    url: "https://whereis-api-v0-test.fly.dev"
  },
};
