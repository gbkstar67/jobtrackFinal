/**
 * One-time import of the shop's paper job log into JobTrack.
 *
 *   npx tsx script/import-jobs.ts
 *
 * Transcribed from the 6/29/26 job sheet. Job numbers are taken verbatim from
 * the sheet rather than generated, so the board matches the paper log exactly.
 * After this runs, getNextJobNumber() continues from the highest number here.
 *
 * Job and customer names follow the sheet, with five spellings corrected at
 * Grant's direction (BEHAVIORAL, BLAIRSVILLE, HEMATOLOGY, MOTORIZED,
 * MONROEVILLE). 26280 "ASTIQUE" is correct as printed and left alone.
 *
 * Re-running is safe: a job number already on the board is skipped, not duplicated.
 *
 * Flags (for running over `railway ssh`, which gives no interactive terminal):
 *   --wipe-jobs      delete every existing job first
 *   --wipe-activity  also clear the activity log
 *   --yes            don't prompt; act on the flags as given
 */
import readline from "readline";
import { sqlite } from "../server/db";

/**
 * [job number, job name, customer, bid by, billing type] — straight off the
 * sheet, in sheet order.
 *
 * bid by      : HT = Henry Thomas, DV = Derek Victor
 * billing type: CO = contract, TM = time & material
 *
 * 26395 is written "MTB" on the sheet; Grant confirmed it is CO.
 * 09400 is the overhead account and carries neither code.
 */
const JOBS: Array<[string, string, string, string | null, string | null]> = [
  ["09400", "SHOP OVERHEAD", "INTERNAL", null, null],
  ["24163", "UOP CHEVRON 11TH & 12TH FLOORS", "FIRST AMERICAN", "DV", "CO"],
  ["24271", "VA UD 6E", "R & B MECHANICAL", "DV", "CO"],
  ["25427", "BELMONT CITY MEDICAL RECORDS", "SENTRY", "DV", "CO"],
  ["25495", "PSU LAUNDRY", "WAYNE CROUSE", "DV", "CO"],
  ["25531", "PSU BRYCE JORDAN CENTER", "WAYNE CROUSE", "DV", "CO"],
  ["25532", "IH - LAH 1ST FL ADULT BEH. HEALTH FIT-OUT", "A. MARTINI", "HT", "CO"],
  ["25533", "IH - LAH LATROBE CENTRAL STERILE", "IH - LATROBE", "HT", "CO"],
  ["25548", "UPMC SOUTHSIDE SSDC", "SENTRY", "HT", "CO"],
  ["25563", "PSU CLASSROOMS", "WAYNE CROUSE", "DV", "CO"],
  ["25626", "WASHINGTON HOSPITAL BEHAVIORAL HEALTH", "WALLER", "HT", "CO"],
  ["25628", "BUTLER PET CT", "ARTECH GROUP", "HT", "CO"],
  ["25647", "CLEARWATER CONSERVANCY", "WAYNE CROUSE", "DV", "CO"],
  ["25693", "UPMC WASHINGTON HOSP. LINAC REPLACEMENT", "SENTRY", "HT", "CO"],
  ["25698", "WESTINGHOUSE BLAIRSVILLE CAFE", "ARTECH GROUP", "HT", "CO"],
  ["25700", "MSA EXHAUST DUCT LAB EQUIPMENT", "MSA", "HT", "CO"],
  ["25727", "IH - WRH MAIN ENTRANCE LOBBY", "ARTECH GROUP", "HT", "CO"],
  ["26100", "IH - NORWIN MRI", "ARTECH GROUP", "HT", "CO"],
  ["26116", "IH - WRH ED BYPASS", "IH - WESTMORELAND", "HT", "TM"],
  ["26265", "IH - FRICK ED BREAKROOM REHEAT", "IH - FRICK", "HT", "CO"],
  ["26268", "IH - WRH PATHOLOGY OA DAMPER", "IH - FRICK", "HT", "CO"],
  ["26274", "IH - WRH PRE POST CARE", "ARTECH GROUP", "HT", "CO"],
  ["26280", "IRMC ASTIQUE MRI", "IRMC", "HT", "TM"],
  ["26294", "IH-WRH 7TH FLR OR DAMPER", "IH-WRH", "HT", "CO"],
  ["26300", "UNIONTOWN MCQUAY STEAM COIL", "UNIONTOWN HOSP.", "HT", "CO"],
  ["26312", "IH - CATH LAB UNIT PP", "IH - WESTMORELAND", "HT", "CO"],
  ["26313", "IRMC DUCT DEMO 2ND FLOOR BATHROOM", "IRMC", "HT", "CO"],
  ["26314", "RIDC 37 & 38 NKAMP", "RYCON", "HT", "CO"],
  ["26315", "IH - FRICK RTU12 OA DAMPER REPLACEMENT", "IH - FRICK", "HT", "CO"],
  ["26318", "BUTLER CAO", "ARTECH GROUP", "HT", "CO"],
  ["26327", "IH - FRICK BLOOD DRAW FAN REPLACEMENT", "IH - FRICK", "HT", "CO"],
  ["26329", "UOC DUBOIS EXAM & X-RAY", "OVERDORF SNYDER", "HT", "CO"],
  ["26338", "IRMC IASA MED GAS", "IRMC", "HT", "TM"],
  ["26339", "IRMC MAB ONCOLOGY ACCESS DOORS", "IRMC", "HT", "TM"],
  ["26349", "ST.CLAIR HOSPITAL FLUE FLASHING", "WAYNE CROUSE", "DV", "CO"],
  ["26350", "IH - WESTMORELAND SPLIT SYSTEM HEMATOLOGY", "IH - WESTMORELAND", "HT", "CO"],
  ["26360", "IUP LEONARD HALL TEMP COM SPACE", "LIMBACH", "HT", "CO"],
  ["26365", "BAKER HUGHES TALLMADGE", "ARTECH GROUP", "HT", "CO"],
  ["26391", "DNP FILTER RACKS", "DNP", "HT", "CO"],
  ["26395", "PAWLAK MSA BUILDING D.", "PAWLAK", "DV", "CO"],
  ["26398", "PAWLAK MSA BUILDING D. EXHAUST", "PAWLAK", "DV", "TM"],
  ["26404", "IH WESTMORELAND COFFEE SHOP", "IH - WESTMORELAND", "HT", "CO"],
  ["26406", "IRMC PENNINGTON CONSTRUCTION", "IRMC/PENNINGTON", "HT", "CO"],
  ["26414", "IH-FRICK MINI SPLIT", "IH-FRICK", "HT", "CO"],
  ["26415", "IH-WRH MOTORIZED DAMPERS", "IH-WESTMORELAND", "HT", "CO"],
  ["26417", "IH - WESTMORELAND CARDIAC EXP. #5", "ARTECH GROUP", "HT", "CO"],
  ["26422", "PAWLAK MSA BLDG D2", "PAWLAK", "DV", "TM"],
  ["26424", "IH - NORWIN RTU4 REPAIRS", "IH - NORWIN", "HT", "CO"],
  ["26437", "IRMC IASA 3RD FLOOR", "LIMBACH", "HT", "CO"],
  ["26450", "MSA MURRYSVILLE LAB EF AND DUCT", "MSA", "HT", "CO"],
  ["26452", "PAH NEW STORAGE", "OVERDORF SNYDER", "HT", "CO"],
  ["26454", "CVS MONROEVILLE", "FORTNEY & WEYGANDT", "HT", "CO"],
  ["26462", "MCDONALDS WESTMORELAND MALL", "WESTMORELAND MALL", "HT", "CO"],
  ["26465", "LOCAL 354 FUME COLLECTOR EXHAUST DUCT", "LOCAL 354", "HT", "CO"],
  ["26467", "DNP FLEX", "DNP", "HT", "CO"],
  ["26469", "IRMC IASA FIRE/SMOKE DAMPER", "IRMC", "HT", "TM"],
  ["26485", "EASTERN ALLOY ANGLES", "EASTERN ALLOY", "DV", "TM"],
];

/** Grant — id 1, per script/seed-users.ts. The import is recorded under his name. */
const IMPORTED_BY = 1;

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);

async function main() {
  const nonInteractive = flag("--yes");
  console.log(`\nImporting into: ${process.env.DATABASE_PATH || "./data.db"}`);
  console.log(`Jobs on the sheet: ${JOBS.length}\n`);

  const existingJobs = (sqlite.prepare("SELECT COUNT(*) AS n FROM jobs").get() as { n: number }).n;
  const existingActivity = (sqlite.prepare("SELECT COUNT(*) AS n FROM activity_log").get() as { n: number }).n;

  console.log(`Currently on the board: ${existingJobs} job(s), ${existingActivity} activity row(s).`);

  let wipe = flag("--wipe-jobs");
  let wipeActivity = flag("--wipe-activity");

  if (!nonInteractive) {
    if (existingJobs > 0) {
      const answer = await prompt(
        `\nDelete all ${existingJobs} existing job(s) first for a clean slate? (yes/no): `,
      );
      wipe = answer.toLowerCase() === "yes";
      if (!wipe) console.log("Keeping existing jobs. Sheet numbers already present will be skipped.");
    }
    if (wipe && existingActivity > 0) {
      const answer = await prompt(
        `Also clear the ${existingActivity} old activity row(s)? They refer to the jobs being deleted. (yes/no): `,
      );
      wipeActivity = answer.toLowerCase() === "yes";
    }
  }

  console.log(`Plan: ${wipe ? "DELETE all existing jobs" : "keep existing jobs"}, ` +
              `${wipeActivity ? "CLEAR activity log" : "keep activity log"}, import ${JOBS.length} job(s).`);

  const now = new Date().toISOString();
  let inserted = 0;
  const skipped: string[] = [];
  const corrected: string[] = [];

  // One transaction: either the whole board ends up correct, or nothing changed.
  sqlite.transaction(() => {
    if (wipe) sqlite.prepare("DELETE FROM jobs").run();
    if (wipeActivity) sqlite.prepare("DELETE FROM activity_log").run();

    const currentRow = sqlite.prepare(
      "SELECT id, job_name, client_name, bid_by, billing_type FROM jobs WHERE job_number = ?",
    );
    const updateJob = sqlite.prepare(
      "UPDATE jobs SET job_name = ?, client_name = ?, bid_by = ?, billing_type = ? WHERE id = ?",
    );
    const insertJob = sqlite.prepare(
      `INSERT INTO jobs (job_number, job_name, client_name, bid_by, billing_type, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertActivity = sqlite.prepare(
      `INSERT INTO activity_log (job_id, job_number, job_name, employee_id, action, details, timestamp)
       VALUES (?, ?, ?, ?, 'created', ?, ?)`,
    );

    for (const [jobNumber, jobName, clientName, bidBy, billingType] of JOBS) {
      const current = currentRow.get(jobNumber) as
        | { id: number; job_name: string; client_name: string; bid_by: string | null; billing_type: string | null }
        | undefined;

      if (current) {
        // Already on the board. Bring it into line with the sheet if anything
        // drifted, so re-running applies corrections and backfills the codes
        // instead of silently skipping.
        const changes: string[] = [];
        if (current.job_name !== jobName) changes.push(`name "${current.job_name}" -> "${jobName}"`);
        if (current.client_name !== clientName) changes.push(`client "${current.client_name}" -> "${clientName}"`);
        if ((current.bid_by ?? null) !== bidBy) changes.push(`bid ${current.bid_by ?? "-"} -> ${bidBy ?? "-"}`);
        if ((current.billing_type ?? null) !== billingType) changes.push(`billing ${current.billing_type ?? "-"} -> ${billingType ?? "-"}`);

        if (changes.length) {
          updateJob.run(jobName, clientName, bidBy, billingType, current.id);
          corrected.push(`${jobNumber}: ${changes.join(", ")}`);
        } else {
          skipped.push(jobNumber);
        }
        continue;
      }
      const info = insertJob.run(jobNumber, jobName, clientName, bidBy, billingType, IMPORTED_BY, now);
      insertActivity.run(
        info.lastInsertRowid as number, jobNumber, jobName, IMPORTED_BY,
        `Grant imported job ${jobNumber} (${jobName})`, now,
      );
      inserted += 1;
    }
  })();

  const total = (sqlite.prepare("SELECT COUNT(*) AS n FROM jobs").get() as { n: number }).n;
  const maxNum = (
    sqlite.prepare("SELECT MAX(CAST(job_number AS INTEGER)) AS m FROM jobs").get() as { m: number | null }
  ).m;

  console.log(`\nImported : ${inserted}`);
  if (corrected.length) {
    console.log(`Updated  : ${corrected.length}`);
    for (const c of corrected) console.log(`   ${c}`);
  }
  if (skipped.length) console.log(`Skipped  : ${skipped.length} already correct`);
  console.log(`On board : ${total} job(s)`);
  console.log(`Highest job number: ${maxNum}  ->  next new job will be ${(maxNum ?? 0) + 1}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("\nImport failed. Nothing was committed:", err);
  process.exit(1);
});
