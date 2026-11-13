/**
 * Reliability regressions for AUD-010, AUD-011, and AUD-012.
 *
 *   TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm run test:reliability
 *
 * Safety:
 *   - Connects only through TEST_MONGODB_URI. It never reads MONGO_URI from .env.
 *   - Uses the database fitnessgurusg_reliability_test.
 *   - Refuses to delete unless NODE_ENV is "test" and the name ends with "_test".
 *   - Drops only that test database.
 *
 * Names below are fixture labels stored in the test database. The app reads
 * them back. It does not ship with a person's name written into the message.
 */
import { ObjectId } from 'mongodb';
import type { AddressInfo } from 'net';
import { assertSafeTestDatabase } from './assertSafeTestDatabase';

const TEST_MONGODB_URI = process.env.TEST_MONGODB_URI;
const TEST_DB = 'fitnessgurusg_reliability_test';

if (!TEST_MONGODB_URI) {
    throw new Error(
        'TEST_MONGODB_URI is not set. This suite does not read MONGO_URI or .env. ' +
        'Point TEST_MONGODB_URI at a local MongoDB server.',
    );
}

process.env.MONGO_URI = TEST_MONGODB_URI;
process.env.DB_NAME = TEST_DB;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'reliability-test-secret-not-real';
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

function sgtToday(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

function shiftDate(iso: string, days: number): string {
    const [year, month, day] = iso.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

type ApiResult = { status: number; body: Record<string, unknown> | null };

async function main(): Promise<void> {
    const jwt = (await import('jsonwebtoken')).default;
    const express = (await import('express')).default;
    const { getDb, closeDb } = await import('../db/mongo');
    const routes = (await import('../api/routes')).default;
    const { detectRedFlagsForClient } = await import('../services/mongoRedFlagDetectorService');

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
        try { json = await res.json() as Record<string, unknown>; } catch { /* empty body */ }
        return { status: res.status, body: json };
    };

    const secret = process.env.JWT_SECRET!;
    const sign = (payload: Record<string, unknown>) =>
        jwt.sign(payload, secret, { expiresIn: '1h' });

    const coachAId = new ObjectId().toString();
    const coachBId = new ObjectId().toString();
    const coachAToken = sign({ sub: coachAId, email: 'coach.one@test.local', role: 'coach' });
    const coachBToken = sign({ sub: coachBId, email: 'coach.two@test.local', role: 'coach' });

    const today = sgtToday();
    const slotDate = shiftDate(today, 21);
    const expiry = shiftDate(today, 120);
    let hour = 8;

    async function createSlot(): Promise<string> {
        const start = `${String(hour).padStart(2, '0')}:00`;
        const end = `${String(hour).padStart(2, '0')}:45`;
        hour += 1;
        const created = await call('POST', '/api/coach/availability', {
            date: slotDate, start_time: start, end_time: end,
        }, coachAToken);
        if (created.status !== 201) {
            throw new Error(`Could not create a slot: ${JSON.stringify(created)}`);
        }
        const slot = created.body?.slot as { _id?: string } | undefined;
        if (!slot?._id) throw new Error('Slot response had no id.');
        return slot._id;
    }

    async function addClient(opts: {
        id: string;
        name: string;
        email: string;
        sessions?: { total: number; used: number } | null;
    }): Promise<string> {
        await db.collection('clients').insertOne({
            id: opts.id,
            name: opts.name,
            email: opts.email,
            coach_id: coachAId,
            plan_status: opts.sessions ? 'active' : 'none',
        });
        if (opts.sessions) {
            await db.collection('client_plans').insertOne({
                client_id: opts.id,
                coach_id: coachAId,
                plan_name: 'Starter',
                sessions_total: opts.sessions.total,
                sessions_used: opts.sessions.used,
                start_date: today,
                expiry_date: expiry,
                status: 'active',
                created_at: new Date(),
                updated_at: new Date(),
            });
        }
        return sign({ sub: opts.id, email: opts.email, role: 'client' });
    }

    const slotClientId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    const slotClientName = 'Slot Client';
    const slotClientToken = await addClient({
        id: slotClientId,
        name: slotClientName,
        email: 'slot.client@test.local',
        sessions: { total: 8, used: 0 },
    });
    const namedClientId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    const namedClientName = 'Nia Client';
    await addClient({
        id: namedClientId,
        name: namedClientName,
        email: 'named.client@test.local',
        sessions: { total: 2, used: 2 },
    });
    const blankClientId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
    await addClient({
        id: blankClientId,
        name: '   ',
        email: 'blank.client@test.local',
        sessions: { total: 1, used: 1 },
    });
    const noPlanClientId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
    await addClient({
        id: noPlanClientId,
        name: 'Planless Client',
        email: 'noplan.client@test.local',
        sessions: null,
    });
    const reserveClientId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
    const reserveClientName = 'Reserve Client';
    await addClient({
        id: reserveClientId,
        name: reserveClientName,
        email: 'reserve.client@test.local',
        sessions: { total: 1, used: 0 },
    });

    const sessionsMessage = (name: string) => `${name} has 0 sessions left. Booking needs a new plan.`;
    const genericSessionsMessage = 'This client has 0 sessions left. Booking needs a new plan.';
    const noPlanMessage = 'This client does not have an active plan. They must purchase a plan before booking.';

    try {
        section('AUD-010 cancelled slot can be booked again');
        const slotId = await createSlot();
        let response = await call('POST', '/api/bookings', {
            client_id: slotClientId,
            availability_slot_id: slotId,
        }, coachAToken);
        check('first booking of an open slot → 201', response.status === 201, response);
        const firstBookingId = (response.body?.booking as { _id?: string } | undefined)?._id ?? '';

        response = await call('POST', '/api/bookings', {
            client_id: slotClientId,
            availability_slot_id: slotId,
        }, coachAToken);
        check('booking a taken slot still says it is already booked',
            response.status === 409 && response.body?.error === 'This time is already booked.',
            response);

        response = await call('PATCH', `/api/bookings/${firstBookingId}/cancel`, undefined, coachAToken);
        check('coach cancel → 200', response.status === 200, response);

        const cancelled = await db.collection('bookings').findOne({ _id: new ObjectId(firstBookingId) });
        check('cancelled booking no longer holds the slot id',
            cancelled?.status === 'cancelled' && cancelled?.availability_slot_id === undefined,
            cancelled);
        const freedSlot = await db.collection('coach_availability').findOne({ _id: new ObjectId(slotId) });
        check('cancelled slot is open again',
            freedSlot?.is_booked === false && freedSlot?.status === 'available',
            freedSlot);

        response = await call('POST', '/api/bookings', {
            client_id: slotClientId,
            availability_slot_id: slotId,
        }, coachAToken);
        check('same slot can be booked again after cancel → 201', response.status === 201, response);
        const rebookedId = (response.body?.booking as { _id?: string } | undefined)?._id;
        const holders = await db.collection('bookings').countDocuments({
            availability_slot_id: slotId,
            status: 'booked',
        });
        check('only the new booking points at that slot', holders === 1 && !!rebookedId, holders);

        section('AUD-010 a slot cancelled earlier can still be booked');
        const oldSlotId = await createSlot();
        await db.collection('bookings').insertOne({
            coach_id: coachAId,
            client_id: slotClientId,
            availability_slot_id: oldSlotId,
            date: slotDate,
            start_time: '06:00',
            end_time: '06:45',
            status: 'cancelled',
            created_at: new Date(),
            updated_at: new Date(),
        });
        response = await call('POST', '/api/bookings', {
            client_id: slotClientId,
            availability_slot_id: oldSlotId,
        }, coachAToken);
        check('booking a slot an old cancelled row still points at → 201', response.status === 201, response);
        const stillHolding = await db.collection('bookings').countDocuments({
            availability_slot_id: oldSlotId,
            status: 'cancelled',
        });
        check('the old cancelled row released the slot id', stillHolding === 0, stillHolding);

        section('AUD-010 client cancel also frees the slot');
        const clientSlotId = await createSlot();
        response = await call('POST', '/api/bookings', {
            client_id: slotClientId,
            availability_slot_id: clientSlotId,
        }, coachAToken);
        const clientBookingId = (response.body?.booking as { _id?: string } | undefined)?._id ?? '';
        response = await call('PATCH', `/api/clients/me/bookings/${clientBookingId}/cancel`, undefined, slotClientToken);
        check('client cancel of their own booking → 200', response.status === 200, response);
        response = await call('POST', '/api/bookings', {
            client_id: slotClientId,
            availability_slot_id: clientSlotId,
        }, coachAToken);
        check('coach can book that slot after the client cancels → 201', response.status === 201, response);

        section('AUD-011 sessions left, including bookings that are not finished');
        const zeroSlot = await createSlot();
        response = await call('POST', '/api/bookings', {
            client_id: namedClientId,
            availability_slot_id: zeroSlot,
        }, coachAToken);
        check('0 sessions left is refused with the client name',
            response.status === 400 && response.body?.error === sessionsMessage(namedClientName),
            response);
        const zeroBookings = await db.collection('bookings').countDocuments({ client_id: namedClientId });
        check('a refused booking did not create a row', zeroBookings === 0, zeroBookings);

        const blankSlot = await createSlot();
        response = await call('POST', '/api/bookings', {
            client_id: blankClientId,
            availability_slot_id: blankSlot,
        }, coachAToken);
        check('a client with no name uses the generic sessions message',
            response.status === 400 && response.body?.error === genericSessionsMessage,
            response);

        const slotsBeforeQuick = await db.collection('coach_availability').countDocuments({ coach_id: coachAId });
        response = await call('POST', '/api/bookings/quick', {
            client_id: namedClientId,
            date: slotDate,
            start_time: '05:00',
            end_time: '05:45',
        }, coachAToken);
        check('quick book with 0 sessions left uses the same message',
            response.status === 400 && response.body?.error === sessionsMessage(namedClientName),
            response);
        const slotsAfterQuick = await db.collection('coach_availability').countDocuments({ coach_id: coachAId });
        check('quick book did not leave a slot behind when sessions are 0',
            slotsAfterQuick === slotsBeforeQuick, { slotsBeforeQuick, slotsAfterQuick });

        response = await call('POST', '/api/bookings', {
            client_id: noPlanClientId,
            availability_slot_id: await createSlot(),
        }, coachAToken);
        check('no active plan keeps the existing refusal',
            response.status === 402 && response.body?.error === noPlanMessage,
            response);

        const firstReserveSlot = await createSlot();
        const secondReserveSlot = await createSlot();
        response = await call('POST', '/api/bookings', {
            client_id: reserveClientId,
            availability_slot_id: firstReserveSlot,
        }, coachAToken);
        check('a client with one session left can book once → 201', response.status === 201, response);
        const reserveBookingId = (response.body?.booking as { _id?: string } | undefined)?._id ?? '';
        response = await call('POST', '/api/bookings', {
            client_id: reserveClientId,
            availability_slot_id: secondReserveSlot,
        }, coachAToken);
        check('a second booking is refused while the first is still booked',
            response.status === 400 && response.body?.error === sessionsMessage(reserveClientName),
            response);
        await call('PATCH', `/api/bookings/${reserveBookingId}/cancel`, undefined, coachAToken);
        response = await call('POST', '/api/bookings', {
            client_id: reserveClientId,
            availability_slot_id: secondReserveSlot,
        }, coachAToken);
        check('cancelling the open booking frees that session → 201', response.status === 201, response);

        section('AUD-011 ownership and the coach door stay in place');
        response = await call('POST', '/api/bookings', {
            client_id: namedClientId,
            availability_slot_id: zeroSlot,
        }, coachBToken);
        check('another coach cannot book this client → 403',
            response.status === 403
            && response.body?.error === 'Access denied. This client does not belong to your account.',
            response);
        check('that denial does not mention sessions left',
            !String(response.body?.error ?? '').includes('sessions left'));

        response = await call('POST', '/api/bookings', {
            client_id: slotClientId,
            availability_slot_id: slotId,
        }, slotClientToken);
        check('a client token still cannot use the coach booking route → 403',
            response.status === 403 && response.body?.error === 'Access denied.',
            response);

        section('AUD-012 missed workouts follow real workout data');
        const calmCheckIn = {
            type: 'MANUAL',
            metrics: { energy: 8, hunger: 3, stepsToday: 8000 },
            mood: 8,
            notes: 'Steady day',
        };
        const day0 = today;
        const day1 = shiftDate(today, -1);
        const day2 = shiftDate(today, -2);

        async function seedCheckIns(clientId: string, withWorkoutFalse: boolean): Promise<void> {
            await db.collection('checkins').insertMany([day2, day1, day0].map(date => ({
                client_id: clientId,
                date,
                ...calmCheckIn,
                ...(withWorkoutFalse ? { workout_completed: false } : {}),
            })));
        }

        const plainId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
        await addClient({ id: plainId, name: 'Plain Checkin', email: 'plain@test.local', sessions: null });
        await seedCheckIns(plainId, false);
        let flags = await detectRedFlagsForClient(plainId);
        check('three check-ins with no workout field do not raise missed workouts',
            !flags.flags.some(flag => flag.type === 'MISSED_WORKOUT'),
            flags.flags.map(flag => flag.type));

        const explicitId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
        await addClient({ id: explicitId, name: 'Explicit Miss', email: 'explicit@test.local', sessions: null });
        await seedCheckIns(explicitId, true);
        flags = await detectRedFlagsForClient(explicitId);
        check('three check-ins that say the workout was not done do raise the flag',
            flags.flags.some(flag => flag.type === 'MISSED_WORKOUT'),
            flags.flags.map(flag => flag.type));

        const logMissId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
        await addClient({ id: logMissId, name: 'Log Miss', email: 'logmiss@test.local', sessions: null });
        await seedCheckIns(logMissId, false);
        await db.collection('workout_logs').insertMany([day2, day1, day0].map(date => ({
            assignment_id: `assign-${logMissId}-${date}`,
            client_id: logMissId,
            date,
            exercise_logs: [{ exercise_id: 'ex-1', completed: false }],
            created_at: new Date(),
            updated_at: new Date(),
        })));
        flags = await detectRedFlagsForClient(logMissId);
        check('workout logs that were not completed raise the flag',
            flags.flags.some(flag => flag.type === 'MISSED_WORKOUT'),
            flags.flags.map(flag => flag.type));

        const logDoneId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4';
        await addClient({ id: logDoneId, name: 'Log Done', email: 'logdone@test.local', sessions: null });
        await seedCheckIns(logDoneId, false);
        await db.collection('workout_logs').insertMany([day2, day1, day0].map(date => ({
            assignment_id: `assign-${logDoneId}-${date}`,
            client_id: logDoneId,
            date,
            exercise_logs: [{ exercise_id: 'ex-1', completed: true }],
            created_at: new Date(),
            updated_at: new Date(),
        })));
        flags = await detectRedFlagsForClient(logDoneId);
        check('a completed workout log does not raise missed workouts',
            !flags.flags.some(flag => flag.type === 'MISSED_WORKOUT'),
            flags.flags.map(flag => flag.type));

        const homeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5';
        const homeToken = await addClient({
            id: homeId, name: 'Home Checkin', email: 'home@test.local', sessions: null,
        });
        await db.collection('checkins').insertMany([day2, day1].map(date => ({
            client_id: homeId,
            date,
            ...calmCheckIn,
        })));
        response = await call('POST', `/api/clients/${homeId}/checkins`, {
            date: day0,
            type: 'MANUAL',
            metrics: { energy: 8, hunger: 3, stepsToday: 8000 },
            notes: 'Steady day',
        }, homeToken);
        const detected = (response.body?.detectedFlags as Array<{ type?: string }> | undefined) ?? [];
        check('a normal check-in save does not raise missed workouts',
            response.status === 200 && !detected.some(flag => flag.type === 'MISSED_WORKOUT'),
            response);
    } finally {
        server.close();
        assertSafeTestDatabase(db.databaseName);
        if (db.databaseName === TEST_DB) await db.dropDatabase();
        await closeDb();
    }

    console.log(`\n${failures.length === 0 ? '✅' : '❌'} ${passed} passed, ${failures.length} failed`);
    if (failures.length) {
        console.log('Failed:\n - ' + failures.join('\n - '));
        process.exit(1);
    }
}

main().catch(err => {
    console.error('💥 Reliability tests crashed:', err);
    process.exit(1);
});
