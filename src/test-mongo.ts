/**
 * npm test — MongoDB smoke test.
 *
 * Safety:
 *   - Connects only through TEST_MONGODB_URI. It never reads .env and never
 *     falls back to MONGO_URI or DB_NAME.
 *   - Refuses to delete anything unless NODE_ENV is "test" and the database
 *     name ends with "_test".
 *   - Deletes only the three rows this file inserted (ids starting with npmtest-).
 *
 * The daily-reminder function is still a stub. This test expects that error.
 * It does not turn the stub on.
 */
import { MongoClient } from 'mongodb';
import { assertSafeTestDatabase } from './test/assertSafeTestDatabase';
import { runDailyReminders } from './services/mongoDailyReminderService';

const DEFAULT_TEST_DB_NAME = 'fitnessgurusg_test';
const TEST_CLIENT_IDS = ['npmtest-client-1', 'npmtest-client-2', 'npmtest-client-3'] as const;

function proveGuardBlocksUnsafeTargets(): void {
    const saved = process.env.NODE_ENV;

    process.env.NODE_ENV = 'development';
    expectGuardToThrow('fitnessgurusg_test', 'NODE_ENV=development');

    process.env.NODE_ENV = 'test';
    expectGuardToThrow('fitnessgurusg', 'database name "fitnessgurusg"');
    expectGuardToThrow('fitnessgurusg_test_backup', 'name that does not end with _test');
    expectGuardToThrow('', 'empty database name');

    assertSafeTestDatabase('fitnessgurusg_test');
    process.env.NODE_ENV = saved;
    console.log('✅ Safety guard blocks a non-test database name and a non-test NODE_ENV');
}

function expectGuardToThrow(dbName: string, label: string): void {
    try {
        assertSafeTestDatabase(dbName);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.startsWith('Refusing to delete data:')) {
            throw new Error(`Guard for ${label} threw an unexpected error: ${message}`);
        }
        console.log(`✅ Safety guard refused ${label}`);
        return;
    }
    throw new Error(`Safety guard did not refuse ${label}`);
}

async function testMongoDB(): Promise<void> {
    console.log('🧪 Testing MongoDB setup...\n');
    proveGuardBlocksUnsafeTargets();

    const uri = process.env.TEST_MONGODB_URI;
    const dbName = (process.env.TEST_DB_NAME ?? DEFAULT_TEST_DB_NAME).trim();
    if (!uri) {
        throw new Error(
            'TEST_MONGODB_URI is not set. npm test will not use MONGO_URI from .env. ' +
            'Point TEST_MONGODB_URI at a local MongoDB server. ' +
            `The database name must end with "_test" (default: ${DEFAULT_TEST_DB_NAME}).`,
        );
    }

    assertSafeTestDatabase(dbName);

    const client = new MongoClient(uri);
    await client.connect();
    try {
        const db = client.db(dbName);
        if (db.databaseName !== dbName) {
            throw new Error(`Connected to "${db.databaseName}" instead of "${dbName}".`);
        }
        assertSafeTestDatabase(db.databaseName);
        console.log(`✅ Connected to test database "${db.databaseName}"`);

        const ownClients = { id: { $in: [...TEST_CLIENT_IDS] } };
        const ownCheckIns = { client_id: { $in: [...TEST_CLIENT_IDS] } };

        console.log('🗑️  Removing only this test\'s previous rows...');
        await db.collection('clients').deleteMany(ownClients);
        await db.collection('check_ins').deleteMany(ownCheckIns);

        console.log('📝 Inserting this test\'s rows...');
        await db.collection('clients').insertMany([
            {
                id: 'npmtest-client-1',
                coach_id: 'npmtest-coach',
                name: 'Test Client One',
                email: 'npmtest-one@example.com',
                subscription_status: 'Active',
                paid_until: '2026-12-31',
                access_override: false,
            },
            {
                id: 'npmtest-client-2',
                coach_id: 'npmtest-coach',
                name: 'Test Client Two',
                email: 'npmtest-two@example.com',
                subscription_status: 'Active',
                paid_until: '2026-12-31',
                access_override: false,
            },
            {
                id: 'npmtest-client-3',
                coach_id: 'npmtest-coach',
                name: 'Test Client Three',
                email: 'npmtest-three@example.com',
                subscription_status: 'Active',
                paid_until: '2026-12-31',
                access_override: false,
            },
        ]);
        await db.collection('check_ins').insertOne({
            client_id: 'npmtest-client-3',
            date: '2026-02-04',
        });

        const inserted = await db.collection('clients').countDocuments(ownClients);
        if (inserted !== TEST_CLIENT_IDS.length) {
            throw new Error(`Expected ${TEST_CLIENT_IDS.length} test clients, found ${inserted}.`);
        }
        console.log('✅ Test rows inserted\n');

        console.log('🔔 Daily reminders are still a stub. Expecting that error...\n');
        let reminderRefused = false;
        try {
            await runDailyReminders('npmtest-coach', '2026-02-04');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!message.includes('not yet implemented')) throw error;
            reminderRefused = true;
        }
        if (!reminderRefused) {
            throw new Error('Expected runDailyReminders to refuse, because it is still a stub.');
        }
        console.log('✅ Reminder stub refused, as expected\n');

        console.log('🗑️  Removing only this test\'s rows...');
        assertSafeTestDatabase(db.databaseName);
        await db.collection('clients').deleteMany(ownClients);
        await db.collection('check_ins').deleteMany(ownCheckIns);
        const left = await db.collection('clients').countDocuments(ownClients);
        if (left !== 0) throw new Error('Test rows were not removed.');

        console.log('\n🎉 Test complete!');
    } finally {
        await client.close();
    }
}

testMongoDB().catch((error) => {
    console.error('❌ npm test failed:', error instanceof Error ? error.message : error);
    process.exit(1);
});
