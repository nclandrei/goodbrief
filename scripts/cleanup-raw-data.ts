/**
 * Cleans up old raw data files, keeping only current and previous week.
 * Never touches drafts - only cleans data/raw/ directory.
 */
import * as fs from "fs";
import * as path from "path";

const RAW_DATA_DIR = path.join(process.cwd(), "data", "raw");

function getISOWeek(date: Date): string {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );
  return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, "0")}`;
}

function getPreviousWeek(isoWeek: string): string {
  const [year, week] = isoWeek.split("-W").map(Number);
  if (week === 1) {
    // Previous week is last week of previous year (52 or 53)
    const dec31 = new Date(Date.UTC(year - 1, 11, 31));
    return getISOWeek(dec31);
  }
  return `${year}-W${(week - 1).toString().padStart(2, "0")}`;
}

function cleanupRawData(): void {
  const currentWeek = getISOWeek(new Date());
  const previousWeek = getPreviousWeek(currentWeek);
  const weeksToKeep = new Set([currentWeek, previousWeek]);

  console.log(`Current week: ${currentWeek}`);
  console.log(`Previous week: ${previousWeek}`);
  console.log(`Keeping raw data for: ${Array.from(weeksToKeep).join(", ")}`);

  if (!fs.existsSync(RAW_DATA_DIR)) {
    console.log("No raw data directory found, nothing to clean.");
    return;
  }

  const files = fs.readdirSync(RAW_DATA_DIR);
  let deletedCount = 0;

  for (const file of files) {
    const match = file.match(/^(\d{4}-W\d{2})\.json$/);
    if (!match) {
      console.log(`Skipping non-matching file: ${file}`);
      continue;
    }

    const fileWeek = match[1];
    if (weeksToKeep.has(fileWeek)) {
      console.log(`Keeping: ${file}`);
    } else {
      const filePath = path.join(RAW_DATA_DIR, file);
      fs.unlinkSync(filePath);
      console.log(`Deleted: ${file}`);
      deletedCount++;
    }
  }

  console.log(`\nCleanup complete. Deleted ${deletedCount} file(s).`);
}

cleanupRawData();
