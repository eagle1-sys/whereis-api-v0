import { httpPost } from "./util.ts";

const grafanaURL = Deno.env.get("GRAFANA_URL") ?? "";
const GRAFANA_USER = Deno.env.get("GRAFANA_USER") ?? "";
const GRAFANA_API_KEY = Deno.env.get("GRAFANA_API_KEY") ?? "";
const GRAFANA_PUSH_URL = `${grafanaURL.replace(/\/$/, "")}/loki/api/v1/push`;

console.log(
  `Logging configured to send to Grafana at ${GRAFANA_PUSH_URL} as user ${GRAFANA_USER}`,
);

self.addEventListener("message", async (e) => {
  const data = (e as MessageEvent).data;
  const serviceName = data.serviceName;
  const env = data.env;
  const type = data.type;
  const level = data.level;
  const source = data.source;
  const message = data.message;
  const timestampNs = (BigInt(Date.now()) * 1000000n).toString(); // Convert to nanoseconds
  const payload = {
    streams: [
      {
        stream: {
          service_name: serviceName,
          env: env,
          type: type,
          level: level,
          source: source,
        },
        values: [[timestampNs, JSON.stringify({ message: message })]],
      },
    ],
  };

  try {
    const authHeader = "Basic " + btoa(`${GRAFANA_USER}:${GRAFANA_API_KEY}`);
    const response = await httpPost(
      GRAFANA_PUSH_URL,
      {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      JSON.stringify(payload),
    );
    if (!response.ok) {
      console.error(
        "Failed to send log to Grafana:",
        response.status,
        await response.text(),
      );
    }
  } catch (err) {
    console.error("Failed to send log", err);
  }
});
