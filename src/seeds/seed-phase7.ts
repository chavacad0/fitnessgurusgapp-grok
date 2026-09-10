/**
 * Phase 7 QA Seed — inserts Alice, Bob, Clara under the real coach ObjectId.
 * Run: tsx src/seeds/seed-phase7.ts
 *
 * Designed for TC8–TC13 manual device tests.
 * Alice  → no check-in today  (Pending)
 * Bob    → checked in today   (Checked In)
 * Clara  → never checked in   (Pending, lastCheckInDate = null)
 */

import { getDb } from '../db/mongo';

const COACH_ID = '6997fdda07da36e29ccf0bc3'; // coach@test.com ObjectId

const TODAY = new Date().toISOString().split('T')[0]; // e.g. "2026-02-27"
const YESTERDAY = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
})();

async function run() {
    const db = await getDb();
    console.log('🌱 Phase 7 seed starting…');
    console.log(`   Coach ID : ${COACH_ID}`);
    console.log(`   Today    : ${TODAY}`);
    console.log(`   Yesterday: ${YESTERDAY}`);

    // ── 1. Remove existing Phase 7 clients & their data ────────────────────
    await db.collection('clients').deleteMany({ id: /^phase7_/ });
    await db.collection('checkins').deleteMany({ client_id: /^phase7_/ });
    console.log('🗑️  Removed existing phase7_ data');

    // ── 2. Insert 3 test clients ────────────────────────────────────────────
    const clients = [
        {
            id: 'phase7_alice',
            coach_id: COACH_ID,
            name: 'Alice Chen',
            email: 'alice@test.com',
            subscription_status: 'Active',
            paid_until: '2027-12-31',
            access_override: false,
        },
        {
            id: 'phase7_bob',
            coach_id: COACH_ID,
            name: 'Bob Tan',
            email: 'bob@test.com',
            subscription_status: 'Active',
            paid_until: '2027-12-31',
            access_override: false,
        },
        {
            id: 'phase7_clara',
            coach_id: COACH_ID,
            name: 'Clara Lim',
            email: 'clara@test.com',
            subscription_status: 'Active',
            paid_until: '2027-12-31',
            access_override: false,
        },
    ];
    await db.collection('clients').insertMany(clients);
    console.log(`✅ ${clients.length} clients inserted (Alice, Bob, Clara)`);

    // ── 3. Insert check-ins ─────────────────────────────────────────────────
    //   Alice  → checked in YESTERDAY only (no check-in today → Pending)
    //   Bob    → checked in TODAY (Checked In)
    //   Clara  → NO check-ins ever (lastCheckInDate = null)

    const checkins = [
        // Alice — yesterday check-in only
        {
            client_id: 'phase7_alice',
            date: YESTERDAY,
            energy: 7,
            hunger: 6,
            steps: 8000,
            notes: 'Feeling good',
            workout_completed: true,
            created_at: new Date(),
        },
        // Bob — today's check-in → renders "Checked in"
        {
            client_id: 'phase7_bob',
            date: TODAY,
            energy: 8,
            hunger: 5,
            steps: 10000,
            notes: 'Great session',
            workout_completed: true,
            created_at: new Date(),
        },
        // Clara — no check-ins (omitted entirely → lastCheckInDate = null)
    ];

    await db.collection('checkins').insertMany(checkins as any[]);
    console.log(`✅ ${checkins.length} check-ins inserted`);

    // ── 4. Verify via status endpoint (offline) ─────────────────────────────
    console.log('\n📊 Verification (expected state):');
    console.log(`   Alice  → hasCheckedInToday: false | lastCheckInDate: "${YESTERDAY}"`);
    console.log(`   Bob    → hasCheckedInToday: true  | lastCheckInDate: "${TODAY}"`);
    console.log(`   Clara  → hasCheckedInToday: false | lastCheckInDate: null`);
    console.log('\n✅ Phase 7 seed complete. Ready for TC8–TC13.');

    process.exit(0);
}

run().catch(err => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
});
