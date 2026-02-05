import cron from 'node-cron';
import { runRedFlagDetector } from '../src/services/redFlagDetector';
import { runDailyReminders } from '../src/services/dailyReminderService';

console.log('🕐 Scheduler started...\n');

// Run red flag detector every day at 9 AM Singapore time
cron.schedule('0 9 * * *', async () => {
    console.log('⏰ Running red flag detector (9 AM)...');
    const today = new Date().toISOString().split('T')[0];
    await runRedFlagDetector(today);
}, {
    timezone: 'Asia/Singapore'
});

// Run daily reminders every day at 6 PM Singapore time
cron.schedule('0 18 * * *', async () => {
    console.log('⏰ Running daily reminders (6 PM)...');
    const today = new Date().toISOString().split('T')[0];
    await runDailyReminders(today);
}, {
    timezone: 'Asia/Singapore'
});

// For testing: run every minute
// cron.schedule('* * * * *', async () => {
//   console.log('🧪 Test run...');
//   const today = new Date().toISOString().split('T')[0];
//   await runRedFlagDetector(today);
// });

console.log('✅ Scheduled jobs:');
console.log('   - Red flag detector: Daily at 9:00 AM');
console.log('   - Daily reminders: Daily at 6:00 PM');
console.log('   (Timezone: Asia/Singapore)\n');
console.log('Press Ctrl+C to stop');
