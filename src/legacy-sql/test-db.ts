// Test script for local database
import { dailyReminderService } from './services/dailyReminderService';
import { redFlagDetectorService } from './services/redFlagDetectorService';
import db from '../../local-db/init';

async function testLocalDB() {
  console.log('🧪 Testing Local SQLite Database\n');

  // Test 1: Check database is initialized
  console.log('✅ Database initialized with tables:');
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all();
  tables.forEach((t: any) => console.log(`   - ${t.name}`));
  console.log('');

  // Test 2: Insert test data
  console.log('📝 Inserting test data...');

  // Insert test coach
  db.prepare(`
    INSERT OR REPLACE INTO coaches (id, business_name, whatsapp_number)
    VALUES ('coach-1', 'Test Coach', '+65 1234 5678')
  `).run();

  // Insert test client
  db.prepare(`
    INSERT OR REPLACE INTO clients (
      id, coach_id, name, email, subscription_status,
      paid_until, access_override
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'client-1',
    'coach-1',
    'John Doe',
    'john@example.com',
    'Active',
    '2026-12-31',
    0
  );

  // Insert automated reminder rule
  db.prepare(`
    INSERT OR REPLACE INTO automated_message_rules (
      id, coach_id, trigger_type, message_template, send_via, is_active
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    'rule-1',
    'coach-1',
    'daily_reminder',
    'Hi {name}! Don\'t forget your daily check-in 💪',
    'in_app',
    1
  );

  console.log('✅ Test data inserted\n');

  // Test 3: Run daily reminders
  console.log('📬 Running daily reminders...');
  const reminderResult = await dailyReminderService.sendReminders();
  console.log(`✅ Sent ${reminderResult.count} reminders\n`);

  // Test 4: Check notifications were created
  const notifications = db.prepare('SELECT * FROM notifications').all();
  console.log(`📊 Total notifications in DB: ${notifications.length}`);
  if (notifications.length > 0) {
    console.log('   Latest notification:', notifications[notifications.length - 1]);
  }
  console.log('');

  // Test 5: Run red flag detection
  console.log('🚩 Running red flag detection...');
  const flagResult = await redFlagDetectorService.detectRedFlags();
  console.log(`✅ Detected ${flagResult.flagsDetected} red flags\n`);

  console.log('🎉 All tests completed successfully!');
}

// Run tests
testLocalDB().catch(console.error);
