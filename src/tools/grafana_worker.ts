import {httpPost} from "./util.ts";

const GRAFANA_PUSH_URL = 'https://logs-prod-020.grafana.net/loki/api/v1/push';

self.addEventListener("message", async (e) => {
    const data = (e as MessageEvent).data;
    const message = data.msg;
    const level = data.level;
    const timestampNs = (BigInt(Date.now()) * 1000000n).toString(); // Convert to nanoseconds

    const payload = {
        streams: [
            {
                stream: {
                    app: 'whereis',
                    level: level
                },
                values: [
                    [
                        timestampNs,
                        JSON.stringify({ message: message })
                    ]
                ]
            }
        ]
    };

    const GRAFANA_USER = Deno.env.get("GRAFANA_USER") || "";
    const GRAFANA_API_KEY = Deno.env.get("GRAFANA_API_KEY") || "";
    if (!GRAFANA_USER || !GRAFANA_API_KEY) {
        return; // Skip sending if credentials not configured
    }
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