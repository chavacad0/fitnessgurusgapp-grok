/**
 * seed-clean.ts — Creates proper test clients with UUID ids
 *
 * WHAT THIS DOES:
 *   - Creates 3 test clients linked to your real coach account
 *   - Each client has a proper UUID as their 'id' field
 *   - Each client has an email you can log in with
 *   - Creates 7 days of realistic check-in history for each
 *   - Creates an active session plan for 2 of the 3 clients
 *
 * PREREQUISITES:
 *   - At least one coach must exist in the coaches collection
 *   - Run reset-db.ts first if you want a clean start
 *
 * RUN: npx tsx src/scripts/seed-clean.ts
 * SAFE TO RE-RUN: deletes test_ clients first, then re-inserts
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/mongo';

async function seedClean() {
    const db = await getDb();
    console.log('\n🌱 Starting clean seed...\n');

    // ── Find the coach to link clients to ─────────────────────────────────────
    // Uses coach@test.com first, then any coach if not found.
    const coach =
        await db.collection('coaches').findOne({ email: 'coach@test.com' }) ??
        await db.collection('coaches').findOne({});

    if (!coach) {
        console.error('❌ No coach found. Register a coach account in the app first.');
        process.exit(1);
    }

    const coachId = (coach._id as any).toString();
    console.log(`✅ Using coach: ${coach.name} (${coach.email}) — _id: ${coachId}\n`);

    // ── Clean previous seed clients only ──────────────────────────────────────
    await db.collection('clients').deleteMany({ email: { $regex: /@seedtest\.com$/ } });
    await db.collection('checkins').deleteMany({ client_id: { $in: ['seed_harry', 'seed_priya', 'seed_david'] } });
    await db.collection('client_plans').deleteMany({ client_id: { $in: ['seed_harry', 'seed_priya', 'seed_david'] } });

    // ── Create 3 clean clients with proper UUIDs ──────────────────────────────
    const harryId = uuidv4();
    const priyaId = uuidv4();
    const davidId = uuidv4();

    const clients = [
        {
            id:       harryId,
            coach_id: coachId,
            name:     'Healthy Harry',
            email:    'harry@seedtest.com',
            plan_status: 'active',
        },
        {
            id:       priyaId,
            coach_id: coachId,
            name:     'Struggling Priya',
            email:    'priya@seedtest.com',
            plan_status: 'active',
        },
        {
            id:       davidId,
            coach_id: coachId,
            name:     'David No Plan',
            email:    'david@seedtest.com',
            plan_status: 'none',
        },
    ];

    await db.collection('clients').insertMany(clients);
    console.log('✅ Created 3 test clients with proper UUIDs:');
    clients.forEach(c => console.log(`   ${c.name} | id: ${c.id} | email: ${c.email}`));

    // ── Generate 7 days of check-ins per client ───────────────────────────────
    const checkIns: any[] = [];
    const today = new Date();

    for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];

        // Harry — consistently good metrics
        checkIns.push({
            client_id: harryId,
            date: dateStr,
            type: 'MANUAL',
            metrics: {
                energy:     7 + Math.floor(Math.random() * 3),
                hunger:     5 + Math.floor(Math.random() * 3),
                stepsToday: 8000 + Math.floor(Math.random() * 4000),
            },
            notes: 'Feeling great!',
            workoutDone: true,
            createdAt: new Date(),
            flaggedForReview: false,
        });

        // Priya — low energy last 3 days (triggers red flag detection)
        const energy = i < 3 ? 2 + Math.floor(Math.random() * 2) : 7 + Math.floor(Math.random() * 2);
        checkIns.push({
            client_id: priyaId,
            date: dateStr,
            type: 'MANUAL',
            metrics: {
                energy,
                hunger:     6 + Math.floor(Math.random() * 3),
                stepsToday: 5000 + Math.floor(Math.random() * 3000),
            },
            notes: i < 3 ? 'Feeling really tired lately...' : 'Good session today',
            workoutDone: true,
            createdAt: new Date(),
            flaggedForReview: false,
        });

        // David — only submitted 3 of 7 days (inconsistent)
        if (i >= 5 || i === 1) {
            checkIns.push({
                client_id: davidId,
                date: dateStr,
                type: 'MANUAL',
                metrics: {
                    energy:     6,
                    hunger:     7,
                    stepsToday: 4000,
                },
                notes: 'Busy day',
                workoutDone: false,
                createdAt: new Date(),
                flaggedForReview: false,
            });
        }
    }

    await db.collection('checkins').insertMany(checkIns);
    console.log(`\n✅ Created ${checkIns.length} check-ins (7 days Harry, 7 days Priya, 3 days David)`);

    // ── Create active plans for Harry and Priya ───────────────────────────────
    const now = new Date();
    const expiry = new Date(now);
    expiry.setDate(expiry.getDate() + 60);

    const plans = [
        {
            client_id:      harryId,
            coach_id:       coachId,
            plan_name:      'Performance Pack',
            sessions_total: 20,
            sessions_used:  4,
            start_date:     now.toISOString().split('T')[0],
            expiry_date:    expiry.toISOString().split('T')[0],
            status:         'active',
            created_at:     now,
            updated_at:     now,
        },
        {
            client_id:      priyaId,
            coach_id:       coachId,
            plan_name:      'Starter Pack',
            sessions_total: 10,
            sessions_used:  8,   // 2 remaining — will show "expiring soon"
            start_date:     now.toISOString().split('T')[0],
            expiry_date:    expiry.toISOString().split('T')[0],
            status:         'active',
            created_at:     now,
            updated_at:     now,
        },
    ];

    await db.collection('client_plans').insertMany(plans);
    console.log('✅ Created active plans for Harry (16 sessions left) and Priya (2 sessions left)');
    console.log('   David has no plan — useful for testing the 402 booking gate');

    console.log('\n🌱 Seed complete!\n');
    console.log('📋 Test accounts summary:');
    console.log(`   Coach:  coach@test.com  (use your password)`);
    console.log(`   Client: harry@seedtest.com  — active plan, 7 days check-ins`);
    console.log(`   Client: priya@seedtest.com  — expiring plan (2 sessions), low energy streak`);
    console.log(`   Client: david@seedtest.com  — NO plan, 3 check-ins`);
    console.log('\n   Note: harry/priya/david have no passwords — they are coach-provisioned.');
    console.log('   To log in as one: use "Sign in as Client" with their email only.');

    process.exit(0);
}

seedClean().catch(err => {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
});
