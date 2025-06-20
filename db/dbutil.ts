/**
 * @file dbutil.ts
 * @description Provides functions to initialize and manage PostgreSQL database connection pool
 */
import postgres from "postgresjs";
import { config } from "../config.ts";
import { logger } from "../tools/logger.ts";

let sql: ReturnType<typeof postgres>;

export function initConnection() {
  try {
    sql = postgres({
      host: Deno.env.get("DATABASE_HOST"),
      port: config.database.port,
      database: config.database.name,
      username: config.database.username,
      password: Deno.env.get("DATABASE_PASSWORD"),
      max: 20, // Maximum number of connections in the pool
      max_lifetime: null, // Max lifetime in seconds (more info below)
      idle_timeout: 20, // Idle connection timeout in seconds
      connect_timeout: 30, // Connect timeout in seconds
    });

    logger.info(
      `Database connection pool to ${Deno.env.get("DATABASE_HOST")}:${Deno.env.get("DATABASE_PORT")} initialized successfully`,
    );
  } catch (error) {
    logger.error("Error initializing database connection pool:", error);
    throw new Error("Failed to initialize database connection pool");
  }
}

export { sql };
