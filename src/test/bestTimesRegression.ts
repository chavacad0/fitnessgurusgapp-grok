/**
 * Client best times, away dates, and time requests.
 *
 *   TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm run test:best-times
 *
 * Safety:
 *   - Connects only through TEST_MONGODB_URI. It never reads MONGO_URI from .env.
 *   - Uses the database fitnessgurusg_best_times_test.
 *   - Refuses to delete unless NODE_ENV is "test" and the name ends with "_test".
 *   - Drops only that test database.
 *
 * Names below are fixture labels stored in the test database.
 */
import type { AddressInfo } from 'net';
import { assertSafeTestDatabase } from './assertSafeTestDatabase';
import { addDays, todayInSingapore, weekdayOf } from '../services/slotGeneration';

const TEST_MONGODB_URI = process.env.TEST_MONGODB_URI;
const TEST_DB = 'fitnessgurusg_best_times_test';

if (!TEST_MONGODB_URI) {
    throw new Error(
        'TEST_MONGODB_URI is not set. This suite does not read MONGO_URI or .env. ' +
        'Point TEST_MONGODB_URI at a local MongoDB server.',
    );
}

process.env.MONGO_URI = TEST_MONGODB_URI;
process.env.DB_NAME = TEST_DB;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'best-times-test-secret-not-real';
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

function nextWeekday(want: ReturnType<typeof weekdayOf>): string {
    let cursor = addDays(todayInSingapore(), 1);
    for (let i = 0; i < 14; i++) {
        if (weekdayOf(cursor) === want) return cursor;
        cursor = addDays(cursor, 1);
    }
    throw new Error(`No ${want} ahead.`);
}

type ApiResult = { status: number; body: Record<string, unknown> | null };

async function main(): Promise<void> {
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

    const sign = (payload: Record<string, unknown>) =>
        jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '1h' });

    const coachAId = new ObjectId().toString();
    const coachBId = new ObjectId().toString();
    const coachA = sign({ sub: coachAId, email: 'coach.a@test.local', role: 'coach' });
    const coachB = sign({ sub: coachBId, email: 'coach.b@test.local', role: 'coach' });
    const clientId = 'fixture-client';
    const emptyId = 'fixture-empty';
    const clientToken = sign({ sub: clientId, email: 'fixture.client@test.local', role: 'client' });
    const emptyToken = sign({ sub: emptyId, email: 'fixture.empty@test.local', role: 'client' });

    const thursday = nextWeekday('thu');
    const expiry = addDays(todayInSingapore(), 90);

    try {
        await db.collection('coaches').insertOne({
            _id: new ObjectId(coachAId),
            name: 'Fixture',
            email: 'coach.a@test.local',
            role: 'coach',
            provider: 'local',
            createdAt: new Date(),
        });
        await db.collection('clients').insertMany([
            { id: clientId, name: 'Fixture Client', email: 'fixture.client@test.local', coach_id: coachAId, plan_status: 'active' },
            { id: emptyId, name: 'Fixture Empty', email: 'fixture.empty@test.local', coach_id: coachAId, plan_status: 'active' },
        ]);
        await db.collection('client_plans').insertMany([
            {
                client_id: clientId, coach_id: coachAId, plan_name: 'Starter',
                sessions_total: 4, sessions_used: 0,
                start_date: todayInSingapore(), expiry_date: expiry, status: 'active',
                created_at: new Date(), updated_at: new Date(),
            },
            {
                client_id: emptyId, coach_id: coachAId, plan_name: 'Starter',
                sessions_total: 2, sessions_used: 2,
                start_date: todayInSingapore(), expiry_date: expiry, status: 'active',
                created_at: new Date(), updated_at: new Date(),
            },
        ]);

        section('Ownership');
        const noToken = await call('GET', '/api/clients/me/best-times');
        check('missing login is 401', noToken.status === 401, noToken.status);
        const coachOnClient = await call('GET', '/api/clients/me/best-times', undefined, coachA);
        check('a coach login cannot open the client best-times route', coachOnClient.status === 403, coachOnClient.status);
        const clientOnCoach = await call('GET', '/api/coach/time-requests', undefined, clientToken);
        check('a client login cannot open the coach inbox', clientOnCoach.status === 403, clientOnCoach.status);

        const saved = await call('PUT', '/api/clients/me/best-times', {
            windows: ['after_work'],
            exact_times: [{ day: 'thu', time: '19:00', note: 'After work window · most weeks' }],
        }, clientToken);
        check('the client can save best times', saved.status === 200, saved.body);
        check('the screen uses the linked coach name', saved.body?.coach_name === 'Coach Fixture', saved.body?.coach_name);

        const otherCoach = await call('GET', `/api/coach/clients/${clientId}/best-times`, undefined, coachB);
        check('another coach cannot read these best times', otherCoach.status === 403, otherCoach.status);
        const ownCoach = await call('GET', `/api/coach/clients/${clientId}/best-times`, undefined, coachA);
        const windows = ownCoach.body?.windows as string[] | undefined;
        check('the owning coach can read them', ownCoach.status === 200 && windows?.includes('after_work'), ownCoach.body);

        section('Good for, and away dates');
        const hours = await call('PUT', '/api/coach/availability/rules/hours', {
            weekdays: (['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).map(day => ({
                day,
                enabled: day === 'thu',
                ranges: day === 'thu' ? [{ start: '18:00', end: '21:00' }] : [],
            })),
        }, coachA);
        check('Thursday evening hours save', hours.status === 200, hours.status);
        await call('PUT', '/api/coach/availability/rules/slot-settings', {
            slot_length_minutes: 60, buffer_minutes: 0,
        }, coachA);

        const schedule = await call('GET', `/api/coach/schedule?date=${thursday}`, undefined, coachA);
        const open = ((schedule.body?.items as Array<{ kind: string; start_time?: string; good_for?: string[] }>) ?? [])
            .filter(item => item.kind === 'open');
        const seven = open.find(item => item.start_time === '19:00');
        check('7:00 PM is tagged Good for the client', !!seven?.good_for?.includes('Fixture Client'), open);
        const heat = schedule.body?.heat as { busiest_title?: string; busiest_body?: string } | undefined;
        check(
            'the heat strip is built from best times',
            heat?.busiest_title === 'After work 6–9 PM is the busiest window'
            && heat?.busiest_body === '1 client listed it in My best times, including Fixture Client.',
            heat,
        );

        const awayEnd = addDays(thursday, 1);
        const away = await call('POST', '/api/clients/me/away-dates', { start: thursday, end: awayEnd }, clientToken);
        check('away dates save', away.status === 201, away.status);
        const hidden = await call('GET', `/api/coach/schedule?date=${thursday}`, undefined, coachA);
        const hiddenSeven = ((hidden.body?.items as Array<{ kind: string; start_time?: string; good_for?: string[] }>) ?? [])
            .find(item => item.kind === 'open' && item.start_time === '19:00');
        check('an away date hides the client from Good for', !hiddenSeven?.good_for?.includes('Fixture Client'), hiddenSeven);

        section('Requests do not book until accept');
        const before = await db.collection('bookings').countDocuments({ client_id: emptyId });
        const asked = await call('POST', '/api/clients/me/time-requests', {
            date: thursday, start_time: '19:00', note: 'I can do Thursday evening this week.',
        }, emptyToken);
        const afterAsk = await db.collection('bookings').countDocuments({ client_id: emptyId });
        check('a request is stored', asked.status === 201, asked.body);
        check('sending a request does not create a booking', before === afterAsk, { before, afterAsk });
        const requestId = (asked.body?.request as { id?: string } | undefined)?.id;

        const refused = await call('POST', `/api/coach/time-requests/${requestId}/accept`, undefined, coachA);
        const afterRefuse = await db.collection('bookings').countDocuments({ client_id: emptyId });
        check(
            'accept with no sessions left is refused',
            refused.status === 400 && String(refused.body?.error).includes('0 sessions left'),
            refused.body,
        );
        check('a refused accept does not create a booking', afterRefuse === before);

        const still = await call('GET', '/api/coach/time-requests', undefined, coachA);
        const stillRows = still.body?.requests as Array<{ id: string; status: string }> | undefined;
        check('the request stays pending after a refused accept', stillRows?.some(row => row.id === requestId && row.status === 'pending'), stillRows);

        const stolen = await call('POST', `/api/coach/time-requests/${requestId}/accept`, undefined, coachB);
        check('another coach cannot accept the request', stolen.status === 404, stolen.status);

        const suggested = await call('POST', `/api/coach/time-requests/${requestId}/suggest`, {
            date: addDays(thursday, 7), start_time: '18:00',
        }, coachA);
        const afterSuggest = await db.collection('bookings').countDocuments({ client_id: emptyId });
        check('suggest does not book', suggested.status === 200 && afterSuggest === before, suggested.body);

        const declined = await call('POST', `/api/coach/time-requests/${requestId}/decline`, undefined, coachA);
        const afterDecline = await db.collection('bookings').countDocuments({ client_id: emptyId });
        check('decline does not book', declined.status === 200 && afterDecline === before, declined.body);

        const okAsk = await call('POST', '/api/clients/me/time-requests', {
            date: thursday, start_time: '18:00',
        }, clientToken);
        const okId = (okAsk.body?.request as { id?: string; headline?: string } | undefined);
        check('the headline uses the client name', okAsk.status === 201 && okId?.headline === 'Fixture Client asked for Thu 6:00 PM', okId);
        const accepted = await call('POST', `/api/coach/time-requests/${okId?.id}/accept`, undefined, coachA);
        const booked = await db.collection('bookings').countDocuments({ client_id: clientId, status: 'booked' });
        check('accept books through the existing path', accepted.status === 200 && booked === 1, accepted.body);
    } finally {
        server.close();
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
