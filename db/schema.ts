import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

// Revisions stop a stale device from overwriting a newer saved inspection.
export const reports = sqliteTable(
  "reports",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    address: text("address").notNull(),
    payload: text("payload").notNull(),
    revision: integer("revision").notNull().default(1),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("reports_updated_at_idx").on(table.updatedAt)],
);
