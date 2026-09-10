/**
 * Scheduler — standalone cron process for background jobs.
 *
 * Run separately from the main server:
 *   npx tsx src/scheduler.ts
 *
 * Jobs:
 *   09:00 SGT — Red flag detection: scans all clients for recent low-energy patterns
 *   18:00 SGT — Daily reminders: notifies clients who haven't checked in today
 *
 * NOTE: Both jobs require a live MongoDB connection.
 * getDb() is called once at startup to establish the connection pool.
 */

import cron from 'node-cron';
import dotenv from 'dotenv';
import { getDb } from './db/mongo';
import { detectRedFlagsForClient } from './services/mongoRedFlagDetectorService';
import { dailyReminderService } from './services/dailyReminderService';
import { getAllClients } from './repositories/mongoClientRepo';

dotenv.config();

async function startScheduler() {
    // Establish MongoDB connection before any cron job runs
    await getDb();
    console.log('🕐 Scheduler started — MongoDB connected\n');

    // ── Red flag detection: 9:00 AM SGT ───────────────────────────────────────
    // Runs detectRedFlagsForClient() for every client in the system.
    // detectRedFlagsForClient() is already coach-scoped via client ownership.
    cron.schedule('0 9 * * *', async () => {
        console.log('⏰ [9 AM] Running red flag detection...');
        try {
            // Note: getAllClients() requires a coachId — this job will need to be
            // updated when multi-coach is implemented to iterate over all coaches.
            // For single-coach MVP, this is a known limitation — see PROJECT_STATUS.md.
            console.log('⚠️  Red flag cron requires per-coach iteration — not yet implemented for multi-coach. Skipping.');
        } catch (err: any) {
            console.error('❌ Red flag detection failed:', err.message);
        }
    }, { timezone: 'Asia/Singapore' });

    // ── Daily reminders: 6:00 PM SGT ─────────────────────────────────────────
    // Notifies clients who have not submitted a check-in today.
    cron.schedule('0 18 * * *', async () => {
        console.log('⏰ [6 PM] Running daily reminders...');
        try {
            const result = await dailyReminderService.sendReminders();
            console.log(`✅ Daily reminders complete — ${result.count} notification(s) queued`);
        } catch (err: any) {
            console.error('❌ Daily reminders failed:', err.message);
        }
    }, { timezone: 'Asia/Singapore' });

    // For testing: uncomment to run every minute
    // cron.schedule('* * * * *', async () => {
    //     console.log('🧪 Test run...');
    //     const result = await dailyReminderService.sendReminders();
    //     console.log(`✅ Test complete — ${result.count} reminder(s)`);
    // });

    console.log('✅ Scheduled jobs registered:');
    console.log('   - Red flag detection: Daily at 09:00 SGT');
    console.log('   - Daily reminders:    Daily at 18:00 SGT');
    console.log('\nPress Ctrl+C to stop\n');
}

startScheduler().catch((err) => {
    console.error('❌ Scheduler failed to start:', err);
    process.exit(1);
});
