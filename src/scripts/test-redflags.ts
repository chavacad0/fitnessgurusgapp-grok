import { getDb, closeDb } from '../db/mongo';
import { seedDatabase } from '../seeds/seed-mongo';
import { detectRedFlagsForClient } from '../services/mongoRedFlagDetectorService';
import { getCheckInsByClient } from '../repositories/mongoCheckinRepo';

/**
 * End-to-end test for red flag detection
 * Tests: Client Check-In → Red Flag Detection → Store Results
 */

async function testRedFlagDetection() {
    try {
        console.log('🚩 Testing Red Flag Detection Feature\n');
        console.log('='.repeat(50));
        console.log('');

        // Step 1: Seed the database
        await seedDatabase();

        // Step 2: Test each client
        const testClients = [
            { id: 'test_harry', name: 'Healthy Harry' },
            { id: 'test_sarah', name: 'Struggling Sarah' },
            { id: 'test_ian', name: 'Inconsistent Ian' }
        ];

        console.log('🧪 Running Red Flag Detection...\n');

        for (const client of testClients) {
            console.log('-'.repeat(50));
            console.log(`\n📋 Client: ${client.name} (${client.id})`);

            // Get recent check-ins
            const checkIns = await getCheckInsByClient(client.id, 7);
            console.log(`   Recent check-ins: ${checkIns.length}`);

            // Show last 3 check-ins details
            const last3 = checkIns.slice(0, 3);
            console.log('   Last 3 check-ins:');
            for (const checkIn of last3) {
                const details = [];
                if (checkIn.energy !== undefined) details.push(`energy: ${checkIn.energy}`);
                if (checkIn.mood !== undefined) details.push(`mood: ${checkIn.mood}`);
                if (checkIn.workout_completed !== undefined) {
                    details.push(`workout: ${checkIn.workout_completed ? 'Yes' : 'No'}`);
                }
                console.log(`     ${checkIn.date} - ${details.join(', ')}`);
            }

            // Run red flag detection
            const result = await detectRedFlagsForClient(client.id);

            console.log(`\n   🚩 Red flags detected: ${result.flagsDetected}`);

            if (result.flags.length > 0) {
                for (const flag of result.flags) {
                    console.log(`     - ${flag.type} (${flag.severity}): ${flag.message}`);
                }
            }

            console.log('');
        }

        console.log('='.repeat(50));
        console.log('\n✅ Test complete!\n');

        // Summary
        const db = await getDb();
        const totalRedFlags = await db.collection('red_flags').countDocuments();
        const totalCheckIns = await db.collection('checkins').countDocuments({ client_id: /^test_/ });
        const totalClients = await db.collection('clients').countDocuments({ id: /^test_/ });

        console.log('📊 Database Summary:');
        console.log(`   Test clients: ${totalClients}`);
        console.log(`   Test check-ins: ${totalCheckIns}`);
        console.log(`   Total red flags: ${totalRedFlags}`);
        console.log('');

    } catch (error) {
        console.error('❌ Error during test:', error);
        process.exit(1);
    } finally {
        await closeDb();
    }
}

// Run the test
testRedFlagDetection().catch(console.error);
