/**
 * @file dbutil.ts
 * @description Provides functions to initialize and manage PostgreSQL database connection pool
 */
import postgres from "postgresjs";
import { logger } from "../tools/logger.ts";

let sql: ReturnType<typeof postgres>;

export async function initConnection() {
  try {
    sql = postgres({
      host: Deno.env.get("DB_HOST"),
      port: Number(Deno.env.get("DB_PORT")),
      database: Deno.env.get("DB_NAME"),
      username: Deno.env.get("DB_USER"),
      password: Deno.env.get("DB_PASSWORD"),
      max: 20, // Maximum number of connections in the pool
      max_lifetime: null, // Max lifetime in seconds (more info below)
      idle_timeout: 20, // Idle connection timeout in seconds
      connect_timeout: 30, // Connect timeout in seconds
    });

    logger.info(
        `Trying to init DB connection pool to ${Deno.env.get("DB_HOST")}:${Deno.env.get("DB_PORT")}.`,
    );
    // Test the connection by executing a simple query
    const testResult = await sql`SELECT 1 as connection_test`;
    if (testResult[0].connection_test === 1) {
      logger.info(
          `DB connection pool to ${Deno.env.get("DB_HOST")}:${Deno.env.get("DB_PORT")} initialized successfully.`,
      );
    }
  } catch (err) {
    logger.error("Error initializing database connection pool:", err);
    throw new Error("Failed to initialize database connection pool");
  }
}

export { sql };
