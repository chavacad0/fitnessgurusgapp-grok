/**
 * Body-measurement figure on the client profile.
 *
 *   TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm run test:profile
 *
 * Safety:
 *   - Connects only through TEST_MONGODB_URI. It never reads MONGO_URI from .env.
 *   - Uses the database fitnessgurusg_profile_test.
 *   - Refuses to delete unless NODE_ENV is "test" and the name ends with "_test".
 *   - Drops only that test database.
 *
 * Fixture labels only. No real client.
 */
import type { AddressInfo } from 'net';
import { assertSafeTestDatabase } from './assertSafeTestDatabase';

const TEST_MONGODB_URI = process.env.TEST_MONGODB_URI;
const TEST_DB = 'fitnessgurusg_profile_test';

if (!TEST_MONGODB_URI) {
    throw new Error(
        'TEST_MONGODB_URI is not set. This suite does not read MONGO_URI or .env. ' +
        'Point TEST_MONGODB_URI at a local MongoDB server.',
    );
}

process.env.MONGO_URI = TEST_MONGODB_URI;
process.env.DB_NAME = TEST_DB;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'profile-test-secret-not-real';
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

async function main(): Promise<void> {
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
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const secret = process.env.JWT_SECRET as string;
    const sign = (payload: Record<string, string>) => jwt.sign(payload, secret, { expiresIn: '1h' });

    const clientA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const clientB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const coachA = 'coach-a-id';
    const coachB = 'coach-b-id';
    await db.collection('clients').insertMany([
        {
            id: clientA,
            name: 'Client A',
            email: 'a@test.local',
            coach_id: coachA,
            chest_cm: 88,
            hips_cm: 96,
            height_cm: 170,
        },
        { id: clientB, name: 'Client B', email: 'b@test.local', coach_id: coachB },
    ]);

    const tokenA = sign({ sub: clientA, email: 'a@test.local', role: 'client' });
    const tokenB = sign({ sub: clientB, email: 'b@test.local', role: 'client' });
    const coachAToken = sign({ sub: coachA, email: 'coach.a@test.local', role: 'coach' });
    const coachBToken = sign({ sub: coachB, email: 'coach.b@test.local', role: 'coach' });
    const noRole = sign({ sub: clientA, email: 'a@test.local', role: 'none' });

    const call = async (method: string, url: string, body?: unknown, token?: string) => {
        const res = await fetch(base + url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        let json: Record<string, unknown> | null = null;
        try { json = await res.json() as Record<string, unknown>; } catch { /* empty */ }
        return { status: res.status, body: json };
    };

    const profileOf = (res: { body: Record<string, unknown> | null }) =>
        (res.body?.profile ?? null) as Record<string, unknown> | null;

    const stored = async (id: string) => db.collection('clients').findOne({ id });

    try {
        section('Figure is optional and starts unset');
        let r = await call('GET', '/api/clients/me/profile', undefined, tokenA);
        check('own profile → 200', r.status === 200, r.status);
        check('sex is null when never chosen', profileOf(r)?.sex === null, profileOf(r));
        check('existing height is still returned', profileOf(r)?.height_cm === 170, profileOf(r));
        check('existing chest is still returned', profileOf(r)?.chest_cm === 88, profileOf(r));
        check('no token → 401', (await call('GET', '/api/clients/me/profile')).status === 401);
        check('token with no role → 401', (await call('GET', '/api/clients/me/profile', undefined, noRole)).status === 401);

        section('The client can save female or male on their own profile');
        r = await call('PATCH', '/api/clients/me/profile', { sex: 'male' }, tokenA);
        check('sex male → 200', r.status === 200, r.body);
        r = await call('GET', '/api/clients/me/profile', undefined, tokenA);
        check('saved sex is male', profileOf(r)?.sex === 'male', profileOf(r));
        let doc = await stored(clientA);
        check('male is stored on this client only', doc?.sex === 'male' && doc?.coach_id === coachA);
        check('saving the figure does not clear height', doc?.height_cm === 170);
        check('saving the figure does not clear chest', doc?.chest_cm === 88);
        check('saving the figure does not clear hips', doc?.hips_cm === 96);

        r = await call('PATCH', '/api/clients/me/profile', { sex: 'female' }, tokenA);
        check('sex female → 200', r.status === 200, r.body);
        r = await call('GET', '/api/clients/me/profile', undefined, tokenA);
        check('saved sex is female', profileOf(r)?.sex === 'female');

        section('A bad figure is refused and does not wipe the saved one');
        for (const bad of ['Female', 'male ', 'other', '', null, 1]) {
            r = await call('PATCH', '/api/clients/me/profile', { sex: bad }, tokenA);
            check(`sex ${JSON.stringify(bad)} → 400`, r.status === 400, r.body);
        }
        doc = await stored(clientA);
        check('rejected values leave sex as female', doc?.sex === 'female');

        r = await call('PATCH', '/api/clients/me/profile', { neck_cm: 32 }, tokenA);
        check('a measurement update without sex → 200', r.status === 200, r.body);
        doc = await stored(clientA);
        check('omitting sex leaves it unchanged', doc?.sex === 'female' && doc?.neck_cm === 32);

        section('Height uses the existing field');
        r = await call('PATCH', '/api/clients/me/profile', { height_cm: 165 }, tokenA);
        check('height 165 → 200', r.status === 200, r.body);
        r = await call('GET', '/api/clients/me/profile', undefined, tokenA);
        check('height is 165', profileOf(r)?.height_cm === 165, profileOf(r));
        check('height update leaves sex', profileOf(r)?.sex === 'female');
        r = await call('PATCH', '/api/clients/me/profile', { height_cm: 0, sex: 'male' }, tokenA);
        check('height 0 → 400', r.status === 400, r.body);
        r = await call('PATCH', '/api/clients/me/profile', { height_cm: 301 }, tokenA);
        check('height 301 → 400', r.status === 400, r.body);
        doc = await stored(clientA);
        check('rejected height does not change height or sex', doc?.height_cm === 165 && doc?.sex === 'female');

        section('Chest stays when other measurements are saved');
        r = await call('PATCH', '/api/clients/me/profile', { waist_cm: 70, neck_cm: 33 }, tokenA);
        check('waist and neck save → 200', r.status === 200, r.body);
        doc = await stored(clientA);
        check('chest is still 88', doc?.chest_cm === 88, doc?.chest_cm);
        check('hips are still 96', doc?.hips_cm === 96);
        r = await call('PATCH', '/api/clients/me/profile', { arm_cm: 30, thigh_cm: 50, sex: 'male' }, tokenA);
        check('unknown tape fields are ignored and sex still saves', r.status === 200, r.body);
        doc = await stored(clientA);
        check('arms and thighs are not stored', doc?.arm_cm === undefined && doc?.thigh_cm === undefined, doc);
        check('sex male was saved with that request', doc?.sex === 'male');

        section('Ownership stays on the logged-in client');
        r = await call('PATCH', '/api/clients/me/profile', {
            sex: 'female',
            id: clientB,
            coach_id: coachB,
            password_hash: 'nope',
            email: 'stolen@test.local',
        }, tokenA);
        check('email in the body → 400', r.status === 400, r.body);
        doc = await stored(clientA);
        check('rejected email does not change sex', doc?.sex === 'male');
        check('email was not replaced', doc?.email === 'a@test.local');
        const other = await stored(clientB);
        check('the other client is untouched', other?.sex === undefined && other?.name === 'Client B' && other?.coach_id === coachB);

        r = await call('PATCH', '/api/clients/me/profile', {
            sex: 'female',
            id: clientB,
            coach_id: coachB,
            password_hash: 'nope',
        }, tokenA);
        check('body id does not retarget the update → 200', r.status === 200, r.body);
        doc = await stored(clientA);
        const otherAfter = await stored(clientB);
        check('sex landed on the token client', doc?.sex === 'female' && doc?.coach_id === coachA);
        check('password was not written', doc?.password_hash === undefined);
        check('the other client still has no figure', otherAfter?.sex === undefined && otherAfter?.email === 'b@test.local');

        section('Role door and coach read');
        r = await call('PATCH', '/api/clients/me/profile', { sex: 'male' }, coachAToken);
        check('coach token cannot update a client profile → 403', r.status === 403, r.body);
        check('coach call did not change the client', (await stored(clientA))?.sex === 'female');

        r = await call('GET', `/api/clients/${clientA}/profile`, undefined, tokenA);
        check('client token cannot use the coach profile route → 403', r.status === 403, r.status);
        r = await call('GET', `/api/clients/${clientA}/profile`, undefined, coachBToken);
        check('another coach cannot read the profile → 403', r.status === 403, r.status);
        r = await call('GET', `/api/clients/${clientA}/profile`, undefined, coachAToken);
        check('owning coach can read the profile → 200', r.status === 200, r.body);
        check('owning coach sees the figure', profileOf(r)?.sex === 'female', profileOf(r));
        check('owning coach still sees chest and height', profileOf(r)?.chest_cm === 88 && profileOf(r)?.height_cm === 165, profileOf(r));

        r = await call('GET', '/api/clients/me/profile', undefined, tokenB);
        check('the other client still has no figure', profileOf(r)?.sex === null, profileOf(r));
    } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
        assertSafeTestDatabase(db.databaseName);
        await db.dropDatabase();
        await closeDb();
    }

    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length > 0) {
        console.log(failures.join('\n'));
        process.exit(1);
    }
}

main().catch(err => {
    const message = err instanceof Error ? err.message : String(err);
    if (/mongodb(\+srv)?:\/\//i.test(message)) {
        console.error('Profile tests failed before finishing. The database address was not printed.');
    } else {
        console.error(message);
    }
    process.exit(1);
});
