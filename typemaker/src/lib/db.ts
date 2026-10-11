import "server-only";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Pool, PoolClient } from "pg";

// One query interface over two backends: Postgres (Supabase, via DATABASE_URL)
// in production and an in-process PGlite database for local dev and tests.

export type SqlParam = string | number | boolean | null | Date;

export interface Db {
  query<T>(sql: string, params?: SqlParam[]): Promise<T[]>;
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
}

export interface Queryable {
  query<T>(sql: string, params?: SqlParam[]): Promise<T[]>;
}

interface PgliteLike {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
  transaction<T>(fn: (tx: { query<R>(sql: string, params?: unknown[]): Promise<{ rows: R[] }> }) => Promise<T>): Promise<T>;
}

const globalForDb = globalThis as unknown as { __typemakerDb?: Promise<Db> };

function migrationsDir(): string {
  return path.join(process.cwd(), "db", "migrations");
}

async function createPglite(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const dataDir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  if (dataDir !== ":memory:") mkdirSync(path.dirname(dataDir), { recursive: true });
  const pg = (await PGlite.create(dataDir === ":memory:" ? undefined : dataDir)) as unknown as PgliteLike;
  const files = readdirSync(migrationsDir()).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    await pg.exec(readFileSync(path.join(migrationsDir(), f), "utf8"));
  }
  return {
    async query<T>(sql: string, params: SqlParam[] = []) {
      return (await pg.query<T>(sql, params)).rows;
    },
    async tx<T>(fn: (q: Queryable) => Promise<T>) {
      return pg.transaction(async (t) =>
        fn({ query: async <R>(sql: string, params: SqlParam[] = []) => (await t.query<R>(sql, params)).rows }),
      );
    },
  };
}

async function createPg(url: string): Promise<Db> {
  const { Pool: PgPool } = await import("pg");
  const pool: Pool = new PgPool({
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 10_000,
    ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false },
  });
  return {
    async query<T>(sql: string, params: SqlParam[] = []) {
      const res = await pool.query(sql, params);
      return res.rows as T[];
    },
    async tx<T>(fn: (q: Queryable) => Promise<T>) {
      const client: PoolClient = await pool.connect();
      try {
        await client.query("begin");
        const out = await fn({
          query: async <R>(sql: string, params: SqlParam[] = []) => (await client.query(sql, params)).rows as R[],
        });
        await client.query("commit");
        return out;
      } catch (e) {
        await client.query("rollback");
        throw e;
      } finally {
        client.release();
      }
    },
  };
}

export function db(): Promise<Db> {
  if (!globalForDb.__typemakerDb) {
    const url = process.env.DATABASE_URL;
    globalForDb.__typemakerDb = url ? createPg(url) : createPglite();
    globalForDb.__typemakerDb.catch(() => {
      globalForDb.__typemakerDb = undefined;
    });
  }
  return globalForDb.__typemakerDb;
}
