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
