#!/usr/bin/env node
/** Server/operator-only. Never import into the application bundle.
 * Dry-run by default. No name-based matching and no guessed list of seed IDs.
 * Existing production schema has embedded ordered tracks, not an item table.
 */
import { createClient } from "@supabase/supabase-js";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function provenSeedMarker(row) {
  if (row.is_demo === true) return ["is_demo", true];
  if (row.source === "seed") return ["source", "seed"];
  return null;
}
export function cleanupReport(rows) {
  return rows.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    track_count: Array.isArray(row.tracks) ? row.tracks.length : 0,
    marker: provenSeedMarker(row),
    action: provenSeedMarker(row) ? "eligible" : "retain-unproven",
  }));
}
async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error(
      "Operator environment required: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Dry-run is default. Never use NEXT_PUBLIC_ for this key."
    );
  const projectRef = new URL(url).hostname.split(".")[0];
  if (apply && !process.argv.includes(`--confirm-project=${projectRef}`))
    throw new Error(`Apply requires --confirm-project=${projectRef}`);
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client
      .from("user_playlists")
      .select("*")
      .order("user_id")
      .order("id")
      .range(offset, offset + 499);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 500) break;
  }
  const report = cleanupReport(rows);
  console.log(
    JSON.stringify(
      {
        project: projectRef,
        mode: apply ? "apply" : "dry-run",
        total: rows.length,
        records: report,
      },
      null,
      2
    )
  );
  const candidates = rows.filter(provenSeedMarker);
  if (!candidates.length) {
    console.log(
      "No proven seed records. Nothing deleted. Unmarked records require an explicit provenance audit, not name matching."
    );
    return;
  }
  if (!apply) {
    console.log(
      "No data changed. Apply will write a private backup before any deletion."
    );
    return;
  }
  const dir = path.resolve(
    process.env.CLEANUP_BACKUP_DIR || ".private-backups"
  );
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const backup = path.join(
    dir,
    `playlist-seed-${projectRef}-${Date.now()}.json`
  );
  const handle = await open(backup, "wx", 0o600);
  try {
    await handle.writeFile(
      JSON.stringify(
        {
          project: projectRef,
          created_at: new Date().toISOString(),
          schema: "user_playlists with embedded tracks",
          rows: candidates,
        },
        null,
        2
      )
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
  console.log(
    `Backup written: ${backup}. Keep this file private and copy to durable operator storage.`
  );
  for (const row of candidates) {
    const [column, value] = provenSeedMarker(row);
    let query = client
      .from("user_playlists")
      .delete()
      .eq("user_id", row.user_id)
      .eq("id", row.id)
      .eq(column, value);
    if (row.updated_at) query = query.eq("updated_at", row.updated_at);
    if (row.version !== undefined) query = query.eq("version", row.version);
    const { data, error } = await query.select("id");
    if (error)
      throw new Error(`Stopped cleanup: ${error.message}. Backup retained.`);
    console.log(
      `${data?.length ? "Deleted verified seed" : "Skipped changed row"}: ${
        row.id
      }`
    );
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
