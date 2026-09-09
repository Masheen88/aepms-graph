import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { handleApi } from "./api.js";

// Local development uses a real SQLite file, with the same migrations and API.
// This adapter stays out of the browser and production Worker bundles.
export function localDatabase(root) {
  mkdirSync(resolve(root, ".data"), { recursive: true });
  const sqlite = new DatabaseSync(resolve(root, ".data/reports.sqlite"));
  sqlite.exec("PRAGMA journal_mode=WAL;");
  sqlite.exec(
    "CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY);",
  );
  for (const name of readdirSync(resolve(root, "drizzle"))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    if (
      sqlite.prepare("SELECT name FROM local_migrations WHERE name=?").get(name)
    )
      continue;
    sqlite.exec("BEGIN");
    try {
      sqlite.exec(readFileSync(resolve(root, "drizzle", name), "utf8"));
      sqlite
        .prepare("INSERT INTO local_migrations (name) VALUES (?)")
        .run(name);
      sqlite.exec("COMMIT");
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  return {
    close: () => sqlite.close(),
    prepare(sql) {
      let values = [];
      const statement = {
        bind(...args) {
          values = args;
          return statement;
        },
        async first() {
          return sqlite.prepare(sql).get(...values) ?? null;
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...values) };
        },
        async run() {
          const r = sqlite.prepare(sql).run(...values);
          return { meta: { changes: Number(r.changes) } };
        },
      };
      return statement;
    },
  };
}
export function localApi() {
  let db;
  const mount = (server) => {
    db = localDatabase(process.cwd());
    server.httpServer?.once("close", () => db.close());
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith("/api/")) return next();
      try {
        const origin = `http://${req.headers.host}`;
        const headers = new Headers();
        for (const [key, val] of Object.entries(req.headers))
          if (val) headers.set(key, Array.isArray(val) ? val.join(",") : val);
        const request = new Request(new URL(req.url, origin), {
          method: req.method,
          headers,
          ...(req.method !== "GET" && req.method !== "HEAD"
            ? { body: req, duplex: "half" }
            : {}),
        });
        const response = await handleApi(request, db);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: "The local report service is unavailable." }),
        );
      }
    });
  };
  return {
    name: "fieldbook-local-api",
    configureServer: mount,
    configurePreviewServer: mount,
  };
}
