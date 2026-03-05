/**
 * DB-only migration: update skill names in tasks.skills and cycle_log.skills_loaded
 */
import Database from "bun:sqlite";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(import.meta.dir, "..");
const DB_PATH = resolve(ROOT, "db", "arc.sqlite");
const MAP_PATH = resolve(ROOT, "scripts", "skill-rename-map.json");

const RENAME_MAP: Record<string, string> = JSON.parse(readFileSync(MAP_PATH, "utf-8"));
const CHANGES = Object.entries(RENAME_MAP)
  .filter(([old, nw]) => old !== nw)
  .sort((a, b) => b[0].length - a[0].length);

const db = new Database(DB_PATH);

// Update tasks.skills
const rows = db.query<{ id: number; skills: string }, []>(
  "SELECT id, skills FROM tasks WHERE skills IS NOT NULL AND skills != '' AND skills != '[]'"
).all();
console.log(`Tasks with skills: ${rows.length}`);

let updatedCount = 0;
const updateStmt = db.prepare("UPDATE tasks SET skills = ? WHERE id = ?");

db.transaction(() => {
  for (const row of rows) {
    let modified = row.skills;
    for (const [oldName, newName] of CHANGES) {
      modified = modified.replaceAll(`"${oldName}"`, `"${newName}"`);
    }
    if (modified !== row.skills) {
      updatedCount++;
      updateStmt.run(modified, row.id);
    }
  }
})();

console.log(`Updated tasks: ${updatedCount}`);

// Update cycle_log.skills_loaded
const cycleRows = db.query<{ id: number; skills_loaded: string }, []>(
  "SELECT id, skills_loaded FROM cycle_log WHERE skills_loaded IS NOT NULL AND skills_loaded != ''"
).all();

let cycleUpdated = 0;
const cycleStmt = db.prepare("UPDATE cycle_log SET skills_loaded = ? WHERE id = ?");

db.transaction(() => {
  for (const row of cycleRows) {
    let modified = row.skills_loaded;
    for (const [oldName, newName] of CHANGES) {
      modified = modified.replaceAll(`"${oldName}"`, `"${newName}"`);
    }
    if (modified !== row.skills_loaded) {
      cycleUpdated++;
      cycleStmt.run(modified, row.id);
    }
  }
})();

console.log(`Updated cycle_log: ${cycleUpdated}`);
db.close();
console.log("Done.");
