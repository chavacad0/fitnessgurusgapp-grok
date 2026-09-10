/**
 * fix-client-data.ts
 *
 * PURPOSE:
 *   Fixes two data problems that cause the coach dashboard to show
 *   seeded clients but NOT the real client's check-ins.
 *
 * PROBLEM 1 — Google OAuth client stored in wrong collection:
 *   Ava Gonzales registered via Google OAuth → landed in the `coaches`
 *   collection with role:'client'. Her user.id = her coach document _id.
 *   Check-ins were stored under that coach _id. But the dashboard only
 *   queries the `clients` collection → she never appears.
 *
 * PROBLEM 2 — Seeded clients have fake coach_id:
 *   The seed script hardcoded coach_id:'coach-1' which never matches
 *   any real coach's MongoDB _id → those clients don't belong to anyone.
 *
 * RUN:
 *   cd ~/Fitnessprac2
 *   npx ts-node src/scripts/fix-client-data.ts
 *
 * WHAT IT DOES:
 *   1. Finds the real coach account (by email — edit COACH_EMAIL below)
 *   2. Finds/creates a proper client document for the misplaced user
 *   3. Updates all orphaned check-ins to use the correct client id
 *   4. Re-links seeded clients (client-1, client-2, client-3) to real coach
 *
 * SAFE TO RUN MULTIPLE TIMES — all operations are idempotent.
 */

import { getDb } from '../db/mongo';
import { ObjectId } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';

// ─── CONFIGURE THESE FOR YOUR SETUP ──────────────────────────────────────────

/** Email of the COACH account you use to log in and view the dashboard. */
const COACH_EMAIL = 'coach@test.com';

/**
 * The _id of your Google OAuth account that is stored in the coaches collection.
 * This is the account you log in with AS A CLIENT.
 * From the DB: Ava Gonzales → 69db74d4c7e6ba55717eafec
 */
const MISPLACED_COACH_ID = '69db74d4c7e6ba55717eafec';

/** The email you log in with as a client. */
const CLIENT_EMAIL = 'avagonz726@gmail.com';

/** The display name for your client account. */
const CLIENT_NAME = 'Ava Gonzales';

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
    console.log('🔧 Starting data migration...\n');
    const db = await getDb();

    // ── Step 1: Find the real coach ───────────────────────────────────────────
    console.log(`[1] Looking up coach: ${COACH_EMAIL}`);
    const coach = await db.collection('coaches').findOne({ email: COACH_EMAIL });
    if (!coach) {
        console.error(`❌ No coach found with email: ${COACH_EMAIL}`);
        console.error(`   Available coaches:`);
        const coaches = await db.collection('coaches').find({}).project({ email: 1, name: 1 }).toArray();
        coaches.forEach(c => console.error(`     ${c.email} (${c.name})`));
        process.exit(1);
    }
    const realCoachId = (coach._id as ObjectId).toString();
    console.log(`   ✅ Coach found: ${coach.name} (_id: ${realCoachId})\n`);

    // ── Step 2: Find or create proper client document ─────────────────────────
    console.log(`[2] Looking for existing client document for: ${CLIENT_EMAIL}`);
    let clientDoc = await db.collection('clients').findOne({ email: CLIENT_EMAIL });

    if (clientDoc) {
        console.log(`   ✅ Client document already exists:`);
        console.log(`      id: ${clientDoc.id}`);
        console.log(`      coach_id: ${clientDoc.coach_id}`);

        // Ensure it is linked to the correct coach
        if (clientDoc.coach_id !== realCoachId) {
            console.log(`   ⚠️  coach_id mismatch — updating to ${realCoachId}`);
            await db.collection('clients').updateOne(
                { email: CLIENT_EMAIL },
                { $set: { coach_id: realCoachId } }
            );
            console.log(`   ✅ coach_id updated\n`);
        } else {
            console.log(`   ✅ coach_id already correct\n`);
        }

        // Re-fetch to get latest state
        clientDoc = await db.collection('clients').findOne({ email: CLIENT_EMAIL });
    } else {
        // Create a new proper client document
        const newClientId = uuidv4();
        const now = new Date().toISOString();
        const newClient = {
            id:        newClientId,
            name:      CLIENT_NAME,
            email:     CLIENT_EMAIL,
            coach_id:  realCoachId,
            createdAt: now,
        };
        console.log(`   📝 Creating new client document:`);
        console.log(`      id:       ${newClientId}`);
        console.log(`      coach_id: ${realCoachId}`);
        await db.collection('clients').insertOne(newClient as any);
        clientDoc = await db.collection('clients').findOne({ email: CLIENT_EMAIL });
        console.log(`   ✅ Client document created\n`);
    }

    const correctClientId = clientDoc!.id as string;

    // ── Step 3: Migrate orphaned check-ins ────────────────────────────────────
    console.log(`[3] Finding orphaned check-ins (client_id: ${MISPLACED_COACH_ID})`);
    const orphanedCheckins = await db.collection('checkins')
        .find({ client_id: MISPLACED_COACH_ID })
        .toArray();

    console.log(`   Found ${orphanedCheckins.length} orphaned check-in(s)`);

    if (orphanedCheckins.length > 0) {
        // Check for conflicts — if a check-in already exists for the same date under the correct id
        for (const checkin of orphanedCheckins) {
            const existing = await db.collection('checkins').findOne({
                client_id: correctClientId,
                date:      checkin.date,
            });

            if (existing) {
                console.log(`   ⚠️  Check-in for ${checkin.date} already exists under correct id — skipping`);
            } else {
                const result = await db.collection('checkins').updateOne(
                    { _id: checkin._id },
                    { $set: { client_id: correctClientId } }
                );
                console.log(`   ✅ Migrated check-in ${checkin.date}: ${MISPLACED_COACH_ID} → ${correctClientId} (modified: ${result.modifiedCount})`);
            }
        }
    }
    console.log('');

    // ── Step 4: Fix seeded clients coach_id ───────────────────────────────────
    console.log(`[4] Fixing seeded clients (id: client-1, client-2, client-3)`);
    const seededIds = ['client-1', 'client-2', 'client-3'];
    for (const id of seededIds) {
        const seeded = await db.collection('clients').findOne({ id });
        if (!seeded) {
            console.log(`   ⚠️  Seeded client ${id} not found — skipping`);
            continue;
        }
        if (seeded.coach_id === realCoachId) {
            console.log(`   ✅ ${seeded.name} (${id}) already linked to correct coach`);
        } else {
            await db.collection('clients').updateOne(
                { id },
                { $set: { coach_id: realCoachId } }
            );
            console.log(`   ✅ ${seeded.name} (${id}): coach_id updated → ${realCoachId}`);
        }
    }
    console.log('');

    // ── Step 5: Verification ──────────────────────────────────────────────────
    console.log('[5] Verification — clients now linked to your coach:');
    const myClients = await db.collection('clients').find({ coach_id: realCoachId }).toArray();
    console.log(`   Total clients for ${COACH_EMAIL}: ${myClients.length}`);
    myClients.forEach(c => console.log(`     • ${c.name} (${c.email}) id: ${c.id}`));

    console.log('');
    console.log('[6] Verification — check-ins for your client:');
    const myCheckins = await db.collection('checkins')
        .find({ client_id: correctClientId })
        .sort({ date: -1 })
        .limit(5)
        .toArray();
    console.log(`   Check-ins under correct client id (${correctClientId}): ${myCheckins.length}`);
    myCheckins.forEach(c => console.log(`     • ${c.date}`));

    if (myCheckins.length === 0) {
        console.log('   ⚠️  No check-ins found — submit a new check-in from the app after this migration');
    }

    console.log('\n✅ Migration complete!');
    console.log('\nNEXT STEPS:');
    console.log('  1. Restart the backend server (Ctrl+C then npm run server)');
    console.log('  2. In the app: log out then log back in as your CLIENT account');
    console.log('  3. Submit a check-in from the Home tab');
    console.log('  4. Log out, log back in as COACH (coach@test.com)');
    console.log('  5. Your client and their check-ins should now appear in the dashboard');

    process.exit(0);
}

main().catch(err => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});
