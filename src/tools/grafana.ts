import {httpGet} from "./util.ts";

interface QueryLogsOptions {
    level?: string;
    keyword?: string;
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
        if (!this.GRAFANA_USER || !this.GRAFANA_API_KEY) {
            throw new Error("Missing required environment variables: GRAFANA_USER, GRAFANA_API_KEY");
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

    async queryLog(options: QueryLogsOptions = {}): Promise<Record<string, unknown> | undefined> {
        const {
            level = 'info',
            keyword = '',
            start = Date.now() - 3600000,
            end = Date.now(),
            limit = 100,
            direction = 'backward',
        } = options;

        // Escape special characters for LogQL
        const escapeLogQL = (s: unknown): string => {
            return String(s).replace(/["\\]/g, '\\$&');
        };
        const safeLevel = escapeLogQL(level);
        const safeKeyword = escapeLogQL(keyword);

        // Filter by level only
        let query: string = `{app="whereis"} |= "${safeLevel}"`;
        if (keyword) {
            // Filter by both level and keyword
            query = `{app="whereis"} |= "${safeLevel}" |= "${safeKeyword}"`;
        }

        const startNs = (Number(start) * 1000000).toString();
        const endNs = (Number(end) * 1000000).toString();
        const params = new URLSearchParams({
            query: query,
            start: startNs,
            end: endNs,
            limit: String(limit),
            direction: String(direction)
        });

        try {
            const authHeader = 'Basic ' + btoa(`${this.GRAFANA_USER}:${this.GRAFANA_API_KEY}`);
            const response = await httpGet(
                `${Grafana.GRAFANA_QUERY_URL}?${params}`,
                {
                    'Content-Type': 'application/json',
                    'Authorization': authHeader
                });
            if (!response.ok) {
                console.error('Failed to query logs:', response.status, await response.text());
                return undefined;
            }
            return await response.json();
        } catch (err) {
            console.error('Failed to query logs', err);
            return undefined;
        }
    }

}