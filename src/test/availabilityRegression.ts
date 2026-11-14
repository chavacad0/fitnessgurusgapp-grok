/**
 * Working hours, slot generation, and schedule ownership.
 *
 *   TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm run test:availability
 *
 * Safety:
 *   - Connects only through TEST_MONGODB_URI. It never reads MONGO_URI from .env.
 *   - Uses the database fitnessgurusg_availability_test.
 *   - Refuses to delete unless NODE_ENV is "test" and the name ends with "_test".
 *   - Drops only that test database.
 *
 * Names below are fixture labels stored in the test database.
 */
import type { AddressInfo } from 'net';
import { assertSafeTestDatabase } from './assertSafeTestDatabase';
import {
    addDays,
    generateOpenSlots,
    todayInSingapore,
    weekdayOf,
    type OccupiedInterval,
    type WeekdayHoursInput,
} from '../services/slotGeneration';

const TEST_MONGODB_URI = process.env.TEST_MONGODB_URI;
const TEST_DB = 'fitnessgurusg_availability_test';

if (!TEST_MONGODB_URI) {
    throw new Error(
        'TEST_MONGODB_URI is not set. This suite does not read MONGO_URI or .env. ' +
        'Point TEST_MONGODB_URI at a local MongoDB server.',
    );
}

process.env.MONGO_URI = TEST_MONGODB_URI;
process.env.DB_NAME = TEST_DB;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'availability-test-secret-not-real';
assertSafeTestDatabase(TEST_DB);

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: unknown, detail?: unknown): void {
    if (cond) {
        passed++;
        console.log(`  ✅ ${name}`);
    } else {
        failures.push(name);
        console.log(`  ❌ ${name}`, detail !== undefined ? JSON.stringify(detail) : '');
    }
}

function section(title: string): void {
    console.log(`\n▶ ${title}`);
}

function nextDate(want: ReturnType<typeof weekdayOf>, from = todayInSingapore()): string {
    let cursor = addDays(from, 1);
    for (let i = 0; i < 14; i++) {
        if (weekdayOf(cursor) === want) return cursor;
        cursor = addDays(cursor, 1);
    }
    throw new Error(`No ${want} in the next two weeks.`);
}

function week(enabled: Array<ReturnType<typeof weekdayOf>>): WeekdayHoursInput[] {
    const on = new Set(enabled);
    return (['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).map(day => ({
        day,
        enabled: on.has(day),
        ranges: on.has(day) ? [{ start: '08:00', end: '12:00' }] : [],
    }));
}

function slotsOn(
    date: string,
    extra: Partial<Parameters<typeof generateOpenSlots>[0]> = {},
    occupied: OccupiedInterval[] = [],
) {
    return generateOpenSlots({
        date,
        weekdays: week(['mon', 'tue', 'wed', 'thu', 'fri']),
        slotLength: 60,
        buffer: 10,
        blocks: [],
        overrides: [],
        occupied,
        ...extra,
    }).map(slot => `${slot.start_time}-${slot.end_time}`);
}

function pureTests(): void {
    section('Slot generation');

    check('14 Nov 2026 is Saturday in Asia/Singapore', weekdayOf('2026-11-14') === 'sat');

    const monday = '2026-11-16';
    check('16 Nov 2026 is Monday in Asia/Singapore', weekdayOf(monday) === 'mon');

    const twoRanges = generateOpenSlots({
        date: monday,
        weekdays: [{
            day: 'mon',
            enabled: true,
            ranges: [
                { start: '07:00', end: '10:00' },
                { start: '14:00', end: '17:00' },
            ],
        }],
        slotLength: 60,
        buffer: 0,
        blocks: [],
        overrides: [],
        occupied: [],
    }).map(slot => slot.start_time);
    check(
        'slots stay inside each range and skip the gap',
        JSON.stringify(twoRanges) === JSON.stringify(['07:00', '08:00', '09:00', '14:00', '15:00', '16:00']),
        twoRanges,
    );

    check(
        'a 60 min session with a 10 buffer frees the next start at 11:10',
        JSON.stringify(slotsOn(monday)) === JSON.stringify(['08:00-09:00', '09:10-10:10', '10:20-11:20']),
        slotsOn(monday),
    );

    const early = generateOpenSlots({
        date: monday,
        weekdays: [{ day: 'mon', enabled: true, ranges: [{ start: '05:00', end: '07:00' }] }],
        slotLength: 60,
        buffer: 0,
        blocks: [],
        overrides: [],
        occupied: [],
    }).map(slot => slot.start_time);
    const lateHour = generateOpenSlots({
        date: monday,
        weekdays: [{ day: 'mon', enabled: true, ranges: [{ start: '22:00', end: '23:30' }] }],
        slotLength: 60,
        buffer: 0,
        blocks: [],
        overrides: [],
        occupied: [],
    }).map(slot => slot.start_time);
    const late = generateOpenSlots({
        date: monday,
        weekdays: [{ day: 'mon', enabled: true, ranges: [{ start: '22:00', end: '23:30' }] }],
        slotLength: 45,
        buffer: 0,
        blocks: [],
        overrides: [],
        occupied: [],
    }).map(slot => `${slot.start_time}-${slot.end_time}`);
    check('a slot can start at 5:00 AM', JSON.stringify(early) === JSON.stringify(['05:00', '06:00']), early);
    check('a slot can start at 10:00 PM', JSON.stringify(lateHour) === JSON.stringify(['22:00']), lateHour);
    check('a 45 min grid fits twice inside 22:00–23:30', JSON.stringify(late) === JSON.stringify(['22:00-22:45', '22:45-23:30']), late);

    const blocked = slotsOn(monday, {
        blocks: [{ id: 'lunch', date: monday, kind: 'range', start: '09:10', end: '10:10', label: 'Lunch' }],
    });
    check('a range block removes the overlapping slot only', JSON.stringify(blocked) === JSON.stringify(['08:00-09:00', '10:20-11:20']), blocked);

    const dayOff = slotsOn(monday, {
        blocks: [{ id: 'off', date: monday, kind: 'day_off' }],
    });
    check('a whole day off removes every slot', dayOff.length === 0);

    const closed = slotsOn(monday, {
        overrides: [{ id: 'hol', date: monday, kind: 'closed', note: 'public holiday' }],
    });
    check('a closed date removes every slot', closed.length === 0);

    const saturday = '2026-11-21';
    check('21 Nov 2026 is Saturday', weekdayOf(saturday) === 'sat');
    const extra = generateOpenSlots({
        date: saturday,
        weekdays: week(['mon', 'tue', 'wed', 'thu', 'fri']),
        slotLength: 60,
        buffer: 10,
        blocks: [],
        overrides: [{ id: 'sat', date: saturday, kind: 'extra', ranges: [{ start: '08:00', end: '12:00' }] }],
        occupied: [],
    }).map(slot => slot.start_time);
    const mondayStill = slotsOn(monday);
    check('extra slots open a day that is usually off', JSON.stringify(extra) === JSON.stringify(['08:00', '09:10', '10:20']), extra);
    check('the extra day does not change a normal weekday', JSON.stringify(mondayStill) === JSON.stringify(['08:00-09:00', '09:10-10:10', '10:20-11:20']));

    const booking: OccupiedInterval = {
        date: monday,
        start_time: '09:10',
        end_time: '10:10',
        status: 'booked',
    };
    const withBooking = slotsOn(monday, {}, [booking]);
    check(
        'an existing booking and its buffer hide that slot',
        JSON.stringify(withBooking) === JSON.stringify(['08:00-09:00', '10:20-11:20']),
        withBooking,
    );
    const completed = slotsOn(monday, {}, [{ ...booking, status: 'completed' }]);
    check('a completed booking still occupies the slot', JSON.stringify(completed) === JSON.stringify(['08:00-09:00', '10:20-11:20']));
    const cancelled = slotsOn(monday, {}, [{ ...booking, status: 'cancelled' }]);
    check(
        'a cancelled booking reopens the slot',
        JSON.stringify(cancelled) === JSON.stringify(['08:00-09:00', '09:10-10:10', '10:20-11:20']),
        cancelled,
    );
}

type ApiResult = { status: number; body: Record<string, unknown> | null };

async function main(): Promise<void> {
    pureTests();

    const jwt = (await import('jsonwebtoken')).default;
    const express = (await import('express')).default;
    const { ObjectId } = await import('mongodb');
    const { getDb, closeDb } = await import('../db/mongo');
    const routes = (await import('../api/routes')).default;

    const db = await getDb();
    if (db.databaseName !== TEST_DB) {
        throw new Error(`Connected to "${db.databaseName}" instead of "${TEST_DB}".`);
    }
    assertSafeTestDatabase(db.databaseName);
    await db.dropDatabase();
    await db.collection('bookings').createIndex(
        { availability_slot_id: 1 },
        { unique: true, sparse: true, name: 'bookings_slot_unique' },
    );

    const app = express();
    app.use(express.json());
    app.use('/api', routes);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', () => resolve()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const call = async (method: string, url: string, body?: unknown, token?: string): Promise<ApiResult> => {
        const res = await fetch(base + url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        let json: Record<string, unknown> | null = null;
        try { json = await res.json() as Record<string, unknown>; } catch { /* empty */ }
        return { status: res.status, body: json };
    };

    const secret = process.env.JWT_SECRET!;
    const sign = (payload: Record<string, unknown>) =>
        jwt.sign(payload, secret, { expiresIn: '1h' });

    const coachAId = new ObjectId().toString();
    const coachBId = new ObjectId().toString();
    const coachA = sign({ sub: coachAId, email: 'coach.a@test.local', role: 'coach' });
    const coachB = sign({ sub: coachBId, email: 'coach.b@test.local', role: 'coach' });
    const clientToken = sign({ sub: 'fixture-client', email: 'client@test.local', role: 'client' });
    const noRole = sign({ sub: coachAId, email: 'coach.a@test.local' });

    const hours = {
        weekdays: (['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).map(day => ({
            day,
            enabled: day !== 'sat' && day !== 'sun',
            ranges: day !== 'sat' && day !== 'sun' ? [{ start: '08:00', end: '12:00' }] : [],
        })),
    };

    try {
        section('Ownership');
        const noToken = await call('GET', '/api/coach/availability/rules');
        check('missing login is 401', noToken.status === 401, noToken.status);

        const clientCall = await call('PUT', '/api/coach/availability/rules/hours', hours, clientToken);
        check('a client login is 403 on coach hours', clientCall.status === 403, clientCall.status);

        const roleless = await call('GET', '/api/coach/schedule', undefined, noRole);
        check('a login with no role is 401', roleless.status === 401, roleless.status);

        const saved = await call('PUT', '/api/coach/availability/rules/hours', hours, coachA);
        check('the coach can save working hours', saved.status === 200 && saved.body?.hours_saved === true, saved.body);
        check('rules are stored as Asia/Singapore', saved.body?.timezone === 'Asia/Singapore');

        const other = await call('GET', '/api/coach/availability/rules', undefined, coachB);
        const otherDays = other.body?.weekdays as Array<{ day: string; enabled: boolean }> | undefined;
        const otherMonday = otherDays?.find(day => day.day === 'mon');
        check('another coach does not see these hours', other.status === 200 && other.body?.hours_saved === false && otherMonday?.enabled === false, other.body);

        const monday = nextDate('mon');
        const block = await call('POST', '/api/coach/availability/rules/blocks', {
            date: monday,
            kind: 'range',
            start: '09:10',
            end: '10:10',
            label: 'Lunch',
        }, coachA);
        const blocks = block.body?.blocks as Array<{ id: string }> | undefined;
        const blockId = blocks?.[0]?.id;
        check('the coach can block time', block.status === 201 && !!blockId, block.body);

        const stolen = await call('DELETE', `/api/coach/availability/rules/blocks/${blockId}`, undefined, coachB);
        check('another coach cannot remove the block', stolen.status === 404, stolen.status);
        const still = await call('GET', '/api/coach/availability/rules', undefined, coachA);
        const stillBlocks = still.body?.blocks as Array<{ id: string }> | undefined;
        check('the block is still on the owner', !!stillBlocks?.some(item => item.id === blockId));

        section('Schedule from hours');
        const settings = await call('PUT', '/api/coach/availability/rules/slot-settings', {
            slot_length_minutes: 60,
            buffer_minutes: 10,
        }, coachA);
        check('slot length and buffer save', settings.status === 200 && settings.body?.slot_length_minutes === 60 && settings.body?.buffer_minutes === 10, settings.body);

        await call('DELETE', `/api/coach/availability/rules/blocks/${blockId}`, undefined, coachA);

        const before = await call('GET', `/api/coach/schedule?date=${monday}`, undefined, coachB);
        const beforeItems = (before.body?.items as Array<{ kind: string; start_time?: string }>) ?? [];
        check(
            'a coach with no hours does not get a generated morning grid',
            before.body?.hours_saved === false && !beforeItems.some(item => item.start_time === '07:00'),
            beforeItems,
        );

        const schedule = await call('GET', `/api/coach/schedule?date=${monday}`, undefined, coachA);
        const open = ((schedule.body?.items as Array<{ kind: string; start_time: string; end_time: string; slot_id?: string }>) ?? [])
            .filter(item => item.kind === 'open');
        check(
            'the schedule lists the buffered slots',
            open.map(item => item.start_time).join(',') === '08:00,09:10,10:20',
            open,
        );
        check('each open slot has an id the booking path can use', open.every(item => !!item.slot_id));

        const clientId = 'fixture-client';
        const emptyId = 'fixture-empty';
        const expiry = addDays(todayInSingapore(), 90);
        await db.collection('clients').insertMany([
            { id: clientId, name: 'Fixture Client', email: 'fixture.client@test.local', coach_id: coachAId, plan_status: 'active' },
            { id: emptyId, name: 'Fixture Empty', email: 'fixture.empty@test.local', coach_id: coachAId, plan_status: 'active' },
        ]);
        await db.collection('client_plans').insertMany([
            {
                client_id: clientId,
                coach_id: coachAId,
                plan_name: 'Starter',
                sessions_total: 4,
                sessions_used: 0,
                start_date: todayInSingapore(),
                expiry_date: expiry,
                status: 'active',
                created_at: new Date(),
                updated_at: new Date(),
            },
            {
                client_id: emptyId,
                coach_id: coachAId,
                plan_name: 'Starter',
                sessions_total: 2,
                sessions_used: 2,
                start_date: todayInSingapore(),
                expiry_date: expiry,
                status: 'active',
                created_at: new Date(),
                updated_at: new Date(),
            },
        ]);

        const target = open.find(item => item.start_time === '09:10');
        const refused = await call('POST', '/api/bookings', {
            client_id: emptyId,
            availability_slot_id: target?.slot_id,
        }, coachA);
        check(
            'a client with no sessions left is refused',
            refused.status === 400 && String(refused.body?.error).includes('0 sessions left'),
            refused.body,
        );

        const booked = await call('POST', '/api/bookings', {
            client_id: clientId,
            availability_slot_id: target?.slot_id,
        }, coachA);
        check('booking uses the existing slot path', booked.status === 201, booked.body);

        const taken = await call('GET', `/api/coach/schedule?date=${monday}`, undefined, coachA);
        const takenItems = (taken.body?.items as Array<{ kind: string; start_time?: string; status?: string; client_name?: string }>) ?? [];
        check(
            'the booked time is no longer offered',
            !takenItems.some(item => item.kind === 'open' && item.start_time === '09:10')
            && takenItems.some(item => item.kind === 'booked' && item.start_time === '09:10' && item.client_name === 'Fixture Client'),
            takenItems,
        );

        const bookingId = (booked.body?.booking as { _id?: string } | undefined)?._id;
        const cancelled = await call('PATCH', `/api/bookings/${bookingId}/cancel`, undefined, coachA);
        check('cancel succeeds', cancelled.status === 200, cancelled.body);

        const reopened = await call('GET', `/api/coach/schedule?date=${monday}`, undefined, coachA);
        const reopenedOpen = ((reopened.body?.items as Array<{ kind: string; start_time?: string }>) ?? [])
            .filter(item => item.kind === 'open')
            .map(item => item.start_time);
        check('cancelling the booking reopens the slot', reopenedOpen.includes('09:10'), reopenedOpen);

        const outside = await call('POST', '/api/coach/availability', {
            date: monday, start_time: '06:00', end_time: '07:00',
        }, coachA);
        check('an older-style slot can still be created', outside.status === 201, outside.status);

        const clientView = await call('GET', '/api/clients/me/availability', undefined, clientToken);
        const clientSlots = (clientView.body?.slots as Array<{ date: string; start_time: string }>) ?? [];
        const mondaySlots = clientSlots.filter(slot => slot.date === monday).map(slot => slot.start_time);
        check('the client sees the generated slots', clientView.status === 200 && mondaySlots.includes('08:00'), mondaySlots);
        check('the client does not see a slot outside working hours', !mondaySlots.includes('06:00'), mondaySlots);

        const saturday = nextDate('sat');
        const extra = await call('POST', '/api/coach/availability/rules/overrides', {
            date: saturday,
            kind: 'extra',
            ranges: [{ start: '08:00', end: '12:00' }],
        }, coachA);
        const extraCount = (extra.body?.overrides as Array<{ date: string; slot_count?: number }> | undefined)
            ?.find(item => item.date === saturday)?.slot_count;
        check('a one-off Saturday adds slots without editing weekly hours', extra.status === 201 && extraCount === 3, extra.body);

        const holiday = nextDate('mon', addDays(monday, 1));
        await call('POST', '/api/coach/availability/rules/overrides', {
            date: holiday,
            kind: 'closed',
            note: 'public holiday',
        }, coachA);
        const closedDay = await call('GET', `/api/coach/schedule?date=${holiday}`, undefined, coachA);
        const closedItems = (closedDay.body?.items as Array<{ kind: string }>) ?? [];
        check(
            'a closed date has no open slots',
            closedItems.some(item => item.kind === 'closed') && !closedItems.some(item => item.kind === 'open'),
            closedItems,
        );

        const coachBView = await call('GET', `/api/coach/schedule?date=${monday}`, undefined, coachB);
        const bItems = (coachBView.body?.items as Array<{ client_name?: string }>) ?? [];
        check(
            'another coach does not see this booking',
            !bItems.some(item => item.client_name === 'Fixture Client'),
            bItems,
        );
    } finally {
        server.close();
        const { closeDb } = await import('../db/mongo');
        await closeDb();
    }

    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length > 0) {
        console.log(failures.map(name => `  - ${name}`).join('\n'));
        process.exit(1);
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
