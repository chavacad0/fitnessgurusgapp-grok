// Local SQLite Database Initialization
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

const DB_PATH = path.join(__dirname, 'database.db');

// Create or open database
export const db = new Database(DB_PATH);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize schema
export function initializeDatabase() {
    console.log('🔧 Initializing SQLite database...');

    // Create tables
    db.exec(`
    -- Coaches table
    CREATE TABLE IF NOT EXISTS coaches (
      id TEXT PRIMARY KEY,
      business_name TEXT,
      whatsapp_number TEXT NOT NULL,
      stripe_account_id TEXT,
      onboarding_complete INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Clients table
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      coach_id TEXT REFERENCES coaches(id),
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      
      -- Package & Sessions
      current_package_id TEXT,
      sessions_remaining INTEGER DEFAULT 0,
      
      -- Subscription & Access
      subscription_status TEXT CHECK(subscription_status IN ('Invited', 'Active', 'Paused', 'Cancelled')) DEFAULT 'Invited',
      paid_until TEXT,
      access_override INTEGER DEFAULT 0,
      
      -- Profile & Goals
      target_weight_kg REAL,
      target_waist_cm REAL,
      daily_step_goal INTEGER,
      birthday TEXT,
      
      -- Compliance
      consent_whatsapp INTEGER DEFAULT 0,
      consent_data_processing INTEGER DEFAULT 0,
      
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Check-ins table
    CREATE TABLE IF NOT EXISTS check_ins (
      id TEXT PRIMARY KEY,
      client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
      date TEXT DEFAULT (date('now')),
      
      steps INTEGER,
      hunger INTEGER,
      energy INTEGER,
      weight REAL,
      waist REAL,
      notes TEXT,
      
      flagged INTEGER DEFAULT 0,
      reviewed INTEGER DEFAULT 0,
      
      created_at TEXT DEFAULT (datetime('now')),
      
      UNIQUE(client_id, date)
    );

    -- Automated message rules
    CREATE TABLE IF NOT EXISTS automated_message_rules (
      id TEXT PRIMARY KEY,
      coach_id TEXT NOT NULL REFERENCES coaches(id),
      trigger_type TEXT NOT NULL CHECK(trigger_type IN ('daily_reminder', 'missed_checkin', 'low_energy', 'high_hunger')),
      message_template TEXT NOT NULL,
      send_via TEXT NOT NULL CHECK(send_via IN ('whatsapp', 'in_app', 'both')),
      is_active INTEGER NOT NULL DEFAULT 1,
      trigger_time TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Notifications table
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      notification_type TEXT NOT NULL CHECK(notification_type IN ('check_in_reminder', 'red_flag', 'new_message', 'new_meal_plan')),
      reference_id TEXT,
      read_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_clients_coach ON clients(coach_id);
    CREATE INDEX IF NOT EXISTS idx_clients_subscription_status ON clients(subscription_status);
    CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);
    CREATE INDEX IF NOT EXISTS idx_checkins_client_date ON check_ins(client_id, date DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read_at);
  `);

    console.log('✅ Database initialized successfully');
}

// Initialize on import
initializeDatabase();

export default db;
