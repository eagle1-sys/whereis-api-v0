/**
 * @file main.ts
 * @description This module serves as the orchestrator entry point for the Eagle1 Whereis API application.
 * It spawns two parallel processes: an API server (api.ts) and a background scheduler (schedule.ts),
 * managing their lifecycle and handling graceful shutdown on SIGINT/SIGTERM signals.
 *
 * The API server runs with parallel request handling enabled, while the scheduler
 * runs independently to handle periodic tasks such as auto-pulling tracking data from logistics providers.
 *
 * This architecture allows the application to handle both real-time API requests and background
 * data synchronization tasks concurrently, with proper signal handling for clean shutdowns.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */

// Get port from environment variable, fallback to 8080
const port = Deno.env.get("PORT") || "8080";

const apiCmd = new Deno.Command(Deno.execPath(), {
  args: ["serve", "--parallel", "--port", port, "--allow-net", "--allow-env", "--allow-read","--allow-write", "--allow-ffi", "main/api.ts"],
  stdout: "inherit",
  stderr: "inherit",
}).spawn();

const schedulerCmd = new Deno.Command(Deno.execPath(), {
  args: ["run", "--allow-env", "--allow-read", "--allow-net", "--allow-write", "--allow-ffi", "main/schedule.ts"],
  stdout: "inherit",
  stderr: "inherit",
}).spawn();

// Graceful shutdown: forward SIGINT / SIGTERM to children
Deno.addSignalListener("SIGINT", shutdown);
Deno.addSignalListener("SIGTERM", shutdown);

function shutdown() {
  console.log("\nShutting down…");
  apiCmd.kill("SIGTERM");
  schedulerCmd.kill("SIGTERM");
  Deno.exit(0);
}