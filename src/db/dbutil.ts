/**
 * @file dbutil.ts
 * @description Provides functions to initialize and manage PostgreSQL database connection pool
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */
import postgres from "postgresjs";
import { DatabaseWrapper } from "./db_wrapper.ts";
import { PostgresWrapper } from "./db_postgres.ts";

let dbClient: DatabaseWrapper;

import {whereIsAPI, logger} from "../tools/logger.ts";
import { join } from '@std/path';
import { exists } from "@std/fs/exists";
import {AppError} from "../main/model.ts";

export async function initConnection() {
  const dbType = Deno.env.get("DB_TYPE") || "sqlite";
  if (dbType === "postgres") {
    const sql = await initPgConnection();
    dbClient = new PostgresWrapper(sql);
  } else {
    // Dynamically import SQLite dependencies only when needed
    const { SQLiteWrapper } = await import("./db_sqlite.ts");
    const { Database } = await import("sqlite");
    const volume_path = Deno.env.get("DB_FILE_DIR") ?? "../data";
    const db_file = join(volume_path, 'whereis.sqlite');
    if (!await exists(db_file)) {
      logger.info(`${whereIsAPI("startup")} Init SQLite database file at ${db_file}`);
      const src_file = 'config/whereis.sqlite';
      await Deno.copyFile(src_file, db_file);
    }
    const db = new Database(db_file);
    dbClient = new SQLiteWrapper(db);
    logger.info(`${whereIsAPI("startup")} SQLite database is ready`);
  }
}

async function initPgConnection() : Promise<postgres.Sql> {
  let sql: postgres.Sql;
  const dbHost = Deno.env.get("DB_HOST");
  const dbPort = Number(Deno.env.get("DB_PORT") ?? "5432")
  if (!dbHost) {
    throw new AppError("500-01", `ERR-DBUTIL-A - DB_HOST environment variable is not set.`);
  }

  try {
    sql = postgres({
      host: dbHost,
      port: dbPort,
      database: Deno.env.get("DB_NAME"),
      username: Deno.env.get("DB_USER"),
      password: Deno.env.get("DB_PASSWORD"),
      max: 20,              // Maximum number of connections in the pool
      max_lifetime: null,   // Max lifetime in seconds (more info below)
      idle_timeout: 60,     // Idle connection timeout in seconds
      connect_timeout: 30,  // Connect timeout in seconds
    });

    // Test the connection by executing a simple query
    const testResult = await sql`SELECT 1 as connection_test`;
    if (testResult[0].connection_test === 1) {
      logger.info(`${whereIsAPI("startup")} DB connection pool to ${dbHost}:${dbPort} initialized successfully.`);
    }

    return sql;
  } catch (err) {
    const errText = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    if (err instanceof Error) {
      const errorMessage = err.message;
      if (/connection refused/i.test(errorMessage)) {
        logger.error(`${whereIsAPI("exception")} DB connection: Connection refused - check if the db service is running`);
      } else if (/connect_timeout/i.test(errorMessage)) {
        logger.error(`${whereIsAPI("exception")} DB connection: Connect timeout - check if the db host/port is correct`);
      } else if (/failed to lookup address/i.test(errorMessage)) {
        logger.error(`${whereIsAPI("exception")} DB connection: Unknown server name - check if the db server name is correct`);
      } else {
        logger.error(`${whereIsAPI("exception")} Error initializing database connection pool: ${errorMessage}`);
      }
    } else {
      logger.error(`${whereIsAPI("exception")} Error initializing database connection pool: ${err}`);
    }
    throw new AppError("500-01", `ERR-DBUTIL-B - Failed to initialize database connection pool: ${errText}`);
  }
}

export { dbClient };