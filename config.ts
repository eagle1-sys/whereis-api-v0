export const config = {
  service: {
    port: 8080,
    dataInterval: 5,
  },
  database: {
    port: 5432,
    name: "whereis",
    username: "postgres",
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
