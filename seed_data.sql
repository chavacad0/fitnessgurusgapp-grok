-- ============================================
-- Seed Data for Fitness Coaching App
-- ============================================

-- NOTE: Replace 'YOUR_COACH_UUID' with actual coach ID after creating coach account
-- You can get this from: SELECT id FROM coaches WHERE id = auth.uid();

-- ============================================
-- Package Catalog (Coach Offerings)
-- ============================================

INSERT INTO packages (coach_id, name, description, sessions_included, price_sgd, is_active)
VALUES
  -- Replace 'YOUR_COACH_UUID' with your actual coach UUID
  ('YOUR_COACH_UUID', 'Silver', 'Perfect for getting started with coaching', 10, 800.00, true),
  ('YOUR_COACH_UUID', 'Gold', 'Most popular - includes nutrition guidance', 20, 1500.00, true),
  ('YOUR_COACH_UUID', 'Platinum', 'Premium package with full support', 30, 2100.00, true);

-- ============================================
-- Alternative: Create packages without coach_id dependency
-- Use this if you want system-wide package templates
-- ============================================

/*
-- First, make coach_id nullable for system packages (optional)
ALTER TABLE packages ALTER COLUMN coach_id DROP NOT NULL;

-- Then insert system-wide packages
INSERT INTO packages (name, description, sessions_included, price_sgd, is_active)
VALUES
  ('Silver', 'Perfect for getting started with coaching', 10, 800.00, true),
  ('Gold', 'Most popular - includes nutrition guidance', 20, 1500.00, true),
  ('Platinum', 'Premium package with full support', 30, 2100.00, true);
*/

-- ============================================
-- Default Automated Message Rules (Example)
-- ============================================

-- Daily check-in reminder
INSERT INTO automated_message_rules (
  coach_id,
  trigger_type,
  message_template,
  send_via,
  trigger_time,
  is_active
)
VALUES
  (
    'YOUR_COACH_UUID',
    'daily_reminder',
    'Hey {name}! Don''t forget to log your check-in for today 💪',
    'both',
    '20:00:00',
    true
  ),
  (
    'YOUR_COACH_UUID',
    'missed_checkin',
    'Hi {name}, I noticed you haven''t checked in for a few days. Everything okay?',
    'whatsapp',
    NULL,
    true
  );

-- ============================================
-- Sample Meal Plans (Example)
-- ============================================

INSERT INTO meal_plans (coach_id, name, description, is_template)
VALUES
  (
    'YOUR_COACH_UUID',
    'Week 1 - High Protein',
    '1800 calories, 150g protein daily',
    true
  ),
  (
    'YOUR_COACH_UUID',
    'Week 2 - Moderate Carb',
    '2000 calories, balanced macros',
    true
  );
