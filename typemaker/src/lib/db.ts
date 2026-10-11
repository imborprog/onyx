import "server-only";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ConnectionOptions } from "node:tls";
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

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
// Connection-string parameters that pg would let override the `ssl` object below.
const URL_SSL_PARAMS = ["sslmode", "ssl", "sslrootcert", "sslcert", "sslkey", "sslnegotiation", "uselibpqcompat"];

/**
 * TLS for the Postgres pool, decided here rather than in DATABASE_URL: pg merges URL
 * parameters over this config, and `sslmode=require` would switch to verify-full against
 * Node's trust store (which lacks the Supabase CA), so those parameters are stripped.
 *  - local hosts or `sslmode=disable` in the URL: no TLS;
 *  - DATABASE_CA_CERT set (PEM, e.g. Supabase Dashboard > Database > SSL certificate): TLS with
 *    the certificate and host name verified against that CA;
 *  - otherwise: TLS without certificate verification (see the fallback comment below).
 */
function poolTarget(url: string): { connectionString: string; ssl: false | ConnectionOptions } {
  let connectionString = url;
  let host = "";
  let sslmode: string | null = null;
  try {
    const u = new URL(url);
    host = u.hostname;
    sslmode = u.searchParams.get("sslmode");
    for (const p of URL_SSL_PARAMS) u.searchParams.delete(p);
    connectionString = u.toString();
  } catch {
    // Not WHATWG-parseable: pass it to pg untouched and let pg-connection-string deal with it.
  }
  if (sslmode === "disable" || LOCAL_HOSTS.has(host)) return { connectionString, ssl: false };
  const ca = (process.env.DATABASE_CA_CERT ?? "").replace(/\\n/g, "\n").trim();
  if (ca) return { connectionString, ssl: { ca, rejectUnauthorized: true } };
  // Fallback while DATABASE_CA_CERT is unset: traffic is still encrypted, but any certificate is
  // accepted, so an attacker on the network path could impersonate the database. Set
  // DATABASE_CA_CERT in production to close that gap.
  if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    console.warn("DATABASE_CA_CERT is not set: the database TLS certificate is not verified");
  }
  return { connectionString, ssl: { rejectUnauthorized: false } };
}

async function createPg(url: string): Promise<Db> {
  const { Pool: PgPool } = await import("pg");
  const target = poolTarget(url);
  const pool: Pool = new PgPool({
    connectionString: target.connectionString,
    max: 3,
    idleTimeoutMillis: 10_000,
    ssl: target.ssl,
  });
  return {
    async query<T>(sql: string, params: SqlParam[] = []) {
      const res = await pool.query(sql, params);
      return res.rows as T[];
    },
    async tx<T>(fn: (q: Queryable) => Promise<T>) {
      const client: PoolClient = await pool.connect();
      let broken: Error | undefined;
      try {
        await client.query("begin");
        const out = await fn({
          query: async <R>(sql: string, params: SqlParam[] = []) => (await client.query(sql, params)).rows as R[],
        });
        await client.query("commit");
        return out;
      } catch (e) {
        try {
          await client.query("rollback");
        } catch (rollbackError) {
          // The connection is gone (pooler restart, timeout): drop it instead of returning it to the pool.
          broken = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
        }
        throw e;
      } finally {
        client.release(broken);
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
