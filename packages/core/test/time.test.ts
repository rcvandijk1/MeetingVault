import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, formatDuration, hhmmToMinutes, intervalCoversNightHour, localToUtcIso, minutesBetween, utcToLocalIso } from '../src/time.js';

describe('time utilities', () => {
  it('converts local Amsterdam time to UTC across DST', () => {
    expect(localToUtcIso('2027-01-20T20:30', 'Europe/Amsterdam')).toBe('2027-01-20T19:30:00.000Z');
    expect(localToUtcIso('2027-07-20T20:30', 'Europe/Amsterdam')).toBe('2027-07-20T18:30:00.000Z');
  });

  it('converts UTC to Bangkok local time', () => {
    expect(utcToLocalIso('2027-01-21T10:20:00Z', 'Asia/Bangkok')).toBe('2027-01-21T17:20');
  });

  it('computes connection minutes from real UTC timestamps, not local clock differences', () => {
    // 04:45 Doha (UTC+3) → 06:50 Doha = 125 minutes
    const arr = localToUtcIso('2027-01-21T04:45', 'Asia/Qatar');
    const dep = localToUtcIso('2027-01-21T06:50', 'Asia/Qatar');
    expect(minutesBetween(arr, dep)).toBe(125);
  });

  it('handles dates and durations', () => {
    expect(addDays('2027-01-31', 1)).toBe('2027-02-01');
    expect(daysBetween('2027-01-20', '2027-02-08')).toBe(19);
    expect(formatDuration(1030)).toBe('17h10');
    expect(formatDuration(45)).toBe('45m');
    expect(hhmmToMinutes('06:30')).toBe(390);
  });

  it('detects overnight airport intervals', () => {
    expect(intervalCoversNightHour('2027-01-21T23:50', '2027-01-22T06:50', 420)).toBe(true);
    expect(intervalCoversNightHour('2027-01-21T02:20', '2027-01-21T06:50', 270)).toBe(false); // too short
    expect(intervalCoversNightHour('2027-01-21T10:00', '2027-01-21T16:00', 360)).toBe(false); // daytime
  });
});
