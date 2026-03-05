import {httpPost} from "./util.ts";

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
                values: [
                    [
                        timestampNs,
                        JSON.stringify({message: message})
                    ]
                ]
            }
        ]
    };

    const grafanaURL = Deno.env.get("GRAFANA_URL") as string;
    const GRAFANA_USER = Deno.env.get("GRAFANA_USER") as string;
    const GRAFANA_API_KEY = Deno.env.get("GRAFANA_API_KEY") as string;
    const GRAFANA_PUSH_URL = grafanaURL + 'loki/api/v1/push';
    try {
        const authHeader = 'Basic ' + btoa(`${GRAFANA_USER}:${GRAFANA_API_KEY}`);
        await httpPost(
            GRAFANA_PUSH_URL,
            {
                'Content-Type': 'application/json',
                'Authorization': authHeader
            },
            JSON.stringify(payload)
        );
    } catch (err) {
        console.error('Failed to send log', err);
    }
});