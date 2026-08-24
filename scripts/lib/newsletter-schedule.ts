import { parseWeekId } from './newsletter-week.js';

export const NEWSLETTER_TIME_ZONE = 'Europe/Bucharest';
export const NEWSLETTER_DELIVERY_HOUR = 9;
export const MINIMUM_SCHEDULE_LEAD_MS = 15 * 60 * 1000;

interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function getTimeZoneParts(date: Date, timeZone: string): LocalDateTime {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = new Map(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number.parseInt(part.value, 10)])
  );

  const readPart = (name: keyof LocalDateTime): number => {
    const value = parts.get(name);
    if (value === undefined || Number.isNaN(value)) {
      throw new Error(`Could not resolve ${name} in ${timeZone}`);
    }
    return value;
  };

  return {
    year: readPart('year'),
    month: readPart('month'),
    day: readPart('day'),
    hour: readPart('hour'),
    minute: readPart('minute'),
    second: readPart('second'),
  };
}

function localDateTimeToUtc(
  localDateTime: LocalDateTime,
  timeZone: string
): Date {
  const localAsUtc = Date.UTC(
    localDateTime.year,
    localDateTime.month - 1,
    localDateTime.day,
    localDateTime.hour,
    localDateTime.minute,
    localDateTime.second
  );
  let candidate = localAsUtc;

  // Two passes handle dates on either side of an offset transition.
  for (let attempt = 0; attempt < 2; attempt++) {
    const zoned = getTimeZoneParts(new Date(candidate), timeZone);
    const zonedAsUtc = Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
      zoned.second
    );
    candidate = localAsUtc - (zonedAsUtc - candidate);
  }

  const result = new Date(candidate);
  const resolved = getTimeZoneParts(result, timeZone);
  if (
    resolved.year !== localDateTime.year ||
    resolved.month !== localDateTime.month ||
    resolved.day !== localDateTime.day ||
    resolved.hour !== localDateTime.hour ||
    resolved.minute !== localDateTime.minute ||
    resolved.second !== localDateTime.second
  ) {
    throw new Error(
      `Local delivery time does not exist in ${timeZone}: ${JSON.stringify(localDateTime)}`
    );
  }

  return result;
}

function getFollowingMondayDate(weekId: string): {
  year: number;
  month: number;
  day: number;
} {
  const { year, week } = parseWeekId(weekId);
  if (week < 1 || week > 53) {
    throw new Error(`Invalid ISO week: ${weekId}`);
  }
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const januaryFourthDay = januaryFourth.getUTCDay() || 7;
  const weekOneMonday = Date.UTC(year, 0, 4 - januaryFourthDay + 1);
  const draftWeekThursday = new Date(
    weekOneMonday + ((week - 1) * 7 + 3) * 24 * 60 * 60 * 1000
  );
  if (draftWeekThursday.getUTCFullYear() !== year) {
    throw new Error(`Invalid ISO week: ${weekId}`);
  }
  const followingMonday = new Date(
    weekOneMonday + week * 7 * 24 * 60 * 60 * 1000
  );

  return {
    year: followingMonday.getUTCFullYear(),
    month: followingMonday.getUTCMonth() + 1,
    day: followingMonday.getUTCDate(),
  };
}

function getIsoWeekId(date: Date): string {
  const thursday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const day = thursday.getUTCDay() || 7;
  thursday.setUTCDate(thursday.getUTCDate() + 4 - day);

  const isoYear = thursday.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const isoWeek = Math.ceil(
    ((thursday.getTime() - yearStart) / DAY_MS + 1) / 7
  );

  return `${isoYear}-W${String(isoWeek).padStart(2, '0')}`;
}

function getBucharestCalendarDate(now: Date): Date {
  const local = getTimeZoneParts(now, NEWSLETTER_TIME_ZONE);
  return new Date(Date.UTC(local.year, local.month - 1, local.day));
}

/**
 * Resolve the only draft that an automated preparation run may schedule.
 * Sunday uses its own ISO week; a delayed run early Monday uses the preceding
 * Sunday. Other days fail closed instead of guessing from files on disk.
 */
export function getExpectedPreparationWeek(now: Date = new Date()): string {
  const localDate = getBucharestCalendarDate(now);
  const weekday = localDate.getUTCDay();

  if (weekday === 0) {
    return getIsoWeekId(localDate);
  }

  if (weekday === 1) {
    return getIsoWeekId(new Date(localDate.getTime() - DAY_MS));
  }

  throw new Error(
    `Automated newsletter preparation may run only on Sunday or Monday in ${NEWSLETTER_TIME_ZONE}.`
  );
}

/** Resolve the draft whose scheduled delivery is due on the local Monday. */
export function getExpectedDeliveryWeek(now: Date = new Date()): string {
  const localDate = getBucharestCalendarDate(now);
  if (localDate.getUTCDay() !== 1) {
    throw new Error(
      `Automated newsletter verification may run only on Monday in ${NEWSLETTER_TIME_ZONE}.`
    );
  }

  return getIsoWeekId(new Date(localDate.getTime() - DAY_MS));
}

export function getNewsletterDeliveryAt(weekId: string): Date {
  const deliveryDate = getFollowingMondayDate(weekId);
  return localDateTimeToUtc(
    {
      ...deliveryDate,
      hour: NEWSLETTER_DELIVERY_HOUR,
      minute: 0,
      second: 0,
    },
    NEWSLETTER_TIME_ZONE
  );
}

export function getSchedulableNewsletterDeliveryAt(
  weekId: string,
  now: Date = new Date()
): string {
  const deliveryAt = getNewsletterDeliveryAt(weekId);
  if (deliveryAt.getTime() - now.getTime() < MINIMUM_SCHEDULE_LEAD_MS) {
    throw new Error(
      `Cannot schedule ${weekId} for ${deliveryAt.toISOString()}: the delivery time is less than 15 minutes away or has already passed.`
    );
  }

  return deliveryAt.toISOString();
}

export function canMutateNewsletterDelivery(
  weekId: string,
  now: Date = new Date()
): boolean {
  return (
    getNewsletterDeliveryAt(weekId).getTime() - now.getTime() >=
    MINIMUM_SCHEDULE_LEAD_MS
  );
}

export function resolveAutomatedNewsletterPreparation(
  now: Date = new Date()
): { weekId: string; scheduledAt: string } {
  const weekId = getExpectedPreparationWeek(now);
  return {
    weekId,
    scheduledAt: getNewsletterDeliveryAt(weekId).toISOString(),
  };
}
