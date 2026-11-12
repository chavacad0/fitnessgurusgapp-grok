/**
 * Auth / Connect-to-Coach regression suite.
 *
 *   npm run test:auth
 *
 * ISOLATION & SAFETY
 *  - Runs against a SEPARATE database (TEST_DB_NAME, default 'fitnessgurusg_regression_test')
 *    on the same MongoDB server as MONGO_URI. The real DB_NAME from .env is NEVER written to.
 *  - Aborts before connecting if the test DB name equals the real DB name or does not
 *    contain "test".
 *  - The real database is only READ (document counts before/after) to prove it is untouched.
 *  - Only the isolated test database is dropped at the end.
 *
 * Google is not contacted: OAuth2Client.prototype.verifyIdToken is stubbed in-process,
 * so the route's own issuer / audience / email_verified checks are exercised for real.
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';
import type { AddressInfo } from 'net';

// ── 1. Environment isolation (must happen BEFORE any app module is imported) ──
const realEnv    = dotenv.parse(fs.readFileSync(path.join(process.cwd(), '.env')));
const REAL_DB    = realEnv['DB_NAME'];
const MONGO_URI  = process.env.MONGO_URI ?? realEnv['MONGO_URI'];
const TEST_DB    = process.env.TEST_DB_NAME ?? 'fitnessgurusg_regression_test';

if (!MONGO_URI) throw new Error('MONGO_URI not set');
if (!TEST_DB.toLowerCase().includes('test') || TEST_DB === REAL_DB) {
    throw new Error(`Refusing to run: test DB "${TEST_DB}" is not an isolated test database.`);
}

process.env.MONGO_URI        = MONGO_URI;
process.env.DB_NAME          = TEST_DB;
process.env.NODE_ENV         = 'test';                 // disables authLimiter
process.env.JWT_SECRET       = 'regression-test-secret-not-real';
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
const AUD = process.env.GOOGLE_CLIENT_ID;

// ── 2. Tiny test harness ─────────────────────────────────────────────────────
let passed = 0;
const failures: string[] = [];
function check(name: string, cond: any, detail?: any) {
    if (cond) { passed++; console.log(`  ✅ ${name}`); }
    else { failures.push(name); console.log(`  ❌ ${name}`, detail !== undefined ? JSON.stringify(detail) : ''); }
}
function section(t: string) { console.log(`\n▶ ${t}`); }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
    // Stub Google verification — token = "fake:" + base64(JSON payload) | "bad"
    const { OAuth2Client } = await import('google-auth-library');
    (OAuth2Client.prototype as any).verifyIdToken = async function ({ idToken }: { idToken: string }) {
        if (!idToken.startsWith('fake:')) throw new Error('Invalid token signature');
        const payload = JSON.parse(Buffer.from(idToken.slice(5), 'base64').toString('utf8'));
        return { getPayload: () => payload };
    };
    const gToken = (p: Record<string, any>) => 'fake:' + Buffer.from(JSON.stringify({
        iss: 'https://accounts.google.com', aud: AUD, email_verified: true, ...p,
    })).toString('base64');

    // Read-only snapshot of the REAL database
    const realClient = new MongoClient(MONGO_URI!);
    await realClient.connect();
    const realDb = realClient.db(REAL_DB);
    const REAL_COLS = ['clients', 'coaches', 'bookings', 'payments', 'client_plans', 'checkins', 'coach_availability'];
    const snapshot = async () => {
        const out: Record<string, number> = {};
        for (const c of REAL_COLS) out[c] = await realDb.collection(c).countDocuments({});
        return out;
    };
    const realBefore = await snapshot();

    // App modules (now bound to the TEST database)
    const express = (await import('express')).default;
    const jwt     = (await import('jsonwebtoken')).default;
    const bcrypt  = (await import('bcryptjs')).default;
    const { getDb, closeDb } = await import('../db/mongo');
    const routes     = (await import('../api/routes')).default;
    const authRoutes = (await import('../api/authRoutes')).default;

    const db = await getDb();
    if (db.databaseName !== TEST_DB) throw new Error(`Connected to ${db.databaseName}, expected ${TEST_DB}`);
    await db.dropDatabase();           // isolated test DB only — start clean
    const db2 = await getDb();
    // re-run index creation against the fresh test DB (same code path as server start)
    await db2.collection('clients').createIndex(
        { google_id: 1 },
        { unique: true, partialFilterExpression: { google_id: { $type: 'string' } }, name: 'clients_google_id_unique' },
    );

    const app = express();
    app.use(express.json());
    app.use('/api', routes);
    app.use('/api/auth', authRoutes);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const call = async (method: string, url: string, body?: any, token?: string) => {
        const res = await fetch(BASE + url, {
            method,
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        let json: any = null;
        try { json = await res.json(); } catch { /* */ }
        return { status: res.status, body: json };
    };
    const decode = (t: string) => jwt.decode(t) as any;

    // ── Fixtures (test DB only) ──────────────────────────────────────────────
    const coachA = new ObjectId(); const coachB = new ObjectId(); const legacyId = new ObjectId();
    const coachPwHash = await bcrypt.hash('CoachPass123', 4);
    await db.collection('coaches').insertMany([
        { _id: coachA, email: 'coach.a@test.local', name: 'Coach A', role: 'coach', provider: 'local', password_hash: coachPwHash, inviteCode: 'abc234', createdAt: new Date() },
        { _id: coachB, email: 'coach.b@test.local', name: 'Coach B', role: 'coach', provider: 'google', googleId: 'g-coach-b', password_hash: '', inviteCode: 'xyz789', createdAt: new Date() },
        // pre-fix Google client stored in coaches (must never act as coach or as a client identity)
        { _id: legacyId, email: 'legacy@test.local', name: 'Legacy G', role: 'client', provider: 'google', googleId: 'g-legacy', password_hash: '', inviteCode: 'bad111', createdAt: new Date() },
    ] as any[]);
    const pwClientId = '11111111-1111-4111-8111-111111111111';
    await db.collection('clients').insertOne({
        id: pwClientId, name: 'Pw Client', email: 'pw@test.local',
        password_hash: await bcrypt.hash('ClientPass123', 4), coach_id: coachA.toString(), plan_status: 'none',
    });
    const d = (n: number) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
    await db.collection('coach_availability').insertMany([
        { coach_id: coachA.toString(), date: d(2), start_time: '10:00', end_time: '11:00', is_booked: false, status: 'available' },
        { coach_id: coachA.toString(), date: d(3), start_time: '10:00', end_time: '11:00', is_booked: false, status: 'available' },
    ]);
    const coachesBefore = await db.collection('coaches').find({}).toArray();

    // ═════════════════════════════════════════════════════════════════════════
    section('Google login — new client');
    let r = await call('POST', '/api/auth/google', { idToken: gToken({ sub: 'g-new', email: 'New.User@Test.local', name: 'New User' }) });
    check('200 OK', r.status === 200, r);
    check('role = client', r.body?.role === 'client');
    check('no fake coach object returned', r.body?.coach === undefined);
    check('client.id is a UUID', UUID_RE.test(r.body?.client?.id ?? ''));
    check('has_coach = false, coach_id = null', r.body?.client?.has_coach === false && r.body?.client?.coach_id === null);
    const newTok = r.body?.token; const newId = r.body?.client?.id;
    check('JWT sub = clients.id, role client', decode(newTok)?.sub === newId && decode(newTok)?.role === 'client');
    let doc = await db.collection('clients').findOne({ id: newId });
    check('clients record created (email normalised, no coach_id, no password)', doc?.email === 'new.user@test.local' && !doc?.coach_id && !doc?.password_hash && doc?.google_id === 'g-new');
    check('no document created in coaches', (await db.collection('coaches').countDocuments({})) === coachesBefore.length);

    section('Google login — repeat sign-in is idempotent');
    r = await call('POST', '/api/auth/google', { idToken: gToken({ sub: 'g-new', email: 'new.user@test.local' }) });
    check('same client id', r.body?.client?.id === newId, r.body);
    check('no duplicate client records', (await db.collection('clients').countDocuments({ email: 'new.user@test.local' })) === 1);

    section('Google login — legacy client stored in coaches');
    r = await call('POST', '/api/auth/google', { idToken: gToken({ sub: 'g-legacy', email: 'legacy@test.local' }) });
    check('200 role client', r.status === 200 && r.body?.role === 'client', r);
    check('JWT sub is a clients UUID, NOT the coaches _id', UUID_RE.test(decode(r.body?.token)?.sub) && decode(r.body?.token)?.sub !== legacyId.toString());
    doc = await db.collection('clients').findOne({ id: r.body?.client?.id });
    check('clients record records legacy_user_id for traceability', doc?.legacy_user_id === legacyId.toString());
    const legacyAfter = await db.collection('coaches').findOne({ _id: legacyId });
    check('legacy coaches document untouched', JSON.stringify(legacyAfter) === JSON.stringify(coachesBefore.find(c => c._id.equals(legacyId))));

    section('Google login — existing email/password client (verified email)');
    r = await call('POST', '/api/auth/google', { idToken: gToken({ sub: 'g-pw', email: 'pw@test.local' }) });
    check('resolves to the existing client id', r.body?.client?.id === pwClientId, r.body);
    check('existing coach relationship preserved', r.body?.client?.coach_id === coachA.toString());
    doc = await db.collection('clients').findOne({ id: pwClientId });
    check('google_id linked, password_hash preserved', doc?.google_id === 'g-pw' && !!doc?.password_hash);
    r = await call('POST', '/api/auth/client-login', { email: 'pw@test.local', password: 'ClientPass123' });
    check('email/password login still works (sub = UUID)', r.status === 200 && decode(r.body?.token)?.sub === pwClientId, r.status);

    section('Google login — token verification failures');
    const before = await db.collection('clients').countDocuments({});
    r = await call('POST', '/api/auth/google', { idToken: gToken({ sub: 'g-unv', email: 'pw2@test.local', email_verified: false }) });
    check('unverified email → 401', r.status === 401, r);
    r = await call('POST', '/api/auth/google', { idToken: gToken({ sub: 'g-unv2', email: 'pw@test.local', email_verified: false }) });
    check('unverified email cannot link to existing client → 401', r.status === 401);
    check('…and google_id was not changed', (await db.collection('clients').findOne({ id: pwClientId }))?.google_id === 'g-pw');
    r = await call('POST', '/api/auth/google', { idToken: gToken({ sub: 'g-iss', email: 'iss@test.local', iss: 'https://evil.example.com' }) });
    check('wrong issuer → 401', r.status === 401);
    r = await call('POST', '/api/auth/google', { idToken: gToken({ sub: 'g-aud', email: 'aud@test.local', aud: 'someone-else' }) });
    check('wrong audience → 401', r.status === 401);
    r = await call('POST', '/api/auth/google', { idToken: 'bad' });
    check('bad signature → 401', r.status === 401);
    check('no client records created by rejected tokens', (await db.collection('clients').countDocuments({})) === before);

    section('Google login — duplicate identity protection');
    r = await call('POST', '/api/auth/google', { idToken: gToken({ sub: 'g-other', email: 'pw@test.local' }) });
    check('different Google account for an already-linked email → 409', r.status === 409, r);

    section('Google login — coaches (unchanged behaviour)');
    r = await call('POST', '/api/auth/google', { idToken: gToken({ sub: 'g-coach-b', email: 'coach.b@test.local' }) });
    check('linked Google coach → role coach, sub = coaches._id', r.body?.role === 'coach' && decode(r.body?.token)?.sub === coachB.toString() && r.body?.coach?.email === 'coach.b@test.local', r.body);
    const coachBTok = r.body?.token;
    r = await call('POST', '/api/auth/google', { idToken: gToken({ sub: 'g-coach-a', email: 'coach.a@test.local' }) });
    check('email/password coach signing in with Google → role coach (linked)', r.body?.role === 'coach' && decode(r.body?.token)?.sub === coachA.toString());
    check('coach not duplicated into clients', (await db.collection('clients').countDocuments({ email: 'coach.a@test.local' })) === 0);
    r = await call('POST', '/api/auth/login', { email: 'coach.a@test.local', password: 'CoachPass123' });
    check('coach email/password login still works', r.status === 200 && decode(r.body?.token)?.role === 'coach');

    section('Client without a coach — screens degrade gracefully');
    r = await call('GET', '/api/clients/me/availability', undefined, newTok);
    check('availability → 200, has_coach false, slots []', r.status === 200 && r.body?.has_coach === false && Array.isArray(r.body?.slots) && r.body.slots.length === 0, r);
    check('no "Client account data not found" error', !JSON.stringify(r.body).includes('Client account data not found'));
    r = await call('GET', '/api/clients/me/profile', undefined, newTok);
    check('profile → 200', r.status === 200, r);
    r = await call('GET', '/api/clients/me/plan', undefined, newTok);
    check('plan → 200 has_coach false', r.status === 200 && r.body?.has_coach === false, r);
    r = await call('GET', '/api/clients/me/bookings', undefined, newTok);
    check('bookings list → 200', r.status === 200);
    r = await call('GET', '/api/clients/me/workout/today', undefined, newTok);
    check('workout today → 200', r.status === 200);
    const slots = await db.collection('coach_availability').find({}).toArray();
    r = await call('POST', '/api/clients/me/bookings', { slot_id: slots[0]._id.toString() }, newTok);
    check('booking blocked with friendly 400', r.status === 400 && /connect/i.test(r.body?.error ?? ''), r);
    await call('POST', '/api/clients/select-plan', { plan_id: 'starter' }, newTok);
    r = await call('POST', '/api/payments/client-create', {}, newTok);
    check('payment blocked with friendly 400 (no orphaned payment)', r.status === 400 && /connect/i.test(r.body?.error ?? ''), r);
    check('no payment record created', (await db.collection('payments').countDocuments({ client_id: newId })) === 0);

    section('Connect-to-Coach — invitation code verification');
    r = await call('POST', '/api/auth/connect-coach', { inviteCode: 'NOPE99' }, newTok);
    check('invalid code → 400', r.status === 400, r);
    r = await call('POST', '/api/auth/connect-coach', { inviteCode: 'BAD111' }, newTok);
    check('code owned by a non-coach (legacy role client) → 400', r.status === 400, r);
    r = await call('POST', '/api/auth/connect-coach', { inviteCode: 'abc234', clientId: pwClientId, coachId: coachB.toString() }, newTok);
    check('valid code → 200 linked', r.status === 200 && r.body?.alreadyConnected === false, r);
    check('linked to the coach that owns the code (body coachId ignored)', (await db.collection('clients').findOne({ id: newId }))?.coach_id === coachA.toString());
    check('identity from JWT only (body clientId ignored — other client untouched)', (await db.collection('clients').findOne({ id: pwClientId }))?.coach_id === coachA.toString());
    r = await call('POST', '/api/auth/connect-coach', { inviteCode: 'ABC234' }, newTok);
    check('repeat submission → 200 alreadyConnected (idempotent)', r.status === 200 && r.body?.alreadyConnected === true, r);
    r = await call('POST', '/api/auth/connect-coach', { inviteCode: 'XYZ789' }, newTok);
    check('different coach → 409, not overwritten', r.status === 409, r);
    check('coach_id still Coach A', (await db.collection('clients').findOne({ id: newId }))?.coach_id === coachA.toString());
    r = await call('POST', '/api/auth/connect-coach', { inviteCode: 'ABC234' }, coachBTok);
    check('coach JWT cannot use connect-coach → 403', r.status === 403);
    r = await call('POST', '/api/auth/connect-coach', { inviteCode: 'ABC234' });
    check('no JWT → 401', r.status === 401);

    section('Booking access after connecting');
    r = await call('GET', '/api/clients/me/availability', undefined, newTok);
    check('availability → has_coach true with Coach A slots', r.status === 200 && r.body?.has_coach === true && r.body?.slots?.length === 2, r.body);
    await db.collection('client_plans').insertOne({
        client_id: newId, coach_id: coachA.toString(), plan_name: 'Starter', sessions_total: 4, sessions_used: 0,
        start_date: d(0), expiry_date: d(60), status: 'active', created_at: new Date(), updated_at: new Date(),
    });
    r = await call('POST', '/api/clients/me/bookings', { slot_id: slots[0]._id.toString() }, newTok);
    check('booking succeeds → 201', r.status === 201, r);
    r = await call('GET', '/api/clients/me/bookings', undefined, newTok);
    check('booking visible to client', r.body?.bookings?.length === 1);

    section('Authorization — tokens & roles');
    r = await call('GET', '/api/clients/me/availability', undefined, coachBTok);
    check('coach JWT on client route → 403', r.status === 403);
    const legacyTok = jwt.sign({ sub: legacyId.toString(), email: 'legacy@test.local', role: 'client' }, process.env.JWT_SECRET!);
    r = await call('GET', '/api/clients/me/availability', undefined, legacyTok);
    check('stale pre-fix Google token (sub = coaches._id) → 401, never used as client id', r.status === 401, r);
    r = await call('POST', `/api/clients/${legacyId.toString()}/checkins`, { date: d(0) }, legacyTok);
    check('stale token also rejected by authMiddleware routes → 401', r.status === 401, r);
    const regStyleTok = jwt.sign({ sub: new ObjectId().toString(), email: 'pw@test.local', role: 'client', clientId: pwClientId }, process.env.JWT_SECRET!);
    r = await call('GET', '/api/clients/me/availability', undefined, regStyleTok);
    check('client-register style token (sub=_id + clientId claim) still works', r.status === 200 && r.body?.has_coach === true, r);
    const forged = jwt.sign({ sub: newId, role: 'client' }, 'wrong-secret');
    r = await call('GET', '/api/clients/me/availability', undefined, forged);
    check('forged JWT → 401', r.status === 401);

    section('Client registration — no automatic coach assignment');
    r = await call('POST', '/api/auth/client-register', { name: 'Reg One', email: 'reg1@test.local', password: 'Password123', coach_id: coachB.toString() });
    check('no code → 201, has_coach false (body coach_id ignored)', r.status === 201 && r.body?.client?.has_coach === false, r);
    check('stored without coach_id', !(await db.collection('clients').findOne({ email: 'reg1@test.local' }))?.coach_id);
    r = await call('POST', '/api/auth/client-register', { name: 'Reg Two', email: 'reg2@test.local', password: 'Password123', inviteCode: 'WRONG1' });
    check('invalid code → 400 and no account created', r.status === 400 && (await db.collection('clients').countDocuments({ email: 'reg2@test.local' })) === 0, r);
    r = await call('POST', '/api/auth/client-register', { name: 'Reg Three', email: 'reg3@test.local', password: 'Password123', inviteCode: 'xyz789' });
    check('valid code → linked to that coach', r.status === 201 && r.body?.client?.coach_id === coachB.toString(), r);

    // ── Teardown ────────────────────────────────────────────────────────────
    server.close();
    const testDbName = db.databaseName;
    if (testDbName === TEST_DB && testDbName !== REAL_DB) await db.dropDatabase();
    await closeDb();

    section('Real database untouched (read-only document counts)');
    const realAfter = await snapshot();
    for (const c of REAL_COLS) check(`${c}: ${realBefore[c]} → ${realAfter[c]}`, realBefore[c] === realAfter[c]);
    await realClient.close();

    console.log(`\n${failures.length === 0 ? '✅' : '❌'} ${passed} passed, ${failures.length} failed`);
    if (failures.length) { console.log('Failed:\n - ' + failures.join('\n - ')); process.exit(1); }
    process.exit(0);
}

main().catch(err => { console.error('💥 Test run crashed:', err); process.exit(1); });

