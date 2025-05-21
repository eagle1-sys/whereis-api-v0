/**
 * @file dbutil.ts
 * @description Provides functions to initialize and manage PostgreSQL database connection pool
 */
import postgres from "postgresjs";
import { logger } from "../tools/logger.ts";

let sql: ReturnType<typeof postgres>;

export function initConnection() {
  try {
    sql = postgres({
      host: Deno.env.get("DATABASE_HOST"),
      port: Number(Deno.env.get("DATABASE_PORT")),
      database: Deno.env.get("DATABASE_NAME"),
      username: Deno.env.get("DATABASE_USER"),
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
