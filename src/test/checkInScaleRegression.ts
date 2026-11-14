/**
 * Check-in face/chip mapping and the coach "Worth a check-in" hint.
 *
 *   TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm run test:checkin
 *
 * Safety:
 *   - Connects only through TEST_MONGODB_URI. It never reads MONGO_URI from .env.
 *   - Uses the database fitnessgurusg_checkin_scale_test.
 *   - Refuses to delete unless NODE_ENV is "test" and the name ends with "_test".
 *   - Drops only that test database.
 *
 * Names below are fixture labels stored in the test database.
 * The app reads them back. It does not ship with a person's name written in.
 */
import type { AddressInfo } from 'net';
import { assertSafeTestDatabase } from './assertSafeTestDatabase';
import {
    APPETITE_CHIPS,
    ENERGY_FACES,
    LOW_DAY_MESSAGE,
    NORMAL_SUCCESS_TEXT,
    WORTH_A_CHECK_IN_LABEL,
    checkInSuccessText,
    nearestAppetite,
    nearestEnergyFace,
    worthACheckIn,
} from '../domain/checkInScale';

const TEST_MONGODB_URI = process.env.TEST_MONGODB_URI;
const TEST_DB = 'fitnessgurusg_checkin_scale_test';

if (!TEST_MONGODB_URI) {
    throw new Error(
        'TEST_MONGODB_URI is not set. This suite does not read MONGO_URI or .env. ' +
        'Point TEST_MONGODB_URI at a local MongoDB server.',
    );
}

process.env.MONGO_URI = TEST_MONGODB_URI;
process.env.DB_NAME = TEST_DB;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'checkin-scale-test-secret-not-real';
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

function shiftDate(iso: string, days: number): string {
    const [year, month, day] = iso.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

type StatusClient = {
    clientId?: string;
    clientName?: string;
    worth_check_in?: boolean;
};

type ApiResult = { status: number; body: Record<string, unknown> | null };

async function main(): Promise<void> {
    section('Energy faces map 1–10 onto 2, 4, 6, 8, 10');
    check('faces are Drained, Low, Okay, Good, Great',
        ENERGY_FACES.map(face => face.label).join(',') === 'Drained,Low,Okay,Good,Great');
    check('faces save 2, 4, 6, 8, 10',
        ENERGY_FACES.map(face => face.value).join(',') === '2,4,6,8,10');

    const energyMap: Array<[number, number]> = [
        [1, 2], [2, 2], [3, 4], [4, 4], [5, 6],
        [6, 6], [7, 8], [8, 8], [9, 10], [10, 10],
    ];
    for (const [stored, face] of energyMap) {
        check(`energy ${stored} shows face ${face}`, nearestEnergyFace(stored) === face);
    }
    check('energy below 1 still shows Drained', nearestEnergyFace(0) === 2);
    check('energy above 10 still shows Great', nearestEnergyFace(11) === 10);
    check('a missing energy number shows Okay', nearestEnergyFace(Number.NaN) === 6);

    section('Appetite chips map onto the 1–10 hunger field');
    check('chips are Not hungry, Normal, Always hungry',
        APPETITE_CHIPS.map(chip => chip.label).join(',') === 'Not hungry,Normal,Always hungry');
    check('chips save low 2, mid 5, high 9',
        APPETITE_CHIPS.map(chip => chip.value).join(',') === '2,5,9');

    const appetiteMap: Array<[number, number]> = [
        [1, 2], [2, 2], [3, 2],
        [4, 5], [5, 5], [6, 5], [7, 5],
        [8, 9], [9, 9], [10, 9],
    ];
    for (const [stored, chip] of appetiteMap) {
        check(`hunger ${stored} shows chip ${chip}`, nearestAppetite(stored) === chip);
    }
    check('hunger 8 is Always hungry, matching the high-hunger line', nearestAppetite(8) === 9);
    check('hunger 7 stays Normal', nearestAppetite(7) === 5);

    section('Success text and the worth-a-check-in rule');
    check('the hint label is Worth a check-in', WORTH_A_CHECK_IN_LABEL === 'Worth a check-in');
    check('Drained uses the tough-day sentence', checkInSuccessText(2) === LOW_DAY_MESSAGE);
    check('Low uses the tough-day sentence', checkInSuccessText(4) === LOW_DAY_MESSAGE);
    check('a stored 3, which shows as Low, uses the tough-day sentence',
        checkInSuccessText(3) === LOW_DAY_MESSAGE);
    check('Okay keeps the normal success text', checkInSuccessText(6) === NORMAL_SUCCESS_TEXT);
    check('Great keeps the normal success text', checkInSuccessText(10) === NORMAL_SUCCESS_TEXT);
    check('fewer than 3 check-ins is not a hint',
        worthACheckIn([
            { energy: 2, hunger: 9 },
            { energy: 4, hunger: 8 },
        ]) === false);
    check('last 3 low and always hungry is a hint',
        worthACheckIn([
            { energy: 2, hunger: 9 },
            { energy: 4, hunger: 8 },
            { energy: 1, hunger: 10 },
            { energy: 10, hunger: 2 },
        ]) === true);
    check('an older low day does not count when the newest is Okay',
        worthACheckIn([
            { energy: 6, hunger: 9 },
            { energy: 2, hunger: 9 },
            { energy: 2, hunger: 9 },
            { energy: 2, hunger: 9 },
        ]) === false);
    check('low energy with Normal appetite is not a hint',
        worthACheckIn([
            { energy: 2, hunger: 5 },
            { energy: 4, hunger: 5 },
            { energy: 2, hunger: 2 },
        ]) === false);
    check('always hungry with Okay energy is not a hint',
        worthACheckIn([
            { energy: 6, hunger: 9 },
            { energy: 8, hunger: 10 },
            { energy: 10, hunger: 8 },
        ]) === false);
    check('a missing appetite is not Always hungry',
        worthACheckIn([
            { energy: 2 },
            { energy: 2, hunger: 9 },
            { energy: 2, hunger: 9 },
        ]) === false);

    const jwt = (await import('jsonwebtoken')).default;
    const express = (await import('express')).default;
    const { getDb, closeDb } = await import('../db/mongo');
    const routes = (await import('../api/routes')).default;

    const db = await getDb();
    if (db.databaseName !== TEST_DB) {
        throw new Error(`Connected to "${db.databaseName}" instead of "${TEST_DB}".`);
    }
    assertSafeTestDatabase(db.databaseName);
    await db.dropDatabase();

    const app = express();
    app.use(express.json());
    app.use('/api', routes);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', () => resolve()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const call = async (method: string, url: string, token?: string): Promise<ApiResult> => {
        const res = await fetch(base + url, {
            method,
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        let json: Record<string, unknown> | null = null;
        try { json = await res.json() as Record<string, unknown>; } catch { /* empty */ }
        return { status: res.status, body: json };
    };

    const secret = process.env.JWT_SECRET!;
    const sign = (payload: Record<string, unknown>) =>
        jwt.sign(payload, secret, { expiresIn: '1h' });

    const coachAId = 'coach-scale-a';
    const coachBId = 'coach-scale-b';
    const coachAToken = sign({ sub: coachAId, email: 'coach.a@test.local', role: 'coach' });
    const coachBToken = sign({ sub: coachBId, email: 'coach.b@test.local', role: 'coach' });
    const clientToken = sign({ sub: 'client-token', email: 'client@test.local', role: 'client' });
    const noRoleToken = sign({ sub: 'norole', email: 'norole@test.local' });

    const anchor = '2026-11-10';
    const day = (offset: number) => shiftDate(anchor, offset);

    async function addClient(id: string, name: string, coachId: string): Promise<void> {
        await db.collection('clients').insertOne({
            id,
            name,
            email: `${id}@test.local`,
            coach_id: coachId,
            plan_status: 'none',
        });
    }

    async function addMood(
        clientId: string,
        offset: number,
        energy: number,
        hunger: number,
        legacy = false,
    ): Promise<void> {
        await db.collection('checkins').insertOne(legacy
            ? { client_id: clientId, date: day(offset), type: 'MANUAL', energy, hunger }
            : {
                client_id: clientId,
                date: day(offset),
                type: 'MANUAL',
                metrics: { energy, hunger },
                // Stale flat numbers that would qualify on their own.
                // The hint must read metrics first.
                energy: 2,
                hunger: 9,
            });
    }

    try {
        section('Coach status computes the hint from saved check-ins');

        const patternId = 'ccccccc1-cccc-4ccc-8ccc-ccccccccccc1';
        const steadyId = 'ccccccc1-cccc-4ccc-8ccc-ccccccccccc2';
        const shortId = 'ccccccc1-cccc-4ccc-8ccc-ccccccccccc3';
        const newestOkId = 'ccccccc1-cccc-4ccc-8ccc-ccccccccccc4';
        const legacyId = 'ccccccc1-cccc-4ccc-8ccc-ccccccccccc5';
        const otherId = 'ccccccc1-cccc-4ccc-8ccc-ccccccccccc6';

        await addClient(patternId, 'Pattern Client', coachAId);
        await addClient(steadyId, 'Steady Client', coachAId);
        await addClient(shortId, 'Short History', coachAId);
        await addClient(newestOkId, 'Newest Okay', coachAId);
        await addClient(legacyId, 'Legacy Fields', coachAId);
        await addClient(otherId, 'Other Coach Client', coachBId);

        for (const offset of [0, -1, -2]) {
            await addMood(patternId, offset, offset === -1 ? 4 : 2, offset === 0 ? 8 : 9);
        }
        await addMood(patternId, -3, 10, 2);

        for (const offset of [0, -1, -2]) {
            await addMood(steadyId, offset, 8, 5);
        }
        for (const offset of [0, -1]) {
            await addMood(shortId, offset, 2, 9);
        }
        await addMood(newestOkId, 0, 6, 9);
        await addMood(newestOkId, -1, 2, 9);
        await addMood(newestOkId, -2, 4, 10);
        for (const offset of [0, -1, -2]) {
            await addMood(legacyId, offset, 2, 10, true);
        }
        for (const offset of [0, -1, -2]) {
            await addMood(otherId, offset, 2, 9);
        }

        const coachA = await call('GET', '/api/clients/status', coachAToken);
        const coachAClients = (coachA.body?.clients as StatusClient[] | undefined) ?? [];
        const byId = new Map(coachAClients.map(client => [client.clientId, client]));

        check('coach status → 200', coachA.status === 200, coachA);
        check('pattern of low energy and always hungry is worth a check-in',
            byId.get(patternId)?.worth_check_in === true, byId.get(patternId));
        check('metrics win over an older flat energy number',
            byId.get(steadyId)?.worth_check_in === false, byId.get(steadyId));
        check('two check-ins are not enough',
            byId.get(shortId)?.worth_check_in === false, byId.get(shortId));
        check('the newest Okay day clears the hint',
            byId.get(newestOkId)?.worth_check_in === false, byId.get(newestOkId));
        check('older flat energy and hunger fields still count',
            byId.get(legacyId)?.worth_check_in === true, byId.get(legacyId));
        check('another coach’s client is not in this list',
            !coachAClients.some(client => client.clientId === otherId));

        const coachB = await call('GET', '/api/clients/status', coachBToken);
        const coachBClients = (coachB.body?.clients as StatusClient[] | undefined) ?? [];
        check('the other coach sees only their own client',
            coachB.status === 200
            && coachBClients.length === 1
            && coachBClients[0]?.clientId === otherId
            && coachBClients[0]?.worth_check_in === true,
            coachBClients);
        check('coach A clients are hidden from coach B',
            !coachBClients.some(client => client.clientId === patternId));

        const asClient = await call('GET', '/api/clients/status', clientToken);
        check('a client token cannot read the hint → 403',
            asClient.status === 403 && asClient.body?.error === 'Access denied.',
            asClient);
        check('the client response does not include the hint list',
            !Array.isArray(asClient.body?.clients));

        const noRole = await call('GET', '/api/clients/status', noRoleToken);
        check('a token with no role is logged out → 401', noRole.status === 401, noRole);
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
    console.error('💥 Check-in scale tests crashed:', err);
    process.exit(1);
});
