/**
 * @file dbutil.ts
 * @description Provides functions to initialize and manage PostgreSQL database connection pool
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */
import postgres from "postgresjs";
import { logger } from "../tools/logger.ts";

let db: Database | undefined;
let sql: ReturnType<typeof postgres> | undefined;
import { Database } from "sqlite";
import { initDatabase, insertToken } from "./db_sqlite.ts";

export async function initConnection() {
  const dbType = Deno.env.get("DB_TYPE") || "sqlite";
  if (dbType === "postgres") {
    await initPgConnection();
  } else {
    db = new Database("whereis.db");
    initDatabase(db);
    insertToken(db, "eagle1", "test_user");
  }
}

export async function initPgConnection() {
  const dbHost = Deno.env.get("DB_HOST");
  if (!dbHost) {
    throw new Error("DB_HOST environment variable is not set.");
  }

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
      `Trying to init DB connection pool to ${Deno.env.get("DB_HOST")}:${
        Deno.env.get("DB_PORT")
      }.`,
    );
    // Test the connection by executing a simple query
    const testResult = await sql`SELECT 1 as connection_test`;
    if (testResult[0].connection_test === 1) {
      logger.info(
        `DB connection pool to ${Deno.env.get("DB_HOST")}:${
          Deno.env.get("DB_PORT")
        } initialized successfully.`,
      );
    }
  } catch (err) {
    if (err instanceof Error) {
      const errorMessage = err.message;
      if (/connection refused/i.test(errorMessage)) {
        logger.error(
          "DB connection: Connection refused - check if the db service is running",
        );
      } else if (/connect_timeout/i.test(errorMessage)) {
        logger.error(
          "DB connection: Connect timeout - check if the db host/port is correct",
        );
      } else if (/failed to lookup address/i.test(errorMessage)) {
        logger.error(
          "DB connection: Unknown server name  - check if the db server name is correct",
        );
      }
    } else {
      logger.error("Error initializing database connection pool:", err);
    }
    throw new Error("Failed to initialize database connection pool");
  }
}

export { db, sql };
