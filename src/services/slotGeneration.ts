/**
 * Turns a coach's working hours into open session slots.
 *
 * Every date and clock time is an Asia/Singapore wall-clock value.
 * The functions do not read the server's local timezone.
 *
 * A session of `slotLength` minutes is followed by `buffer` minutes
 * before the next session can start. The session itself must finish
 * inside the working range. The buffer may run past the end of the range.
 * A 60 minute session with a 10 minute buffer that starts at 10:00
 * ends at 11:00 and frees the coach at 11:10.
 *
 * Cancelled bookings are ignored, so that time can be offered again.
 */

export const AVAILABILITY_TIMEZONE = 'Asia/Singapore' as const;

export const SLOT_LENGTHS = [30, 45, 60, 90] as const;
export const BUFFER_CHOICES = [0, 10, 15] as const;

export type SlotLengthMinutes = (typeof SLOT_LENGTHS)[number];
export type BufferMinutes = (typeof BUFFER_CHOICES)[number];
export type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export const WEEKDAY_KEYS: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const WEEKDAY_FROM_SHORT: Record<string, WeekdayKey> = {
    Mon: 'mon',
    Tue: 'tue',
    Wed: 'wed',
    Thu: 'thu',
    Fri: 'fri',
    Sat: 'sat',
    Sun: 'sun',
};

export interface MinuteRange {
    start: string;
    end: string;
}

export interface WeekdayHoursInput {
    day: WeekdayKey;
    enabled: boolean;
    ranges: MinuteRange[];
}

export interface BlockInput {
    id: string;
    date: string;
    kind: 'range' | 'day_off';
    start?: string;
    end?: string;
    label?: string;
}

export interface OverrideInput {
    id: string;
    date: string;
    kind: 'extra' | 'closed';
    ranges?: MinuteRange[];
    note?: string;
}

export interface OccupiedInterval {
    date: string;
    start_time: string;
    end_time: string;
    status: 'booked' | 'completed' | 'cancelled';
}

export interface GeneratedSlot {
    date: string;
    start_time: string;
    end_time: string;
}

export function toMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
}

export function fromMinutes(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Weekday of a YYYY-MM-DD date, read at noon in Asia/Singapore. */
export function weekdayOf(isoDate: string): WeekdayKey {
    const label = new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        timeZone: AVAILABILITY_TIMEZONE,
    }).format(new Date(`${isoDate}T12:00:00+08:00`));
    const key = WEEKDAY_FROM_SHORT[label];
    if (!key) {
        throw new Error(`Could not read the weekday for ${isoDate} in Asia/Singapore.`);
    }
    return key;
}

export function todayInSingapore(now: Date = new Date()): string {
    return now.toLocaleDateString('en-CA', { timeZone: AVAILABILITY_TIMEZONE });
}

/** Adds calendar days to a YYYY-MM-DD string. Does not use the server timezone. */
export function addDays(iso: string, days: number): string {
    const [year, month, day] = iso.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

export function eachDate(from: string, to: string): string[] {
    const dates: string[] = [];
    let cursor = from;
    while (cursor <= to) {
        dates.push(cursor);
        cursor = addDays(cursor, 1);
        if (dates.length > 400) break;
    }
    return dates;
}

export function monthBounds(iso: string): { start: string; end: string } {
    const [year, month] = iso.split('-').map(Number);
    const start = `${iso.slice(0, 7)}-01`;
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const end = `${iso.slice(0, 7)}-${String(last).padStart(2, '0')}`;
    return { start, end };
}

export function isRealDate(iso: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
    const [year, month, day] = iso.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day;
}

export function isSlotLength(value: number): value is SlotLengthMinutes {
    return (SLOT_LENGTHS as readonly number[]).includes(value);
}

export function isBuffer(value: number): value is BufferMinutes {
    return (BUFFER_CHOICES as readonly number[]).includes(value);
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isHm(value: string): boolean {
    return TIME_RE.test(value);
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
    return aStart < bEnd && aEnd > bStart;
}

function parsedRanges(ranges: MinuteRange[]): Array<{ start: number; end: number }> {
    return ranges
        .map(range => ({ start: toMinutes(range.start), end: toMinutes(range.end) }))
        .filter(range => range.end > range.start && range.start >= 0 && range.end <= 24 * 60)
        .sort((a, b) => a.start - b.start);
}

function mergeRanges(ranges: MinuteRange[]): Array<{ start: number; end: number }> {
    const merged: Array<{ start: number; end: number }> = [];
    for (const range of parsedRanges(ranges)) {
        const last = merged[merged.length - 1];
        if (last && range.start <= last.end) {
            last.end = Math.max(last.end, range.end);
        } else {
            merged.push({ start: range.start, end: range.end });
        }
    }
    return merged;
}

/**
 * How many sessions fit in these ranges with the given length and buffer.
 * Used for the "4 slots" line on a one-off extra window.
 */
export function countSlotsInRanges(
    ranges: MinuteRange[],
    slotLength: number,
    buffer: number,
): number {
    if (slotLength <= 0 || buffer < 0) return 0;
    let count = 0;
    for (const window of mergeRanges(ranges)) {
        let cursor = window.start;
        let guard = 0;
        while (cursor + slotLength <= window.end && cursor < 24 * 60) {
            count += 1;
            cursor += slotLength + buffer;
            guard += 1;
            if (guard > 96) break;
        }
    }
    return count;
}

export interface GenerateInput {
    date: string;
    weekdays: WeekdayHoursInput[];
    slotLength: number;
    buffer: number;
    blocks: BlockInput[];
    overrides: OverrideInput[];
    occupied: OccupiedInterval[];
}

/**
 * Open slots for one Asia/Singapore date.
 *
 * Closed for the day, or a whole-day block, yields no slots.
 * An extra-slots override adds its ranges on top of the weekly hours.
 * A range block, and any booked or completed session plus its buffer,
 * removes slots that overlap. A cancelled session does not.
 */
export function generateOpenSlots(input: GenerateInput): GeneratedSlot[] {
    const { date, slotLength, buffer } = input;
    if (slotLength <= 0 || buffer < 0) return [];

    const dayOverrides = input.overrides.filter(item => item.date === date);
    if (dayOverrides.some(item => item.kind === 'closed')) return [];

    const dayBlocks = input.blocks.filter(item => item.date === date);
    if (dayBlocks.some(item => item.kind === 'day_off')) return [];

    const weekday = weekdayOf(date);
    const rule = input.weekdays.find(item => item.day === weekday);
    const base = rule?.enabled ? rule.ranges : [];
    const extra = dayOverrides
        .filter(item => item.kind === 'extra')
        .flatMap(item => item.ranges ?? []);
    const windows = mergeRanges([...base, ...extra]);
    if (windows.length === 0) return [];

    const blockRanges = dayBlocks
        .filter(item => item.kind === 'range' && item.start && item.end)
        .map(item => ({ start: toMinutes(item.start!), end: toMinutes(item.end!) }))
        .filter(item => item.end > item.start);

    const busy = input.occupied
        .filter(item => item.date === date && item.status !== 'cancelled')
        .map(item => ({
            start: toMinutes(item.start_time),
            end: toMinutes(item.end_time) + buffer,
        }))
        .filter(item => item.end > item.start);

    const slots: GeneratedSlot[] = [];
    for (const window of windows) {
        let cursor = window.start;
        let guard = 0;
        while (cursor + slotLength <= window.end && cursor < 24 * 60) {
            const end = cursor + slotLength;
            const hitsBlock = blockRanges.some(block => overlaps(cursor, end, block.start, block.end));
            const hitsBusy = busy.some(block => overlaps(cursor, end, block.start, block.end));
            if (!hitsBlock && !hitsBusy) {
                slots.push({
                    date,
                    start_time: fromMinutes(cursor),
                    end_time: fromMinutes(end),
                });
            }
            cursor += slotLength + buffer;
            guard += 1;
            if (guard > 96) break;
        }
    }
    return slots;
}
