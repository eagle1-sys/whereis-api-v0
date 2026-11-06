/**
 * @file test-config.ts
 * @description Shared test configuration.
 *
 * @copyright (c) 2026, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import type { McpConfig } from "../src/config.ts";

/** Builds a deterministic config for tool and transport tests. */
export function makeConfig(overrides: Partial<McpConfig> = {}): McpConfig {
  return {
    apiUrl: "https://api.example.test",
    apiKey: "test-key",
    envFile: "",
    requestTimeoutMs: 1_000,
    refreshTimeoutMs: 2_000,
    maxEvents: 500,
    enableWrite: false,
    ...overrides,
  };
}
