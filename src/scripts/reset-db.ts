/**
 * reset-db.ts — Complete database reset for FitnessGuruSG
 *
 * WHAT THIS DOES:
 *   - Wipes every collection that contains test/seeded data
 *   - Leaves coaches intact (you will re-use your existing coach account)
 *   - Then creates ONE clean coach account if none exists
 *
 * WHAT IT DOES NOT TOUCH:
 *   - The coaches collection is preserved so you don't have to re-register
 *
 * RUN: npx tsx src/scripts/reset-db.ts
 */

import { getDb } from '../db/mongo';

async function resetDatabase() {
    const db = await getDb();
    console.log('\n🔴 Starting full database reset...\n');

    // ── Step 1: Wipe all transactional + client data ──────────────────────────
    const toClear = [
        'clients',
        'checkins',
        'check_ins',       // old collection name — also clear it
        'client_plans',
        'bookings',
        'availability_slots',
        'payments',
        'red_flags',
    ];

    for (const col of toClear) {
        const result = await db.collection(col).deleteMany({});
        console.log(`  ✅ Cleared ${col}: ${result.deletedCount} docs removed`);
    }

    // ── Step 2: Show remaining coaches ────────────────────────────────────────
    const coaches = await db.collection('coaches').find(
        {},
        { projection: { _id: 1, name: 1, email: 1, inviteCode: 1 } }
    ).toArray();

    console.log(`\n📋 Remaining coaches (${coaches.length} total):`);
    coaches.forEach(c => {
        console.log(`   ${c.name} | ${c.email} | _id: ${c._id} | inviteCode: ${c.inviteCode ?? 'none'}`);
    });

    console.log('\n✅ Reset complete.');
    console.log('\n👉 NEXT STEPS:');
    console.log('   1. Log in as coach in the app');
    console.log('   2. Go to Profile tab → note your invite code (or tap to generate one)');
    console.log('   3. Log out → tap "Join a programme" → register as a new client');
    console.log('   4. Run: npx tsx src/scripts/seed-clean.ts  (to add test clients)');
    console.log('');

    process.exit(0);
}

resetDatabase().catch(err => {
    console.error('❌ Reset failed:', err.message);
    process.exit(1);
});
