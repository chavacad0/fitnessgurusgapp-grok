/**
 * ⚠️  LEGACY TEST SCRIPT — DO NOT RUN IN PRODUCTION ⚠️
 *
 * This script uses FAKE data that is INCOMPATIBLE with the real data model:
 *
 *   coach_id: 'coach-1'  ← NOT a real MongoDB ObjectId.
 *                           No coach document has _id === 'coach-1'.
 *                           Clients inserted with this coach_id will be INVISIBLE
 *                           to the real coach dashboard (which filters by real ObjectId).
 *
 * If you need test data, use src/seeds/seed-mongo.ts instead.
 * That script uses findSingleCoach() to get the real coach ObjectId before inserting clients.
 *
 * This file is kept for legacy reference only. Running it against the production
 * database will corrupt client records that cannot be seen by any coach.
 */
import { getDb, closeDb } from './db/mongo';
import { runDailyReminders } from './services/mongoDailyReminderService';

async function testMongoDB() {
    console.log('🧪 Testing MongoDB Setup...\n');

    // Connect to database
    const db = await getDb();

    console.log('🗑️  Clearing existing data...');
    await db.collection('clients').deleteMany({});
    await db.collection('check_ins').deleteMany({});
    console.log('');

    console.log('📝 Inserting test data...');

    // Insert test clients
    await db.collection('clients').insertMany([
        {
            id: 'client-1',
            coach_id: 'coach-1',
            name: 'John Doe',
            email: 'john@example.com',
            subscription_status: 'Active',
            paid_until: '2026-12-31',
            access_override: false
        },
        {
            id: 'client-2',
            coach_id: 'coach-1',
            name: 'Jane Smith',
            email: 'jane@example.com',
            subscription_status: 'Active',
            paid_until: '2026-12-31',
            access_override: false
        },
        {
            id: 'client-3',
            coach_id: 'coach-1',
            name: 'Bob Wilson',
            email: 'bob@example.com',
            subscription_status: 'Active',
            paid_until: '2026-12-31',
            access_override: false
        }
    ]);

    // Bob has already checked in today
    await db.collection('check_ins').insertOne({
        client_id: 'client-3',
        date: '2026-02-04'
    });

    console.log('✅ Test data inserted\n');

    // Run daily reminders
    console.log('🔔 Running daily reminders for 2026-02-04...\n');
    await runDailyReminders('2026-02-04');

    console.log('\n🎉 Test complete!');

    // Close connection
    await closeDb();
}

testMongoDB().catch(console.error);
