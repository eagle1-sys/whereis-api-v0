/**
 * @file dbutil.ts
 * @description Provides functions to initialize and manage PostgreSQL database connection pool
 */
import { Pool, PoolClient } from "https://deno.land/x/postgres/mod.ts";
import { delay } from "https://deno.land/std/async/delay.ts";
import { logger } from "../tools/logger.ts";
const POOL_CONNECTIONS = 20;

/**
 * @type {Pool | null}
 * @description Database connection pool instance or null if not initialized
 */
let dbPool: Pool | null = null;

/**
 * Initializes the database connection pool if it hasn't been initialized yet
 *
 * @returns {Pool} The initialized database connection pool instance
 * @throws {Error} If environment variables for database configuration are not set
 *
 * @example
 * ```typescript
 * const pool = initializeDbPool();
 * ```
 */
export function initializeDbPool(): Pool {
  if (!dbPool) {
    dbPool = new Pool(
      {
        database: Deno.env.get("DATABASE_NAME"),
        hostname: Deno.env.get("DATABASE_HOST"),
        password: Deno.env.get("DATABASE_PASSWORD"),
        port: Deno.env.get("DATABASE_PORT"),
        user: Deno.env.get("DATABASE_USER"),
      },
      POOL_CONNECTIONS,
    );
  }
  return dbPool;
}

/**
 * Establishes a connection from the database pool
 * @async
 * @returns {Promise<PoolClient>} A Promise that resolves to a database client connection
 * @throws {Error} If the database pool hasn't been initialized
 */
export async function connect(): Promise<PoolClient> {
  if (!dbPool) {
    throw new Error(
      "Database pool not initialized. Call initializeDbPool first.",
    );
  }

  let retries = 0;
  const maxRetries = 5;
  const retryDelay = 200;
  while (retries < maxRetries) {
    try {
      return await dbPool.connect();
    } catch (error) {
      retries++;
      if (retries >= maxRetries) {
        if (error instanceof Error) {
          logger.error(
            "Error DBUTIL-01: Cannot connect to the database:",
            error.message,
          );
          throw new Error(
            `Error DBUTIL-01: Cannot connect to the database: ${error.message}`,
          );
        } else {
          logger.error("Unknown error connecting to the database");
          throw new Error("Failed to connect to the database: Unknown error");
        }
      }
      logger.warn(
        `Connecting to database attempt ${retries} failed. Retrying in ${retryDelay}ms...`,
      );
      await delay(retryDelay);
    }
  }

  // This line should never be reached due to the throw in the loop, but TypeScript needs it
  throw new Error("Unexpected error in connect function");
}
