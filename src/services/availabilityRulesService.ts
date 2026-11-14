import { randomUUID } from 'crypto';
import { getAllClients } from '../repositories/mongoClientRepo';
import {
    deleteGeneratedSlot,
    getAvailabilityBetween,
    insertGeneratedSlot,
} from '../repositories/mongoAvailabilityRepo';
import {
    getAvailabilityRules,
    upsertAvailabilityRules,
} from '../repositories/mongoAvailabilityRulesRepo';
import {
    getBookingsByCoachBetween,
    hasActiveBookingForSlot,
} from '../repositories/mongoBookingRepo';
import {
    AvailabilityBlock,
    AvailabilityOverride,
    AvailabilityTimeRange,
    CoachAvailabilityRules,
    CoachAvailabilitySlot,
    WeekdayHours,
    WeekdayKey,
} from '../types';
import {
    GenerateInput,
    WEEKDAY_KEYS,
    addDays,
    countSlotsInRanges,
    eachDate,
    generateOpenSlots,
    isBuffer,
    isHm,
    isRealDate,
    isSlotLength,
    monthBounds,
    todayInSingapore,
    toMinutes,
} from './slotGeneration';
import { goodForNames, preferenceHeat, PreferenceHeat } from './clientPreferencesService';

/**
 * Coach working hours.
 *
 * The rules document is the source of truth. Open slots in
 * coach_availability with source 'rules' are a copy of those rules
 * so the existing booking path can still claim a slot by id.
 * Booked slots and bookings are not rewritten.
 */

const SYNC_PADDING_DAYS = 7;

function fail(statusCode: number, message: string): never {
    throw Object.assign(new Error(message), { statusCode });
}

export function emptyWeekdays(): WeekdayHours[] {
    return WEEKDAY_KEYS.map(day => ({ day, enabled: false, ranges: [] }));
}

function defaultRules(coachId: string): Omit<CoachAvailabilityRules, '_id'> {
    return {
        coach_id: coachId,
        timezone: 'Asia/Singapore',
        hours_saved: false,
        slot_length_minutes: 60,
        buffer_minutes: 10,
        weekdays: emptyWeekdays(),
        blocks: [],
        overrides: [],
        updated_at: new Date(),
    };
}

function slotKey(date: string, start: string, end: string): string {
    return `${date}|${start}|${end}`;
}

function idOf(value: unknown): string {
    if (value == null) return '';
    return String(value);
}

function cleanText(value: unknown, max: number): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.replace(/[\u0000-\u001F]/g, '').trim();
    if (!trimmed) return undefined;
    return trimmed.slice(0, max);
}

function assertDate(value: unknown, field: string): string {
    if (typeof value !== 'string' || !isRealDate(value)) {
        fail(400, `${field} must be a real date in YYYY-MM-DD.`);
    }
    return value;
}

function assertRange(range: unknown): AvailabilityTimeRange {
    if (!range || typeof range !== 'object') {
        fail(400, 'Each range needs a start and an end.');
    }
    const start = (range as { start?: unknown }).start;
    const end = (range as { end?: unknown }).end;
    if (typeof start !== 'string' || typeof end !== 'string' || !isHm(start) || !isHm(end)) {
        fail(400, 'Times must be HH:MM, from 00:00 to 23:59.');
    }
    if (end <= start) {
        fail(400, 'The end time has to be later on the same day.');
    }
    return { start, end };
}

function assertRanges(value: unknown): AvailabilityTimeRange[] {
    if (!Array.isArray(value)) fail(400, 'Hours need a list of ranges.');
    if (value.length > 8) fail(400, 'A day can have up to 8 ranges.');
    const ranges = value.map(assertRange);
    const sorted = [...ranges].sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].start < sorted[i - 1].end) {
            fail(400, 'Those hours overlap. Adjust the ranges so they do not cover the same time.');
        }
    }
    return ranges;
}

function assertWeekdays(value: unknown): WeekdayHours[] {
    if (!Array.isArray(value) || value.length !== 7) {
        fail(400, 'Save all seven days, including days that are off.');
    }
    const seen = new Set<string>();
    const weekdays: WeekdayHours[] = value.map(item => {
        if (!item || typeof item !== 'object') fail(400, 'Each day needs a name and its hours.');
        const day = (item as { day?: unknown }).day;
        if (typeof day !== 'string' || !WEEKDAY_KEYS.includes(day as WeekdayKey)) {
            fail(400, 'Day must be mon, tue, wed, thu, fri, sat, or sun.');
        }
        if (seen.has(day)) fail(400, 'Each weekday can only be sent once.');
        seen.add(day);
        const enabled = (item as { enabled?: unknown }).enabled === true;
        const ranges = assertRanges((item as { ranges?: unknown }).ranges ?? []);
        return { day: day as WeekdayKey, enabled, ranges };
    });
    for (const day of WEEKDAY_KEYS) {
        if (!seen.has(day)) fail(400, 'Save all seven days, including days that are off.');
    }
    return WEEKDAY_KEYS.map(day => weekdays.find(item => item.day === day)!);
}

export interface RulesResponse {
    timezone: 'Asia/Singapore';
    hours_saved: boolean;
    slot_length_minutes: 30 | 45 | 60 | 90;
    buffer_minutes: 0 | 10 | 15;
    weekdays: WeekdayHours[];
    blocks: AvailabilityBlock[];
    overrides: Array<AvailabilityOverride & { slot_count?: number }>;
}

function toResponse(rules: CoachAvailabilityRules | null): RulesResponse {
    const base = rules ?? {
        ...defaultRules(''),
        weekdays: emptyWeekdays(),
    };
    return {
        timezone: 'Asia/Singapore',
        hours_saved: base.hours_saved,
        slot_length_minutes: base.slot_length_minutes,
        buffer_minutes: base.buffer_minutes,
        weekdays: base.weekdays?.length === 7 ? base.weekdays : emptyWeekdays(),
        blocks: base.blocks ?? [],
        overrides: (base.overrides ?? []).map(item => (
            item.kind === 'extra'
                ? {
                    ...item,
                    slot_count: countSlotsInRanges(
                        item.ranges ?? [],
                        base.slot_length_minutes,
                        base.buffer_minutes,
                    ),
                }
                : item
        )),
    };
}

export async function readRules(coachId: string): Promise<RulesResponse> {
    return toResponse(await getAvailabilityRules(coachId));
}

async function writeRules(
    coachId: string,
    next: Omit<CoachAvailabilityRules, '_id' | 'coach_id'>,
): Promise<RulesResponse> {
    const saved = await upsertAvailabilityRules(coachId, {
        ...next,
        timezone: 'Asia/Singapore',
        updated_at: new Date(),
    });
    await syncOpenSlotsForWindow(coachId, saved);
    return toResponse(saved);
}

export async function saveWorkingHours(coachId: string, weekdaysInput: unknown): Promise<RulesResponse> {
    const weekdays = assertWeekdays(weekdaysInput);
    const current = await getAvailabilityRules(coachId);
    const base = current ?? defaultRules(coachId);
    return writeRules(coachId, {
        timezone: 'Asia/Singapore',
        hours_saved: true,
        slot_length_minutes: base.slot_length_minutes,
        buffer_minutes: base.buffer_minutes,
        weekdays,
        blocks: base.blocks ?? [],
        overrides: base.overrides ?? [],
        updated_at: new Date(),
    });
}

export async function saveSlotSettings(
    coachId: string,
    lengthInput: unknown,
    bufferInput: unknown,
): Promise<RulesResponse> {
    const length = Number(lengthInput);
    const buffer = Number(bufferInput);
    if (!isSlotLength(length)) fail(400, 'Session length must be 30, 45, 60, or 90 minutes.');
    if (!isBuffer(buffer)) fail(400, 'Buffer must be 0, 10, or 15 minutes.');
    const current = await getAvailabilityRules(coachId);
    const base = current ?? defaultRules(coachId);
    return writeRules(coachId, {
        timezone: 'Asia/Singapore',
        hours_saved: base.hours_saved,
        slot_length_minutes: length,
        buffer_minutes: buffer,
        weekdays: base.weekdays?.length === 7 ? base.weekdays : emptyWeekdays(),
        blocks: base.blocks ?? [],
        overrides: base.overrides ?? [],
        updated_at: new Date(),
    });
}

export async function addBlock(coachId: string, body: unknown): Promise<RulesResponse> {
    if (!body || typeof body !== 'object') fail(400, 'Say which time to block.');
    const date = assertDate((body as { date?: unknown }).date, 'date');
    const kind = (body as { kind?: unknown }).kind;
    if (kind !== 'range' && kind !== 'day_off') {
        fail(400, 'A block is either a time range or a whole day off.');
    }
    const current = await getAvailabilityRules(coachId);
    const base = current ?? defaultRules(coachId);
    const blocks = [...(base.blocks ?? [])];

    if (kind === 'day_off') {
        if (!blocks.some(item => item.date === date && item.kind === 'day_off')) {
            blocks.push({
                id: randomUUID(),
                date,
                kind: 'day_off',
                label: cleanText((body as { label?: unknown }).label, 80) ?? 'Whole day off',
            });
        }
    } else {
        const start = (body as { start?: unknown }).start;
        const end = (body as { end?: unknown }).end;
        const range = assertRange({ start, end });
        const label = cleanText((body as { label?: unknown }).label, 80) ?? 'Blocked';
        const duplicate = blocks.some(item =>
            item.date === date
            && item.kind === 'range'
            && item.start === range.start
            && item.end === range.end
            && item.label === label,
        );
        if (!duplicate) {
            blocks.push({ id: randomUUID(), date, kind: 'range', ...range, label });
        }
    }

    return writeRules(coachId, {
        timezone: 'Asia/Singapore',
        hours_saved: base.hours_saved,
        slot_length_minutes: base.slot_length_minutes,
        buffer_minutes: base.buffer_minutes,
        weekdays: base.weekdays?.length === 7 ? base.weekdays : emptyWeekdays(),
        blocks,
        overrides: base.overrides ?? [],
        updated_at: new Date(),
    });
}

export async function removeBlock(coachId: string, blockId: string): Promise<RulesResponse> {
    const current = await getAvailabilityRules(coachId);
    if (!current) fail(404, 'That block was not found.');
    const blocks = (current.blocks ?? []).filter(item => item.id !== blockId);
    if (blocks.length === (current.blocks ?? []).length) {
        fail(404, 'That block was not found.');
    }
    return writeRules(coachId, { ...current, blocks, updated_at: new Date() });
}

export async function addOverride(coachId: string, body: unknown): Promise<RulesResponse> {
    if (!body || typeof body !== 'object') fail(400, 'Say which date to change.');
    const date = assertDate((body as { date?: unknown }).date, 'date');
    const kind = (body as { kind?: unknown }).kind;
    if (kind !== 'extra' && kind !== 'closed') {
        fail(400, 'A one-off change is either extra slots or a closed day.');
    }
    const current = await getAvailabilityRules(coachId);
    const base = current ?? defaultRules(coachId);
    const overrides = (base.overrides ?? []).filter(item => item.date !== date);
    if (kind === 'extra') {
        const ranges = assertRanges((body as { ranges?: unknown }).ranges);
        if (ranges.length === 0) fail(400, 'Extra slots need a start and an end.');
        overrides.push({
            id: randomUUID(),
            date,
            kind: 'extra',
            ranges,
        });
    } else {
        overrides.push({
            id: randomUUID(),
            date,
            kind: 'closed',
            note: cleanText((body as { note?: unknown }).note, 80),
        });
    }
    return writeRules(coachId, {
        timezone: 'Asia/Singapore',
        hours_saved: base.hours_saved,
        slot_length_minutes: base.slot_length_minutes,
        buffer_minutes: base.buffer_minutes,
        weekdays: base.weekdays?.length === 7 ? base.weekdays : emptyWeekdays(),
        blocks: base.blocks ?? [],
        overrides,
        updated_at: new Date(),
    });
}

export async function removeOverride(coachId: string, overrideId: string): Promise<RulesResponse> {
    const current = await getAvailabilityRules(coachId);
    if (!current) fail(404, 'That one-off change was not found.');
    const overrides = (current.overrides ?? []).filter(item => item.id !== overrideId);
    if (overrides.length === (current.overrides ?? []).length) {
        fail(404, 'That one-off change was not found.');
    }
    return writeRules(coachId, { ...current, overrides, updated_at: new Date() });
}

function rulesGenerate(rules: CoachAvailabilityRules): Omit<GenerateInput, 'date' | 'occupied'> {
    return {
        weekdays: rules.weekdays ?? [],
        slotLength: rules.slot_length_minutes,
        buffer: rules.buffer_minutes,
        blocks: rules.blocks ?? [],
        overrides: rules.overrides ?? [],
    };
}

function shouldMaterialise(rules: CoachAvailabilityRules | null): rules is CoachAvailabilityRules {
    if (!rules) return false;
    if (rules.hours_saved) return true;
    return (rules.overrides ?? []).some(item => item.kind === 'extra');
}

/**
 * Writes open slots for the window and removes rules-slots that no longer fit.
 * Booked slots and slots the coach created by hand are left alone.
 */
export async function syncOpenSlots(
    coachId: string,
    rules: CoachAvailabilityRules,
    fromDate: string,
    toDate: string,
): Promise<void> {
    const bookings = await getBookingsByCoachBetween(coachId, fromDate, toDate);
    const existing = await getAvailabilityBetween(coachId, fromDate, toDate);
    const occupied = bookings
        .filter(item => item.status === 'booked' || item.status === 'completed' || item.status === 'cancelled')
        .map(item => ({
            date: item.date,
            start_time: item.start_time,
            end_time: item.end_time,
            status: item.status,
        }));
    const spec = rulesGenerate(rules);
    const byDate = new Map<string, CoachAvailabilitySlot[]>();
    for (const slot of existing) {
        const list = byDate.get(slot.date) ?? [];
        list.push(slot);
        byDate.set(slot.date, list);
    }

    for (const date of eachDate(fromDate, toDate)) {
        const desired = generateOpenSlots({ ...spec, date, occupied });
        const daySlots = byDate.get(date) ?? [];
        const used = new Set<string>();
        for (const want of desired) {
            const match = daySlots.find(slot => {
                const id = idOf(slot._id);
                if (used.has(id)) return false;
                if (slot.start_time !== want.start_time || slot.end_time !== want.end_time) return false;
                if (slot.is_booked || slot.status === 'booked' || slot.status === 'blocked') return false;
                return true;
            });
            if (match) {
                used.add(idOf(match._id));
            } else {
                const inserted = await insertGeneratedSlot(coachId, want);
                used.add(inserted);
            }
        }
        for (const slot of daySlots) {
            const id = idOf(slot._id);
            if (slot.source !== 'rules') continue;
            if (slot.is_booked || slot.status === 'booked' || slot.status === 'blocked') continue;
            if (used.has(id)) continue;
            if (await hasActiveBookingForSlot(id)) continue;
            await deleteGeneratedSlot(coachId, id);
        }
    }
}

async function syncOpenSlotsForWindow(coachId: string, rules: CoachAvailabilityRules): Promise<void> {
    if (!shouldMaterialise(rules)) return;
    const today = todayInSingapore();
    await syncOpenSlots(coachId, rules, today, addDays(today, 35));
}

export interface ScheduleBookedItem {
    kind: 'booked';
    booking_id: string;
    client_id: string;
    client_name: string;
    start_time: string;
    end_time: string;
    status: 'booked' | 'completed' | 'cancelled';
    duration_minutes: number;
}

export interface ScheduleOpenItem {
    kind: 'open';
    slot_id: string;
    start_time: string;
    end_time: string;
    duration_minutes: number;
    /** Client names whose best times match this open slot. Away dates are left out. */
    good_for?: string[];
}

export interface ScheduleBlockedItem {
    kind: 'blocked';
    block_id: string;
    start_time: string;
    end_time: string;
    label: string;
    legacy: boolean;
}

export interface ScheduleDayOffItem {
    kind: 'day_off';
    block_id: string;
    label: string;
}

export interface ScheduleClosedItem {
    kind: 'closed';
    override_id: string;
    note?: string;
}

export type ScheduleItem =
    | ScheduleOpenItem
    | ScheduleBookedItem
    | ScheduleBlockedItem
    | ScheduleDayOffItem
    | ScheduleClosedItem;

export interface DayCounts {
    open: number;
    booked: number;
    done: number;
    missed: number;
}

export interface CoachSchedule {
    timezone: 'Asia/Singapore';
    date: string;
    hours_saved: boolean;
    slot_length_minutes: 30 | 45 | 60 | 90;
    buffer_minutes: 0 | 10 | 15;
    counts: DayCounts;
    items: ScheduleItem[];
    month: Record<string, DayCounts>;
    heat: PreferenceHeat;
}

function durationMinutes(start: string, end: string): number {
    return Math.max(0, toMinutes(end) - toMinutes(start));
}

function emptyCounts(): DayCounts {
    return { open: 0, booked: 0, done: 0, missed: 0 };
}

export async function getCoachSchedule(coachId: string, dateInput?: string): Promise<CoachSchedule> {
    const date = dateInput && dateInput.length > 0 ? dateInput : todayInSingapore();
    if (!isRealDate(date)) fail(400, 'date must be a real date in YYYY-MM-DD.');

    const rules = await getAvailabilityRules(coachId);
    const { start, end } = monthBounds(date);
    const from = addDays(start, -SYNC_PADDING_DAYS);
    const to = addDays(end, SYNC_PADDING_DAYS);
    if (rules && shouldMaterialise(rules)) {
        await syncOpenSlots(coachId, rules, from, to);
    }

    const [bookings, slots, clients] = await Promise.all([
        getBookingsByCoachBetween(coachId, from, to),
        getAvailabilityBetween(coachId, from, to),
        getAllClients(coachId),
    ]);
    const names = new Map(clients.map(client => [client.id, client.name]));
    const occupied = bookings.map(item => ({
        date: item.date,
        start_time: item.start_time,
        end_time: item.end_time,
        status: item.status,
    }));

    const month: Record<string, DayCounts> = {};
    const countFor = (day: string): DayCounts => {
        const counts = emptyCounts();
        for (const booking of bookings) {
            if (booking.date !== day) continue;
            if (booking.status === 'booked') counts.booked += 1;
            else if (booking.status === 'completed') counts.done += 1;
            else if (booking.status === 'cancelled') counts.missed += 1;
        }
        if (rules && shouldMaterialise(rules)) {
            counts.open = generateOpenSlots({
                ...rulesGenerate(rules),
                date: day,
                occupied,
            }).length;
        } else {
            counts.open = slots.filter(slot =>
                slot.date === day
                && !slot.is_booked
                && slot.status !== 'blocked'
                && slot.status !== 'booked',
            ).length;
        }
        return counts;
    };

    for (const day of eachDate(from, to)) {
        const counts = countFor(day);
        if (day === date || counts.open || counts.booked || counts.done || counts.missed) {
            month[day] = counts;
        }
    }

    const items: ScheduleItem[] = [];
    for (const booking of bookings) {
        if (booking.date !== date) continue;
        if (booking.status !== 'booked' && booking.status !== 'completed' && booking.status !== 'cancelled') {
            continue;
        }
        items.push({
            kind: 'booked',
            booking_id: idOf(booking._id),
            client_id: booking.client_id,
            client_name: names.get(booking.client_id)?.trim() || 'Client',
            start_time: booking.start_time,
            end_time: booking.end_time,
            status: booking.status,
            duration_minutes: durationMinutes(booking.start_time, booking.end_time),
        });
    }

    if (rules && shouldMaterialise(rules)) {
        const open = generateOpenSlots({ ...rulesGenerate(rules), date, occupied });
        const daySlots = slots.filter(slot => slot.date === date);
        for (const want of open) {
            const match = daySlots.find(slot =>
                slot.start_time === want.start_time
                && slot.end_time === want.end_time
                && !slot.is_booked
                && slot.status !== 'booked'
                && slot.status !== 'blocked',
            );
            items.push({
                kind: 'open',
                slot_id: match ? idOf(match._id) : '',
                start_time: want.start_time,
                end_time: want.end_time,
                duration_minutes: durationMinutes(want.start_time, want.end_time),
            });
        }
        for (const block of rules.blocks ?? []) {
            if (block.date !== date) continue;
            if (block.kind === 'day_off') {
                items.push({
                    kind: 'day_off',
                    block_id: block.id,
                    label: block.label?.trim() || 'Whole day off',
                });
            } else if (block.start && block.end) {
                items.push({
                    kind: 'blocked',
                    block_id: block.id,
                    start_time: block.start,
                    end_time: block.end,
                    label: block.label?.trim() || 'Blocked',
                    legacy: false,
                });
            }
        }
        for (const change of rules.overrides ?? []) {
            if (change.date !== date || change.kind !== 'closed') continue;
            items.push({
                kind: 'closed',
                override_id: change.id,
                note: change.note,
            });
        }
    } else {
        for (const slot of slots) {
            if (slot.date !== date) continue;
            if (slot.status === 'blocked') {
                items.push({
                    kind: 'blocked',
                    block_id: `legacy:${idOf(slot._id)}`,
                    start_time: slot.start_time,
                    end_time: slot.end_time,
                    label: slot.blocked_reason?.trim() || 'Blocked',
                    legacy: true,
                });
            } else if (!slot.is_booked && slot.status !== 'booked') {
                items.push({
                    kind: 'open',
                    slot_id: idOf(slot._id),
                    start_time: slot.start_time,
                    end_time: slot.end_time,
                    duration_minutes: durationMinutes(slot.start_time, slot.end_time),
                });
            }
        }
    }

    items.sort((a, b) => {
        const aTime = 'start_time' in a ? a.start_time : '0000';
        const bTime = 'start_time' in b ? b.start_time : '0000';
        return aTime.localeCompare(bTime);
    });

    const shown = rules ?? defaultRules(coachId);
    const heat = await preferenceHeat(coachId);
    const labeled: ScheduleItem[] = [];
    for (const item of items) {
        if (item.kind !== 'open') {
            labeled.push(item);
            continue;
        }
        labeled.push({
            ...item,
            good_for: await goodForNames(coachId, date, item.start_time),
        });
    }
    return {
        timezone: 'Asia/Singapore',
        date,
        hours_saved: shown.hours_saved,
        slot_length_minutes: shown.slot_length_minutes,
        buffer_minutes: shown.buffer_minutes,
        counts: month[date] ?? countFor(date),
        items: labeled,
        month,
        heat,
    };
}

/**
 * Slots a client may see. When the coach has saved hours or a one-off
 * extra day, only the generated open slots are offered. Older hand-made
 * slots stay in the database and are not listed.
 * When nothing has been saved, the previous list is returned unchanged.
 */
export async function clientVisibleSlots(coachId: string): Promise<CoachAvailabilitySlot[]> {
    const rules = await getAvailabilityRules(coachId);
    const today = todayInSingapore();
    if (!shouldMaterialise(rules)) {
        return getAvailabilityBetween(coachId, today, '9999-12-31');
    }
    const to = addDays(today, 35);
    await syncOpenSlots(coachId, rules, today, to);
    const slots = await getAvailabilityBetween(coachId, today, to);
    const bookings = await getBookingsByCoachBetween(coachId, today, to);
    const occupied = bookings.map(item => ({
        date: item.date,
        start_time: item.start_time,
        end_time: item.end_time,
        status: item.status,
    }));
    const allowed = new Set<string>();
    for (const date of eachDate(today, to)) {
        for (const slot of generateOpenSlots({ ...rulesGenerate(rules), date, occupied })) {
            allowed.add(slotKey(date, slot.start_time, slot.end_time));
        }
    }
    return slots.filter(slot =>
        allowed.has(slotKey(slot.date, slot.start_time, slot.end_time))
        && !slot.is_booked
        && slot.status !== 'blocked'
        && slot.status !== 'booked',
    );
}
