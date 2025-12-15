
interface QueryLogsOptions {
    query?: string;
    start?: number;
    end?: number;
    limit?: number;
    direction?: 'forward' | 'backward';
}


export class Grafana {

    // Singleton instance of the Grafana class.
    private static instance: Grafana | null = null;

    // Grafana API endpoint
    private static readonly GRAFANA_QUERY_URL = "https://logs-prod-020.grafana.net/loki/api/v1/query_range";

    private worker: Worker | undefined;
    private readonly GRAFANA_USER: string;
    private readonly GRAFANA_API_KEY: string;

    private constructor() {
        this.GRAFANA_USER = Deno.env.get("GRAFANA_USER") || "";
        this.GRAFANA_API_KEY = Deno.env.get("GRAFANA_API_KEY") || "";

        // Validate required environment variables
        if (!this.GRAFANA_USER || !this.GRAFANA_USER) {
            throw new Error("Missing required environment variables: GRAFANA_USER, GRAFANA_USER");
        }
    }

    public static getInstance(): Grafana {
        if (!Grafana.instance) {
            Grafana.instance = new Grafana();
            Grafana.instance.worker = new Worker(
                new URL("./grafana_worker.ts", import.meta.url).href,
                { type: "module" }
            )
        }
        return Grafana.instance;
    }

    log(message: string, level: string): void {
        if (this.worker) {
            this.worker.postMessage({ msg: message, level: level });
        }
    }

    async queryLog(options: QueryLogsOptions = {}): Promise<unknown> {
        const {
            query = '{app="whereis"}',
            start = Date.now() - 3600000,
            end = Date.now(),
            limit = 100,
            direction = 'backward'
        } = options;

        const startNs = (start * 1000000).toString();
        const endNs = (end * 1000000).toString();
        const params = new URLSearchParams({
            query: query,
            start: startNs,
            end: endNs,
            limit: limit.toString(),
            direction: direction
        });

        try {
            const authHeader = 'Basic ' + btoa(`${this.GRAFANA_USER}:${this.GRAFANA_API_KEY}`);
            const response = await fetch(`${Grafana.GRAFANA_QUERY_URL}?${params}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': authHeader
                }
            });

            if (!response.ok) {
                console.error('Failed to query logs:', response.status, await response.text());
                return null;
            }

            return await response.json();
        } catch (err) {
            console.error('Failed to query logs', err);
            return null;
        }
    }

}