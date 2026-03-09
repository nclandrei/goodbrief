import { join } from 'path';

export const LEGACY_VALIDATION_CUTOFF_WEEK = '2026-W10';

interface ParsedWeekId {
  year: number;
  week: number;
}

export interface IssuePublicationInfo {
  date: string;
  displayDate: string;
  filename: string;
  outputPath: string;
}

const ROMANIAN_MONTHS_SHORT = [
  'ian',
  'feb',
  'mar',
  'apr',
  'mai',
  'iun',
  'iul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];

export function parseWeekId(weekId: string): ParsedWeekId {
  const match = weekId.match(/^(\d{4})-W(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid week ID: ${weekId}`);
  }

  return {
    year: Number.parseInt(match[1], 10),
    week: Number.parseInt(match[2], 10),
  };
}

export function compareWeekIds(left: string, right: string): number {
  const leftWeek = parseWeekId(left);
  const rightWeek = parseWeekId(right);

  if (leftWeek.year !== rightWeek.year) {
    return leftWeek.year - rightWeek.year;
  }

  return leftWeek.week - rightWeek.week;
}

export function isLegacyValidationWeek(weekId: string): boolean {
  return compareWeekIds(weekId, LEGACY_VALIDATION_CUTOFF_WEEK) <= 0;
}

export function getMondayOfISOWeek(weekId: string): Date {
  const { year, week } = parseWeekId(weekId);
  const jan4 = new Date(year, 0, 4);
  const jan4Day = jan4.getDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - jan4Day + 1);

  const targetMonday = new Date(week1Monday);
  targetMonday.setDate(week1Monday.getDate() + (week - 1) * 7);
  targetMonday.setHours(0, 0, 0, 0);

  return targetMonday;
}

export function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDateRomanian(date: Date): string {
  const day = date.getDate();
  const month = ROMANIAN_MONTHS_SHORT[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

export function getIssuePublicationInfo(
  rootDir: string,
  weekId: string
): IssuePublicationInfo {
  const draftMonday = getMondayOfISOWeek(weekId);
  const sendMonday = new Date(draftMonday);
  sendMonday.setDate(draftMonday.getDate() + 7);

  const date = formatIsoDate(sendMonday);
  const filename = `${date}-issue.md`;

  return {
    date,
    displayDate: formatDateRomanian(sendMonday),
    filename,
    outputPath: join(rootDir, 'content', 'issues', filename),
  };
}
