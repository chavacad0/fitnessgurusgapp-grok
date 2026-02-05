import Database from "better-sqlite3";
import { getClientsWithoutCheckIn } from "./repositories/clientRepo";
import { runDailyReminders } from "./services/dailyReminderService";

// Initialize database with test data
const db = new Database("local-db/database.db");

console.log("🧪 Setting up test data...\n");

// Insert test coach
db.prepare(`
  INSERT OR REPLACE INTO coaches (id, whatsapp_number)
  VALUES ('coach-1', '+65 1234 5678')
`).run();

// Insert test clients
db.prepare(`
  INSERT OR REPLACE INTO clients (
    id, name, email, subscription_status, paid_until, access_override
  ) VALUES (?, ?, ?, ?, ?, ?)
`).run('client-1', 'John Doe', 'john@example.com', 'Active', '2026-12-31', 0);

db.prepare(`
  INSERT OR REPLACE INTO clients (
    id, name, email, subscription_status, paid_until, access_override
  ) VALUES (?, ?, ?, ?, ?, ?)
`).run('client-2', 'Jane Smith', 'jane@example.com', 'Active', '2026-12-31', 0);

// Client 3 has already checked in today (shouldn't get reminder)
db.prepare(`
  INSERT OR REPLACE INTO clients (
    id, name, email, subscription_status, paid_until, access_override
  ) VALUES (?, ?, ?, ?, ?, ?)
`).run('client-3', 'Bob Wilson', 'bob@example.com', 'Active', '2026-12-31', 0);

db.prepare(`
  INSERT OR REPLACE INTO check_ins (client_id, date)
  VALUES ('client-3', '2026-02-04')
`).run();

console.log("✅ Test data inserted\n");

// Run the daily reminders
console.log("🔔 Running daily reminders for 2026-02-04...\n");
runDailyReminders("2026-02-04");

console.log("\n🎉 Test complete!");
