/**
 * Pull a backup without going through HTTP.
 *
 *   railway ssh    then    npx tsx script/backup.ts
 *
 * Writes a VACUUM INTO snapshot onto the mounted volume, where it survives a
 * redeploy. Preferred over the admin HTTP route: no token to handle, no
 * request timeout on a growing database, and nothing exposed to the internet.
 */
import fs from "fs";
import path from "path";
import { sqlite } from "../server/db";

const dir = process.env.BACKUP_DIR || "/data";
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dest = path.join(dir, `jobdeck-backup-${stamp}.db`);

sqlite.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
const size = fs.statSync(dest).size;

console.log(`\n  wrote ${dest} (${(size / 1024).toFixed(0)} KB)\n`);
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".db")).sort()) {
  console.log(`   ${f}  ${(fs.statSync(path.join(dir, f)).size / 1024).toFixed(0)} KB`);
}

// Keep the five most recent snapshots; the volume is 500MB, not a backup service.
const snaps = fs.readdirSync(dir).filter((f) => f.startsWith("jobdeck-backup-")).sort();
for (const old of snaps.slice(0, Math.max(0, snaps.length - 5))) {
  fs.unlinkSync(path.join(dir, old));
  console.log(`   pruned ${old}`);
}
process.exit(0);
