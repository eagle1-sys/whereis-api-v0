/**
 * @file dbutil.ts
 * @description Provides functions to initialize and manage PostgreSQL database connection pool
  */
import { Pool } from "https://deno.land/x/postgres/mod.ts";
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
        )
    }
    return dbPool;
}

/**
 * Establishes a connection from the database pool
 *
 * @async
 * @returns {Promise<Client>} A Promise that resolves to a database client connection
 * @throws {Error} If the database pool hasn't been initialized
 *
 * @example
 * ```typescript
 * async function queryDatabase() {
 *   const client = await connect();
 *   // Use client for database operations
 *   await client.end();
 * }
 * ```
 */
export async function connect() {
    if (!dbPool) {
        throw new Error("Database pool not initialized. Call initializeDbPool first.");
    }
    return await dbPool.connect();
}