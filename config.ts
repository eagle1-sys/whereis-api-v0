export const config = {
  database: {
    // default values. Can be overritten by ENV variables: APP_PORT, DB_NAME, APP_PULL_INTERVAL
    port: 5432,
    name: "whereis",
    auto_pull_interval: "5", // in minutes
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
