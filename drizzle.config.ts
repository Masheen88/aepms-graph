import { defineConfig } from "drizzle-kit";

// One schema is used by the hosted D1 database and local SQLite development.
export default defineConfig({
  dialect: "sqlite",
  schema: "./db/schema.ts",
  out: "./drizzle",
});
