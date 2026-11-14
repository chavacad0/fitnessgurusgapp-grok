import { randomUUID } from 'crypto';
import { findClientById } from '../repositories/mongoClientAuthRepo';
import { getAllClients, validateClientOwnership } from '../repositories/mongoClientRepo';
import { getCoachById } from '../repositories/mongoCoachRepo';
import { getAvailabilityRules } from '../repositories/mongoAvailabilityRulesRepo';
import { findOpenSlot } from '../repositories/mongoAvailabilityRepo';
import { bookSession, quickBookSession } from './bookingService';
import {
    AwayRange,
    BestWindow,
    ClientBestTimes,
    ExactTime,
    TimeRequest,
    findOpenRequest,
    getBestTimes,
    getBestTimesForClients,
    getTimeRequest,
    insertTimeRequest,
    listOpenTimeRequestsForCoach,
    listTimeRequestsForClient,
    saveBestTimes,
    updateTimeRequest,
} from '../repositories/mongoClientTimesRepo';
import {
    WEEKDAY_KEYS,
    WeekdayKey,
    addDays,
    fromMinutes,
    isHm,
    isRealDate,
    todayInSingapore,
    toMinutes,
    weekdayOf,
} from './slotGeneration';

/**
 * My best times, away dates, and time requests.
 *
 * A request is not a booking. Accept is the only step that calls
 * bookSession or quickBookSession, so the sessions-left check still runs.
 * Preferences are readable by the client and by that client's own coach.
 */

const WINDOWS: BestWindow[] = ['weekday_mornings', 'lunch', 'after_work', 'weekends'];

const WINDOW_COPY: Record<BestWindow, {
    label: string;
    busyTitle: string;
    quietTitle: string;
    marked: string;
    quietUse: string;
}> = {
    weekday_mornings: {
        label: 'Weekday mornings',
        busyTitle: 'Weekday mornings 6–8 AM is the busiest window',
        quietTitle: 'Weekday mornings are quieter',
        marked: '6–8 AM',
        quietUse: 'an early session',
    },
    lunch: {
        label: 'Lunch',
        busyTitle: 'Lunch 12–2 PM is the busiest window',
        quietTitle: 'Lunch is quieter',
        marked: '12–2 PM',
        quietUse: 'a midday session',
    },
    after_work: {
        label: 'After work',
        busyTitle: 'After work 6–9 PM is the busiest window',
        quietTitle: 'After work is quieter',
        marked: '6–9 PM',
        quietUse: 'an evening session',
    },
    weekends: {
        label: 'Weekends',
        busyTitle: 'Weekends are the busiest window',
        quietTitle: 'Weekends are quieter',
        marked: 'Sat or Sun',
        quietUse: 'a Saturday or Sunday',
    },
};

const WEEKDAY_NAME: Record<WeekdayKey, string> = {
    mon: 'Mondays',
    tue: 'Tuesdays',
    wed: 'Wednesdays',
    thu: 'Thursdays',
    fri: 'Fridays',
    sat: 'Saturdays',
    sun: 'Sundays',
};

const WEEKDAY_SHORT: Record<WeekdayKey, string> = {
    mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
};

function fail(statusCode: number, message: string): never {
    throw Object.assign(new Error(message), { statusCode });
}

function idOf(value: unknown): string {
    if (value == null) return '';
    return String(value);
}

export function coachPhrase(name: string | null | undefined): string {
    const trimmed = (name ?? '').trim();
    if (!trimmed) return 'your coach';
    if (/^coach\b/i.test(trimmed)) return trimmed;
    return `Coach ${trimmed}`;
}

export function coachFirstName(name: string | null | undefined): string {
    const trimmed = (name ?? '').trim().replace(/^coach\s+/i, '');
    const first = trimmed.split(/\s+/)[0];
    return first || 'Your coach';
}

function formatClock(hhmm: string): string {
    const [hRaw, mRaw] = hhmm.split(':').map(Number);
    const period = hRaw >= 12 ? 'PM' : 'AM';
    const h12 = hRaw % 12 || 12;
    return `${h12}:${String(mRaw).padStart(2, '0')} ${period}`;
}

function formatDay(iso: string): string {
    const date = new Date(`${iso}T12:00:00+08:00`);
    const weekday = date.toLocaleDateString('en-SG', { weekday: 'short', timeZone: 'Asia/Singapore' });
    const day = date.toLocaleDateString('en-SG', { day: 'numeric', timeZone: 'Asia/Singapore' });
    const month = date.toLocaleDateString('en-SG', { month: 'short', timeZone: 'Asia/Singapore' });
    return `${weekday} ${day} ${month}`;
}

function windowMatches(window: BestWindow, day: WeekdayKey, minutes: number): boolean {
    const weekday = ['mon', 'tue', 'wed', 'thu', 'fri'].includes(day);
    const weekend = day === 'sat' || day === 'sun';
    if (window === 'weekday_mornings') return weekday && minutes >= 6 * 60 && minutes < 8 * 60;
    if (window === 'lunch') return minutes >= 12 * 60 && minutes < 14 * 60;
    if (window === 'after_work') return weekday && minutes >= 18 * 60 && minutes < 21 * 60;
    return weekend;
}

function hoursForWindow(window: BestWindow): number[] {
    if (window === 'weekday_mornings') return [6, 7];
    if (window === 'lunch') return [12, 13];
    if (window === 'after_work') return [18, 19, 20];
    return [];
}

export function isAway(away: AwayRange[], date: string): boolean {
    return away.some(range => date >= range.start && date <= range.end);
}

function matchingWindow(windows: BestWindow[], day: WeekdayKey, minutes: number): BestWindow | null {
    for (const window of WINDOWS) {
        if (windows.includes(window) && windowMatches(window, day, minutes)) return window;
    }
    return null;
}

async function linkedClient(clientId: string) {
    const client = await findClientById(clientId);
    if (!client) fail(404, 'Client account not found. Please sign out and sign in again.');
    if (!client.coach_id) fail(400, 'Connect to your coach before saving times.');
    return client;
}

async function coachName(coachId: string): Promise<string | null> {
    const coach = await getCoachById(coachId);
    const name = coach?.name?.trim();
    return name || null;
}

function emptyBest(clientId: string): ClientBestTimes {
    return {
        client_id: clientId,
        windows: [],
        exact_times: [],
        away: [],
        updated_at: new Date(),
    };
}

export interface BestTimesView {
    coach_name: string;
    coach_first_name: string;
    slot_length_minutes: number;
    windows: BestWindow[];
    exact_times: ExactTime[];
    away: Array<AwayRange & { days: number; badge: 'Upcoming' | 'Later' }>;
}

function awayBadge(start: string): 'Upcoming' | 'Later' {
    const today = todayInSingapore();
    const soon = addDays(today, 60);
    return start <= soon ? 'Upcoming' : 'Later';
}

function dayCount(start: string, end: string): number {
    const [ys, ms, ds] = start.split('-').map(Number);
    const [ye, me, de] = end.split('-').map(Number);
    const a = Date.UTC(ys, ms - 1, ds);
    const b = Date.UTC(ye, me - 1, de);
    return Math.round((b - a) / 86400000) + 1;
}

async function viewFor(clientId: string, coachId: string, doc: ClientBestTimes | null): Promise<BestTimesView> {
    const [name, rules] = await Promise.all([
        coachName(coachId),
        getAvailabilityRules(coachId),
    ]);
    const stored = doc ?? emptyBest(clientId);
    return {
        coach_name: coachPhrase(name),
        coach_first_name: coachFirstName(name),
        slot_length_minutes: rules?.slot_length_minutes ?? 60,
        windows: stored.windows ?? [],
        exact_times: stored.exact_times ?? [],
        away: (stored.away ?? []).map(range => ({
            ...range,
            days: dayCount(range.start, range.end),
            badge: awayBadge(range.start),
        })),
    };
}

function assertWindows(value: unknown): BestWindow[] {
    if (!Array.isArray(value)) fail(400, 'Choose the windows that suit you.');
    const unique = [...new Set(value)];
    for (const item of unique) {
        if (!WINDOWS.includes(item as BestWindow)) fail(400, 'That window is not one of the four choices.');
    }
    return unique as BestWindow[];
}

function assertExact(value: unknown): ExactTime[] {
    if (!Array.isArray(value)) fail(400, 'Exact times need to be a list.');
    if (value.length > 20) fail(400, 'You can save up to 20 exact times.');
    return value.map(item => {
        if (!item || typeof item !== 'object') fail(400, 'Each exact time needs a day and a time.');
        const day = (item as { day?: unknown }).day;
        const time = (item as { time?: unknown }).time;
        if (typeof day !== 'string' || !WEEKDAY_KEYS.includes(day as WeekdayKey)) {
            fail(400, 'Day must be mon, tue, wed, thu, fri, sat, or sun.');
        }
        if (typeof time !== 'string' || !isHm(time)) fail(400, 'Time must be HH:MM.');
        const note = typeof (item as { note?: unknown }).note === 'string'
            ? (item as { note: string }).note.replace(/[\u0000-\u001F]/g, '').trim().slice(0, 80)
            : undefined;
        const id = typeof (item as { id?: unknown }).id === 'string' && (item as { id: string }).id
            ? (item as { id: string }).id
            : randomUUID();
        return { id, day: day as WeekdayKey, time, ...(note ? { note } : {}) };
    });
}

function assertAwayRange(start: unknown, end: unknown): { start: string; end: string } {
    if (typeof start !== 'string' || !isRealDate(start) || typeof end !== 'string' || !isRealDate(end)) {
        fail(400, 'Away dates must be real dates in YYYY-MM-DD.');
    }
    if (end < start) fail(400, 'The end date has to be the same day or later.');
    return { start, end };
}

export async function readOwnBestTimes(clientId: string): Promise<BestTimesView> {
    const client = await linkedClient(clientId);
    return viewFor(clientId, client.coach_id!, await getBestTimes(clientId));
}

export async function writeOwnBestTimes(clientId: string, body: unknown): Promise<BestTimesView> {
    const client = await linkedClient(clientId);
    const current = await getBestTimes(clientId);
    const windows = assertWindows((body as { windows?: unknown })?.windows ?? []);
    const exact = assertExact((body as { exact_times?: unknown })?.exact_times ?? []);
    const saved = await saveBestTimes(clientId, windows, exact, current?.away ?? []);
    return viewFor(clientId, client.coach_id!, saved);
}

export async function addOwnAway(clientId: string, body: unknown): Promise<BestTimesView> {
    const client = await linkedClient(clientId);
    const range = assertAwayRange((body as { start?: unknown })?.start, (body as { end?: unknown })?.end);
    const current = await getBestTimes(clientId);
    const away = [...(current?.away ?? []), { id: randomUUID(), ...range }];
    const saved = await saveBestTimes(clientId, current?.windows ?? [], current?.exact_times ?? [], away);
    return viewFor(clientId, client.coach_id!, saved);
}

export async function removeOwnAway(clientId: string, awayId: string): Promise<BestTimesView> {
    const client = await linkedClient(clientId);
    const current = await getBestTimes(clientId);
    const away = (current?.away ?? []).filter(item => item.id !== awayId);
    if (away.length === (current?.away ?? []).length) fail(404, 'Those away dates were not found.');
    const saved = await saveBestTimes(clientId, current?.windows ?? [], current?.exact_times ?? [], away);
    return viewFor(clientId, client.coach_id!, saved);
}

export async function readClientBestTimesForCoach(coachId: string, clientId: string): Promise<BestTimesView & { client_name: string }> {
    const client = await validateClientOwnership(clientId, coachId);
    if (!client) fail(403, 'Access denied. This client does not belong to your account.');
    const view = await viewFor(clientId, coachId, await getBestTimes(clientId));
    return { ...view, client_name: client.name?.trim() || 'Client' };
}

export interface PreferenceHeat {
    has_preferences: boolean;
    counts: number[];
    busiest_title?: string;
    busiest_body?: string;
    quieter_title?: string;
    quieter_body?: string;
}

export async function preferenceHeat(coachId: string): Promise<PreferenceHeat> {
    const clients = await getAllClients(coachId);
    const prefs = await getBestTimesForClients(clients.map(client => client.id));
    const names = new Map(clients.map(client => [client.id, client.name?.trim() || '']));
    const byWindow = new Map<BestWindow, string[]>();
    for (const window of WINDOWS) byWindow.set(window, []);
    const hourClients: Array<Set<string>> = Array.from({ length: 15 }, () => new Set());

    for (const pref of prefs) {
        const name = names.get(pref.client_id) || '';
        if (!name) continue;
        const chosen = new Set<number>();
        for (const window of pref.windows ?? []) {
            if (!WINDOWS.includes(window)) continue;
            byWindow.get(window)!.push(name);
            for (const hour of hoursForWindow(window)) chosen.add(hour);
        }
        for (const exact of pref.exact_times ?? []) {
            const hour = Math.floor(toMinutes(exact.time) / 60);
            if (hour >= 6 && hour <= 20) chosen.add(hour);
        }
        for (const hour of chosen) hourClients[hour - 6].add(pref.client_id);
    }

    const counts = hourClients.map(set => set.size);
    const tallies = WINDOWS.map(window => ({ window, names: byWindow.get(window)! }));
    const any = tallies.some(item => item.names.length > 0) || counts.some(count => count > 0);
    if (!any) return { has_preferences: false, counts };

    const busiest = [...tallies].sort((a, b) => b.names.length - a.names.length)[0];
    const quieter = [...tallies].sort((a, b) => a.names.length - b.names.length)[0];
    const heat: PreferenceHeat = { has_preferences: true, counts };
    if (busiest && busiest.names.length > 0) {
        const copy = WINDOW_COPY[busiest.window];
        const n = busiest.names.length;
        const who = [...busiest.names].sort((a, b) => a.localeCompare(b))[0];
        heat.busiest_title = copy.busyTitle;
        heat.busiest_body = `${n} ${n === 1 ? 'client' : 'clients'} listed it in My best times, including ${who}.`;
    }
    if (quieter && busiest && quieter.window !== busiest.window) {
        const copy = WINDOW_COPY[quieter.window];
        const n = quieter.names.length;
        heat.quieter_title = copy.quietTitle;
        heat.quieter_body = `Useful if you want to offer ${copy.quietUse} and only ${n} ${n === 1 ? 'client' : 'clients'} marked ${copy.marked}.`;
    }
    return heat;
}

export async function goodForNames(
    coachId: string,
    date: string,
    startTime: string,
): Promise<string[]> {
    const clients = await getAllClients(coachId);
    const prefs = await getBestTimesForClients(clients.map(client => client.id));
    const names = new Map(clients.map(client => [client.id, client.name?.trim() || '']));
    const day = weekdayOf(date);
    const minutes = toMinutes(startTime);
    const matches: string[] = [];
    for (const pref of prefs) {
        const name = names.get(pref.client_id);
        if (!name) continue;
        if (isAway(pref.away ?? [], date)) continue;
        const window = matchingWindow(pref.windows ?? [], day, minutes);
        const exact = (pref.exact_times ?? []).some(item => item.day === day && item.time === startTime);
        if (window || exact) matches.push(name);
    }
    return matches.sort((a, b) => a.localeCompare(b));
}

function addMinutes(hhmm: string, minutes: number): string {
    const total = toMinutes(hhmm) + minutes;
    if (total <= 0 || total >= 24 * 60) fail(400, 'That time does not fit in the same day.');
    return fromMinutes(total);
}

export interface RequestView {
    id: string;
    client_id: string;
    client_name: string;
    date: string;
    start_time: string;
    end_time: string;
    note?: string;
    status: TimeRequest['status'];
    suggested_date?: string;
    suggested_start?: string;
    suggested_end?: string;
    headline: string;
    detail: string;
    suggestion_label?: string;
}

async function describe(request: TimeRequest, clientName: string): Promise<RequestView> {
    const rules = await getAvailabilityRules(request.coach_id);
    const prefs = await getBestTimes(request.client_id);
    const day = weekdayOf(request.date);
    const window = matchingWindow(prefs?.windows ?? [], day, toMinutes(request.start_time));
    const mins = toMinutes(request.end_time) - toMinutes(request.start_time);
    const when = formatDay(request.date);
    let detail = `${when} · ${mins} min`;
    if (window) {
        detail = `${when} · ${mins} min · sits in the ${WINDOW_COPY[window].label} window`;
    } else {
        const usual = (rules?.weekdays ?? []).find(item => item.day === day);
        const works = !!usual?.enabled && (usual.ranges?.length ?? 0) > 0;
        if (rules?.hours_saved && !works) {
            detail = `${when} · ${mins} min · you don't usually work ${WEEKDAY_NAME[day]}.`;
        }
    }
    const view: RequestView = {
        id: idOf(request._id),
        client_id: request.client_id,
        client_name: clientName,
        date: request.date,
        start_time: request.start_time,
        end_time: request.end_time,
        note: request.note,
        status: request.status,
        suggested_date: request.suggested_date,
        suggested_start: request.suggested_start,
        suggested_end: request.suggested_end,
        headline: `${clientName} asked for ${WEEKDAY_SHORT[day]} ${formatClock(request.start_time)}`,
        detail,
    };
    if (request.suggested_date && request.suggested_start) {
        view.suggestion_label = `You suggested ${formatDay(request.suggested_date)} ${formatClock(request.suggested_start)}. Nothing is booked until you accept.`;
    }
    return view;
}

export async function createTimeRequest(clientId: string, body: unknown): Promise<RequestView> {
    const client = await linkedClient(clientId);
    const date = (body as { date?: unknown })?.date;
    const start = (body as { start_time?: unknown })?.start_time;
    if (typeof date !== 'string' || !isRealDate(date)) fail(400, 'Choose a date.');
    if (date < todayInSingapore()) fail(400, 'Choose today or a later date.');
    if (typeof start !== 'string' || !isHm(start)) fail(400, 'Choose a time.');
    const noteRaw = (body as { note?: unknown })?.note;
    const note = typeof noteRaw === 'string'
        ? noteRaw.replace(/[\u0000-\u001F]/g, '').trim().slice(0, 280)
        : undefined;
    const existing = await findOpenRequest(clientId, date, start);
    if (existing) fail(409, 'You already asked for this time.');
    const rules = await getAvailabilityRules(client.coach_id!);
    const length = rules?.slot_length_minutes ?? 60;
    const end = addMinutes(start, length);
    const now = new Date();
    const saved = await insertTimeRequest({
        client_id: clientId,
        coach_id: client.coach_id!,
        date,
        start_time: start,
        end_time: end,
        ...(note ? { note } : {}),
        status: 'pending',
        created_at: now,
        updated_at: now,
    });
    return describe(saved, client.name?.trim() || 'Client');
}

export async function listOwnRequests(clientId: string): Promise<RequestView[]> {
    const client = await findClientById(clientId);
    if (!client) fail(404, 'Client account not found. Please sign out and sign in again.');
    const rows = await listTimeRequestsForClient(clientId);
    const name = client.name?.trim() || 'Client';
    return Promise.all(rows.map(row => describe(row, name)));
}

export async function listCoachRequests(coachId: string): Promise<RequestView[]> {
    const rows = await listOpenTimeRequestsForCoach(coachId);
    const clients = await getAllClients(coachId);
    const names = new Map(clients.map(client => [client.id, client.name?.trim() || 'Client']));
    const own = rows.filter(row => names.has(row.client_id));
    return Promise.all(own.map(row => describe(row, names.get(row.client_id) || 'Client')));
}

async function ownRequest(coachId: string, requestId: string): Promise<TimeRequest> {
    const request = await getTimeRequest(requestId);
    if (!request || request.coach_id !== coachId) fail(404, 'That request was not found.');
    const client = await validateClientOwnership(request.client_id, coachId);
    if (!client) fail(403, 'Access denied. This client does not belong to your account.');
    return request;
}

export async function acceptTimeRequest(coachId: string, requestId: string) {
    const request = await ownRequest(coachId, requestId);
    if (request.status !== 'pending' && request.status !== 'suggested') {
        fail(409, 'This request is no longer waiting.');
    }
    const date = request.suggested_date || request.date;
    const start = request.suggested_start || request.start_time;
    const end = request.suggested_end || request.end_time;
    const slot = await findOpenSlot(coachId, date, start, end);
    let booking;
    if (slot?._id) {
        booking = await bookSession({
            coach_id: coachId,
            client_id: request.client_id,
            availability_slot_id: idOf(slot._id),
            notes: request.note,
        });
    } else {
        booking = await quickBookSession({
            coach_id: coachId,
            client_id: request.client_id,
            date,
            start_time: start,
            end_time: end,
            notes: request.note,
        });
    }
    const updated = await updateTimeRequest(requestId, coachId, {
        status: 'accepted',
        booking_id: idOf(booking._id),
    });
    if (!updated) fail(500, 'The session was booked, but the request could not be updated.');
    const client = await validateClientOwnership(request.client_id, coachId);
    return describe(updated, client?.name?.trim() || 'Client');
}

export async function declineTimeRequest(coachId: string, requestId: string): Promise<RequestView> {
    const request = await ownRequest(coachId, requestId);
    if (request.status !== 'pending' && request.status !== 'suggested') {
        fail(409, 'This request is no longer waiting.');
    }
    const updated = await updateTimeRequest(requestId, coachId, { status: 'declined' });
    if (!updated) fail(404, 'That request was not found.');
    const client = await validateClientOwnership(request.client_id, coachId);
    return describe(updated, client?.name?.trim() || 'Client');
}

export async function suggestTimeRequest(coachId: string, requestId: string, body: unknown): Promise<RequestView> {
    const request = await ownRequest(coachId, requestId);
    if (request.status !== 'pending' && request.status !== 'suggested') {
        fail(409, 'This request is no longer waiting.');
    }
    const date = (body as { date?: unknown })?.date;
    const start = (body as { start_time?: unknown })?.start_time;
    if (typeof date !== 'string' || !isRealDate(date)) fail(400, 'Choose a date.');
    if (typeof start !== 'string' || !isHm(start)) fail(400, 'Choose a time.');
    const rules = await getAvailabilityRules(coachId);
    const length = rules?.slot_length_minutes ?? 60;
    const end = addMinutes(start, length);
    const updated = await updateTimeRequest(requestId, coachId, {
        status: 'suggested',
        suggested_date: date,
        suggested_start: start,
        suggested_end: end,
    });
    if (!updated) fail(404, 'That request was not found.');
    const client = await validateClientOwnership(request.client_id, coachId);
    return describe(updated, client?.name?.trim() || 'Client');
}
