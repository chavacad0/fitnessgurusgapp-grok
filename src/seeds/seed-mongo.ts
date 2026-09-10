import { getDb } from '../db/mongo';
import { CheckIn } from '../types';

/**
 * Seed script for test data.
 *
 * Creates 3 test clients with 7 days of check-ins each, linked to the REAL
 * coach account found in the coaches collection.
 *
 * WHY THIS MATTERS:
 *   The old version hardcoded coach_id: 'coach-1' — a fake string that never
 *   matched any real MongoDB ObjectId. Seeded clients were permanently orphaned:
 *   getAllClients(coachId) queries { coach_id: coachId } and would never find
 *   them because no real coach has _id === 'coach-1'.
 *
 *   This version looks up the real coach's _id first, then assigns it.
 *   Seeded clients will correctly appear under the logged-in coach's dashboard.
 *
 * SAFE TO RUN MULTIPLE TIMES:
 *   Deletes clients with id starting with 'test_' before inserting.
 *   Does NOT delete or modify any real client accounts.
 */

export async function seedDatabase() {
    const db = await getDb();

    console.log('🌱 Seeding database...');

    // ── Look up the real coach _id ────────────────────────────────────────────
    // findOne({ role: 'coach' }) — this is a single-coach system.
    // If you have multiple coaches, add an email filter:
    //   e.g. db.collection('coaches').findOne({ email: 'coach@test.com' })
    const coach = await db.collection('coaches').findOne({ role: 'coach' });
    if (!coach) {
        console.error('❌ No coach found in the coaches collection.');
        console.error('   Run the app and register a coach account first, then re-run this seed.');
        process.exit(1);
    }
    const realCoachId = (coach._id as any).toString();
    console.log(`✅ Using real coach: ${coach.name} (${coach.email}) — _id: ${realCoachId}`);

    // ── Delete existing test data only (keep real clients safe) ───────────────
    // ONLY deletes documents whose id starts with 'test_' — never touches real clients.
    await db.collection('clients').deleteMany({ id: { $regex: /^test_/ } });
    await db.collection('checkins').deleteMany({ client_id: { $regex: /^test_/ } });
    await db.collection('red_flags').deleteMany({ client_id: { $regex: /^test_/ } });
    console.log('✅ Old test documents cleared');

    // ── Create test clients linked to the REAL coach ──────────────────────────
    const clients = [
        {
            id:       'test_harry',
            coach_id: realCoachId,        // ← real ObjectId string, NOT 'coach-1'
            name:     'Healthy Harry',
            email:    'harry@test.com',
        },
        {
            id:       'test_sarah',
            coach_id: realCoachId,
            name:     'Struggling Sarah',
            email:    'sarah@test.com',
        },
        {
            id:       'test_ian',
            coach_id: realCoachId,
            name:     'Inconsistent Ian',
            email:    'ian@test.com',
        },
    ];

    await db.collection('clients').insertMany(clients);
    console.log(`✅ ${clients.length} test clients created (all linked to real coach)`);

    // ── Generate 7 days of check-ins ──────────────────────────────────────────
    const checkIns: CheckIn[] = [];
    const today = new Date();

    for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];

        // Healthy Harry — good metrics, consistent
        checkIns.push({
            client_id:         'test_harry',
            date:              dateStr,
            energy:            7 + Math.floor(Math.random() * 3),
            mood:              7 + Math.floor(Math.random() * 3),
            hunger:            5 + Math.floor(Math.random() * 3),
            workout_completed: true,
            steps:             8000 + Math.floor(Math.random() * 4000),
            weight:            75,
            notes:             'Feeling great!',
            created_at:        new Date(),
        });

        // Struggling Sarah — low energy last 3 days (triggers red flag)
        const sarahEnergy = i < 3 ? 2 + Math.floor(Math.random() * 2) : 7 + Math.floor(Math.random() * 2);
        checkIns.push({
            client_id:         'test_sarah',
            date:              dateStr,
            energy:            sarahEnergy,
            mood:              7 + Math.floor(Math.random() * 2),
            hunger:            6 + Math.floor(Math.random() * 3),
            workout_completed: true,
            steps:             5000 + Math.floor(Math.random() * 3000),
            weight:            68,
            notes:             i < 3 ? 'Feeling tired...' : 'Good day',
            created_at:        new Date(),
        });

        // Inconsistent Ian — missed workouts last 3 days
        checkIns.push({
            client_id:         'test_ian',
            date:              dateStr,
            energy:            7 + Math.floor(Math.random() * 2),
            mood:              7 + Math.floor(Math.random() * 2),
            hunger:            5 + Math.floor(Math.random() * 2),
            workout_completed: i >= 3,
            steps:             4000 + Math.floor(Math.random() * 3000),
            weight:            82,
            notes:             i < 3 ? 'Skipped workout' : 'Completed workout',
            created_at:        new Date(),
        });
    }

    await db.collection('checkins').insertMany(checkIns as any);
    console.log(`✅ ${checkIns.length} check-ins created`);
    console.log('');
    console.log('🌱 Seed complete. Log in as coach to see Healthy Harry, Struggling Sarah, and Inconsistent Ian.');
}
