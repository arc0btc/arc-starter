import { Database } from "bun:sqlite";

const db = new Database("db/arc.sqlite");
const result = db.query("SELECT result_summary, result_detail FROM tasks WHERE id = 7596").all();
console.log(JSON.stringify(result, null, 2));
