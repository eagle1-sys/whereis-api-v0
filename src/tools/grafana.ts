import { httpGet } from "./util.ts";

interface QueryLogsOptions {
  service?: string;
  env?: string;
  type?: string;
  level?: string;
  keyword?: string;
  start?: number;
  end?: number;
  limit?: number;
  direction?: "forward" | "backward";
}

export class Grafana {
  // Singleton instance of the Grafana class.
  private static instance: Grafana | undefined;
  private static initialized = false;

  private readonly worker: Worker | undefined;
  private readonly GRAFANA_USER: string;
  private readonly GRAFANA_API_KEY: string;
  private readonly GRAFANA_SOURCE: string;
  // Grafana API endpoint
  private readonly GRAFANA_QUERY_URL: string;

  private constructor(
    grafanaUser: string,
    grafanaApiKey: string,
    grafanaURL: string,
    grafanaSource: string,
  ) {
    this.GRAFANA_USER = grafanaUser;
    this.GRAFANA_API_KEY = grafanaApiKey;
    this.GRAFANA_QUERY_URL = grafanaURL + "loki/api/v1/query_range";
    this.GRAFANA_SOURCE = grafanaSource;

    // Initialize the worker
    try {
      this.worker = new Worker(
        new URL("./grafana_worker.ts", import.meta.url).href,
        { type: "module" },
      );
    } catch (error) {
      console.error("Failed to initialize Grafana worker:", error);
      this.worker = undefined;
    }
  }

  public static getInstance(): Grafana | undefined {
    if (!Grafana.instance && !Grafana.initialized) {
      const grafanaURL = Deno.env.get("GRAFANA_URL") || "";
      const grafanaUser = Deno.env.get("GRAFANA_USER") || "";
      const grafanaApiKey = Deno.env.get("GRAFANA_API_KEY") || "";
      if (grafanaURL && grafanaUser && grafanaApiKey) {
        Grafana.instance = new Grafana(
          grafanaUser,
          grafanaApiKey,
          grafanaURL,
          Deno.hostname(),
        );
        console.info(
          `Grafana logging enabled: URL=${grafanaURL}, User=${grafanaUser}`,
        );
      }
      Grafana.initialized = true; // <-- must be here, not inside the inner if
    }
    return Grafana.instance;
  }

  log(
    serviceName: string,
    env: string,
    type: string,
    level: string,
    message: string,
  ): void {
    if (this.worker) {
      this.worker.postMessage({
        serviceName: serviceName,
        env: env,
        type: type,
        level: level,
        source: this.GRAFANA_SOURCE,
        message: message,
      });
    } else {
      console.warn("Grafana worker not initialized, log not sent:", message);
    }
  }

  async queryLog(
    options: QueryLogsOptions = {},
  ): Promise<Record<string, unknown> | undefined> {
    const {
      service = "",
      env = "",
      type = "",
      level = "",
      keyword = "",
      start = Date.now() - 3600000,
      end = Date.now(),
      limit = 100,
      direction = "backward",
    } = options;

    // Escape special characters for LogQL
    const escapeLogQL = (s: unknown): string => {
      return String(s).replace(/["\\]/g, "\\$&");
    };

    // Compose label selector
    const safeService = escapeLogQL(service);
    const safeEnv = escapeLogQL(env);
    const safeType = escapeLogQL(type);
    const safeLevel = escapeLogQL(level);
    const safeKeyword = escapeLogQL(keyword);
    let labelSelector = `{service_name="${safeService}"`;
    if (safeEnv) {
      labelSelector += `, env="${safeEnv}"`;
    }
    if (safeType) {
      labelSelector += `, type="${safeType}"`;
    }
    if (safeLevel) {
      labelSelector += `, level="${safeLevel}"`;
    }
    labelSelector = labelSelector + "}";

    // Compose LogQL query with label selector
    let query: string = labelSelector;
    if (keyword) {
      // Filter by keyword
      query = query + ` |= "${safeKeyword}"`;
    }

    const startNs = (Number(start) * 1000000).toString();
    const endNs = (Number(end) * 1000000).toString();
    const params = new URLSearchParams({
      query: query,
      start: startNs,
      end: endNs,
      limit: String(limit),
      direction: String(direction),
    });

    try {
      const authHeader =
        "Basic " + btoa(`${this.GRAFANA_USER}:${this.GRAFANA_API_KEY}`);
      const response = await httpGet(`${this.GRAFANA_QUERY_URL}?${params}`, {
        "Content-Type": "application/json",
        Authorization: authHeader,
      });
      if (!response.ok) {
        console.error(
          "Failed to query logs:",
          response.status,
          await response.text(),
        );
        return undefined;
      }
      return await response.json();
    } catch (err) {
      console.error("Failed to query logs", err);
      return undefined;
    }
  }
}
