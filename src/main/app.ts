/**
 * @file app.ts
 * @description A collection of functions for loading metadata from the file system.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import { Sfex } from "../connectors/operator/sfex.ts";
import { Fdx } from "../connectors/operator/fdx.ts";
import { Eg1 } from "../connectors/operator/eg1.ts";

import { load } from "@std/dotenv";
import { config } from "../../config.ts";
import { loadJSONFromFs } from "../tools/util.ts";
import {
  ApiParams,
  DataUpdateMethod,
  ErrorRegistry,
  ExceptionCode,
  OperatorRegistry,
  StatusCode,
} from "./model.ts";
import {registerOperatorModule, setOperatorStatus} from "./gateway.ts";

/**
 * Loads environment variables from a `.env` file and sets them in `Deno.env`.
 * @async
 * @returns {Promise<void>} A promise that resolves when the environment variables are loaded and set.
 * @throws {Error} If the `.env` file cannot be loaded or parsed.
 */
export async function loadEnv(): Promise<void> {
  // Set environment variables from the `.env` file if not already set
  const env = await load({ envPath: "./.env" });
  for (const [key, value] of Object.entries(env)) {
    // It's possible that the environment variable is already set in `Deno.env`.
    if (!Deno.env.get(key)) {
      Deno.env.set(key, value);
    }
  }

  // Set default environment variables if not specified
  const defaultEnv = {
    APP_ENV: "dev",
    DB_PORT: String(config.database.port),
    DB_NAME: config.database.name,
    APP_PULL_INTERVAL: String(config.app.pullInterval),
  };
  for (const [key, value] of Object.entries(defaultEnv)) {
    if (!Deno.env.get(key)) {
      Deno.env.set(key, value);
    }
  }
}

/**
 * Loads metadata from the file system, including status codes and error definitions.
 * Initializes the `CodeDesc` and `ErrorRegistry` classes with the loaded data.
 * @async
 * @returns {Promise<void>} A promise that resolves when the metadata is loaded and initialized.
 * @throws {Error} If the JSON files cannot be loaded or parsed.
 */
export async function loadMetaData(): Promise<void> {
  const status: Record<string, unknown> = await loadJSONFromFs(
    "./metadata/status-codes.jsonc",
  );
  StatusCode.initialize(status);

  const dataRetrievalMethods: Record<string, unknown> = await loadJSONFromFs(
    "./metadata/data-update-methods.jsonc",
  );
  DataUpdateMethod.initialize(
    dataRetrievalMethods as Record<string, Record<string, string>>,
  );

  const apiParams: Record<string, unknown> = await loadJSONFromFs(
    "./metadata/api-params.jsonc",
  );
  ApiParams.initialize(
    apiParams as Record<string, Record<string, string>>,
  );

  const operators: Record<string, unknown> = await loadJSONFromFs(
    "./metadata/operators.jsonc",
  );
  OperatorRegistry.initialize(operators);

  const exception: Record<string, unknown> = await loadJSONFromFs(
    "./metadata/exception-codes.jsonc",
  );
  ExceptionCode.initialize(exception);

  const errors: Record<string, unknown> = await loadJSONFromFs(
    "./metadata/error-codes.jsonc",
  );
  ErrorRegistry.initialize(errors);
}

/**
 * Initializes the status of various operators based on environment variables.
 *
 * This function checks for the presence of specific environment variables
 * and sets the status of corresponding operators to active (true) if the
 * required credentials are available.
 *
 * Currently, it initializes the status for three operators:
 * - 'eg1': Activated unconditionally (push-based operator).
 * - 'fdx': Activated if FDX_CLIENT_ID and FDX_CLIENT_SECRET are set.
 * - 'sfex': Activated if SFEX_PARTNER_ID and SFEX_CHECK_WORD are set.
 *
 * @returns {void} This function doesn't return a value.
 */
export function initializeOperatorStatus(): void {
  setOperatorStatus("eg1", true);
  registerOperatorModule("eg1", Eg1);

  if (Deno.env.get("FDX_CLIENT_ID") && Deno.env.get("FDX_CLIENT_SECRET")) {
    setOperatorStatus("fdx", true);
    registerOperatorModule("fdx", Fdx);
  }

  if (Deno.env.get("SFEX_PARTNER_ID") && Deno.env.get("SFEX_CHECK_WORD")) {
    setOperatorStatus("sfex", true);
    registerOperatorModule("sfex", Sfex);
  }
}
