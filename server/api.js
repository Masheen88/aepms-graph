import { reportSchema } from "../src/lib/model.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

// Keep SQL behind this boundary. Each prepared call contains exactly one statement.
export async function handleApi(request, db) {
  const url = new URL(request.url);
  if (!db)
    return json(
      {
        error:
          "Report storage is unavailable. Your current work is still on screen.",
      },
      503,
    );
  try {
    if (request.method !== "GET") {
      const origin = request.headers.get("Origin");
      if (origin && origin !== url.origin)
        return json({ error: "This request came from another site." }, 403);
      if (!request.headers.get("Content-Type")?.startsWith("application/json"))
        return json({ error: "Expected a JSON report." }, 415);
    }
    if (url.pathname === "/api/reports" && request.method === "GET") {
      const rows = await db
        .prepare(
          "SELECT id, title, address, revision, updated_at FROM reports ORDER BY updated_at DESC LIMIT 500",
        )
        .all();
      return json({ reports: rows.results });
    }
    const match = /^\/api\/reports\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (!match) return json({ error: "Unknown report endpoint." }, 404);
    const id = match[1];
    if (request.method === "GET") {
      const row = await db
        .prepare(
          "SELECT payload, revision, updated_at FROM reports WHERE id = ?",
        )
        .bind(id)
        .first();
      return row
        ? json({
            report: JSON.parse(row.payload),
            revision: row.revision,
            updatedAt: row.updated_at,
          })
        : json({ error: "That report was not found." }, 404);
    }
    if (request.method !== "PUT")
      return json({ error: "Method not allowed." }, 405);
    // Read a bounded stream, even when Content-Length is absent or inaccurate.
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "Missing report." }, 400);
    const parts = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 3_000_000) {
        await reader.cancel();
        return json({ error: "The report exceeds the 3 MB limit." }, 413);
      }
      parts.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    let body;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return json({ error: "The report file is not valid JSON." }, 400);
    }
    const parsed = reportSchema.safeParse(body.report);
    if (!parsed.success)
      return json(
        { error: parsed.error.issues[0]?.message || "Invalid report." },
        400,
      );
    const report = parsed.data,
      revision = body.expectedRevision;
    if (report.id !== id || !Number.isInteger(revision) || revision < 0)
      return json({ error: "Invalid report identity or revision." }, 400);
    const now = new Date().toISOString(),
      payload = JSON.stringify(report);
    const query =
      revision === 0
        ? db
            .prepare(
              "INSERT INTO reports (id,title,address,payload,revision,updated_at) VALUES (?,?,?,?,1,?) ON CONFLICT(id) DO NOTHING",
            )
            .bind(id, report.title, report.street, payload, now)
        : db
            .prepare(
              "UPDATE reports SET title=?, address=?, payload=?, revision=revision+1, updated_at=? WHERE id=? AND revision=?",
            )
            .bind(report.title, report.street, payload, now, id, revision);
    const result = await query.run();
    if (result.meta.changes !== 1)
      return json(
        {
          error:
            "A newer version was saved on another device. Download a backup of your changes, then reopen the saved report.",
        },
        409,
      );
    return json({ revision: revision + 1, updatedAt: now });
  } catch (error) {
    console.error(
      "Report storage failed:",
      error instanceof Error ? error.message : "Unknown storage error",
    );
    return json(
      {
        error:
          "Could not access saved reports. Keep this page open or download a backup and try again.",
      },
      503,
    );
  }
}
