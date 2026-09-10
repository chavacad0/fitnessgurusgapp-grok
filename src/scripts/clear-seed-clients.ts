/**
 * clear-seed-clients.ts
 *
 * DEVELOPMENT-ONLY cleanup script.
 * Removes seed/test clients and their related data (check-ins, red flags).
 *
 * SAFETY RULES enforced by this script:
 *   ✅ Only removes clients whose email ends in @seedtest.com
 *      OR whose id field starts with 'test_'
 *   ✅ Cascades deletion to checkins and red_flags for those client IDs only
 *   ✅ NEVER touches the coaches collection
 *   ✅ NEVER touches real client accounts (any other email domain)
 *   ✅ Dry-run mode by default — pass --confirm to actually delete
 *
 * Usage:
 *   Dry run (safe, shows what WOULD be deleted):
 *     npx tsx src/scripts/clear-seed-clients.ts
 *
 *   Live delete (irreversible for seed data):
 *     npx tsx src/scripts/clear-seed-clients.ts --confirm
 */

import { getDb } from '../db/mongo';

async function clearSeedClients() {
    const db     = await getDb();
    const isDry  = !process.argv.includes('--confirm');

    if (isDry) {
        console.log('🔍 DRY RUN — no data will be deleted.');
        console.log('   Add --confirm to the command to actually delete.\n');
    } else {
        console.log('⚠️  LIVE RUN — data WILL be deleted.\n');
    }

    // ── Step 1: Find seed clients ─────────────────────────────────────────────
    // Match on: email domain @seedtest.com OR id starting with 'test_'
    const seedFilter = {
        $or: [
            { email: { $regex: /@seedtest\.com$/i } },
            { id:    { $regex: /^test_/ } },
        ],
    };

    const seedClients = await db.collection('clients').find(seedFilter, {
        projection: { _id: 1, id: 1, name: 1, email: 1 },
    }).toArray();

    if (seedClients.length === 0) {
        console.log('✅ No seed clients found. Database is already clean.');
        process.exit(0);
    }

    console.log(`Found ${seedClients.length} seed client(s) to remove:`);
    seedClients.forEach(c => {
        console.log(`  • ${c.name} <${c.email}> (id: ${c.id ?? c._id})`);
    });
    console.log('');

    // Collect both the MongoDB _id strings and the app-level id strings
    // so we can cascade-delete check-ins and red flags using either field.
    const mongoIds  = seedClients.map(c => c._id.toString());
    const appIds    = seedClients.map(c => c.id).filter(Boolean);
    const allIds    = Array.from(new Set([...mongoIds, ...appIds]));

    // ── Step 2: Preview / delete related check-ins ────────────────────────────
    const checkinFilter = { client_id: { $in: allIds } };
    const checkinCount  = await db.collection('checkins').countDocuments(checkinFilter);
    const checkInAlt    = await db.collection('check_ins').countDocuments(checkinFilter);
    console.log(`  → ${checkinCount} check-ins (checkins collection) linked to seed clients`);
    console.log(`  → ${checkInAlt}  check-ins (check_ins collection) linked to seed clients`);

    // ── Step 3: Preview / delete related red flags ────────────────────────────
    const flagFilter = { client_id: { $in: allIds } };
    const flagCount  = await db.collection('red_flags').countDocuments(flagFilter);
    console.log(`  → ${flagCount} red flags linked to seed clients`);
    console.log('');

    if (isDry) {
        console.log('DRY RUN complete. No changes made.');
        console.log('Run with --confirm to delete the above records.');
        process.exit(0);
    }

    // ── Step 4: LIVE DELETE (only reached when --confirm is passed) ───────────
    const r1 = await db.collection('checkins').deleteMany(checkinFilter);
    const r2 = await db.collection('check_ins').deleteMany(checkinFilter);
    const r3 = await db.collection('red_flags').deleteMany(flagFilter);
    const r4 = await db.collection('clients').deleteMany(seedFilter);

    console.log('✅ Deleted:');
    console.log(`   ${r4.deletedCount} seed client(s)`);
    console.log(`   ${r1.deletedCount + r2.deletedCount} check-in(s)`);
    console.log(`   ${r3.deletedCount} red flag(s)`);
    console.log('');
    console.log('✅ Coaches collection: UNTOUCHED');
    console.log('✅ Real client accounts: UNTOUCHED');
    console.log('');
    console.log('Database is now clean. Register a real client to verify the live flow.');

    process.exit(0);
}

clearSeedClients().catch(err => {
    console.error('❌ Script failed:', err);
    process.exit(1);
});
