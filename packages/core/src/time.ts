/**
 * Timezone-aware time helpers built on Intl. No naive offset arithmetic:
 * every conversion goes through the IANA database via Intl.DateTimeFormat.
 */

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function utcToLocalParts(date: Date, timeZone: string): LocalParts {
  const parts = formatter(timeZone).formatToParts(date);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute'), second: get('second') };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Formats a UTC instant as a local ISO string without offset: YYYY-MM-DDTHH:MM. */
export function utcToLocalIso(utcIso: string | Date, timeZone: string): string {
  const d = typeof utcIso === 'string' ? new Date(utcIso) : utcIso;
  const p = utcToLocalParts(d, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Offset (minutes east of UTC) in effect in `timeZone` at the given instant. */
export function offsetMinutesAt(date: Date, timeZone: string): number {
  const p = utcToLocalParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/**
 * Converts a wall-clock local time (YYYY-MM-DDTHH:MM[:SS]) in `timeZone` to a UTC instant.
 * Handles DST correctly by iterating on the offset (two passes are enough for any real zone).
 */
export function localToUtc(localIso: string, timeZone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(localIso);
  if (!m) throw new Error(`Invalid local ISO time: ${localIso}`);
  const naive = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, m[6] ? +m[6] : 0);
  let guess = naive - offsetMinutesAt(new Date(naive), timeZone) * 60000;
  const off2 = offsetMinutesAt(new Date(guess), timeZone);
  guess = naive - off2 * 60000;
  return new Date(guess);
}

export function localToUtcIso(localIso: string, timeZone: string): string {
  return localToUtc(localIso, timeZone).toISOString();
}

export function minutesBetween(fromUtcIso: string, toUtcIso: string): number {
  return Math.round((new Date(toUtcIso).getTime() - new Date(fromUtcIso).getTime()) / 60000);
}

export function addMinutesUtc(utcIso: string, minutes: number): string {
  return new Date(new Date(utcIso).getTime() + minutes * 60000).toISOString();
}

/** "HH:MM" -> minutes since midnight. */
export function hhmmToMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) throw new Error(`Invalid HH:MM: ${hhmm}`);
  return +m[1]! * 60 + +m[2]!;
}

export function minutesToHhmm(mins: number): string {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** Minutes since local midnight for a local ISO string. */
export function localMinutesOfDay(localIso: string): number {
  const m = /T(\d{2}):(\d{2})/.exec(localIso);
  if (!m) throw new Error(`Invalid local ISO time: ${localIso}`);
  return +m[1]! * 60 + +m[2]!;
}

export function localDate(localIso: string): string {
  return localIso.slice(0, 10);
}

export function localTime(localIso: string): string {
  return localIso.slice(11, 16);
}

/** Adds whole days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((Date.UTC(+toDate.slice(0, 4), +toDate.slice(5, 7) - 1, +toDate.slice(8, 10)) - Date.UTC(+fromDate.slice(0, 4), +fromDate.slice(5, 7) - 1, +fromDate.slice(8, 10))) / 86400000);
}

export function* eachDate(from: string, to: string): Generator<string> {
  let d = from;
  while (d <= to) {
    yield d;
    d = addDays(d, 1);
  }
}

/** Human readable duration: 17h10. */
export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? '-' : '';
  const m = Math.abs(Math.round(minutes));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h === 0) return `${sign}${mm}m`;
  return `${sign}${h}h${pad(mm)}`;
}

/**
 * True when the local interval [arrivalLocal, departureLocal] contains the
 * given local hour (default 03:00), i.e. the traveller is at the airport in
 * the middle of the night. Requires the interval to be at least `minMinutes`.
 */
export function intervalCoversNightHour(arrivalLocal: string, departureLocal: string, minutes: number, minMinutes = 300, nightHour = 3): boolean {
  if (minutes < minMinutes) return false;
  const start = new Date(`${arrivalLocal}:00Z`).getTime();
  const end = start + minutes * 60000;
  // walk each candidate night hour instant within the interval (treat local as pseudo-UTC)
  const first = new Date(start);
  first.setUTCHours(nightHour, 0, 0, 0);
  for (let t = first.getTime() - 86400000; t <= end + 86400000; t += 86400000) {
    if (t >= start && t <= end) return true;
  }
  void departureLocal;
  return false;
}
