-- ============================================
-- Quick Package Setup (No Coach ID Required)
-- ============================================
-- Use this if you want to create packages immediately
-- without linking to a specific coach
-- ============================================

-- Step 1: Make coach_id nullable (one-time change)
ALTER TABLE packages ALTER COLUMN coach_id DROP NOT NULL;

-- Step 2: Add system-wide default indicator
ALTER TABLE packages ADD COLUMN is_system_default BOOLEAN DEFAULT false;

-- Step 3: Insert packages
INSERT INTO packages (name, description, sessions_included, price_sgd, is_active, is_system_default)
VALUES
  ('Silver', 'Perfect for getting started with coaching', 10, 800.00, true, true),
  ('Gold', 'Most popular - includes nutrition guidance', 20, 1500.00, true, true),
  ('Platinum', 'Premium package with full support', 30, 2100.00, true, true);

-- ============================================
-- OR: Get coach UUID and insert properly
-- ============================================

/*
-- Step 1: Get your coach UUID (run after coach signup)
SELECT id, raw_user_meta_data->>'name' as name, email 
FROM auth.users 
WHERE email = 'your-coach-email@example.com';

-- Step 2: Insert packages with coach_id
INSERT INTO packages (coach_id, name, description, sessions_included, price_sgd, is_active)
VALUES
  ('paste-coach-uuid-here', 'Silver', 'Perfect for getting started', 10, 800.00, true),
  ('paste-coach-uuid-here', 'Gold', 'Most popular package', 20, 1500.00, true),
  ('paste-coach-uuid-here', 'Platinum', 'Premium package', 30, 2100.00, true);
*/
