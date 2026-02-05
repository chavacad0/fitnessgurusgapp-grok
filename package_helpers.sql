-- ============================================
-- Package Management Helper Queries & Functions
-- ============================================

-- ============================================
-- 1. CREATE PACKAGE CATALOG (Coach)
-- ============================================

-- Example: Coach creates package offerings
INSERT INTO packages (coach_id, name, description, sessions_included, price_sgd)
VALUES 
  ('coach-uuid-here', 'Silver Pack', '10 sessions over 2 months', 10, 800.00),
  ('coach-uuid-here', 'Gold Pack', '20 sessions over 4 months', 20, 1500.00),
  ('coach-uuid-here', 'Platinum Pack', '30 sessions over 6 months + nutrition plan', 30, 2100.00);

-- ============================================
-- 2. CLIENT PURCHASES PACKAGE
-- ============================================

-- Function to handle package purchase
CREATE OR REPLACE FUNCTION purchase_package(
  p_client_id uuid,
  p_package_id uuid,
  p_payment_method text,
  p_amount_paid numeric,
  p_stripe_payment_intent_id text DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_sessions_included integer;
  v_client_package_id uuid;
  v_payment_id uuid;
  v_expires_at date;
BEGIN
  -- Get package details
  SELECT sessions_included INTO v_sessions_included
  FROM packages
  WHERE id = p_package_id AND is_active = true;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Package not found or inactive';
  END IF;
  
  -- Set expiry (e.g., 6 months from purchase)
  v_expires_at := CURRENT_DATE + INTERVAL '6 months';
  
  -- Create client package purchase
  INSERT INTO client_packages (client_id, package_id, sessions_remaining, expires_at, status)
  VALUES (p_client_id, p_package_id, v_sessions_included, v_expires_at, 'active')
  RETURNING id INTO v_client_package_id;
  
  -- Record payment
  INSERT INTO payments (
    client_id,
    client_package_id,
    amount_sgd,
    payment_method,
    stripe_payment_intent_id,
    status,
    paid_at
  )
  VALUES (
    p_client_id,
    v_client_package_id,
    p_amount_paid,
    p_payment_method,
    p_stripe_payment_intent_id,
    'completed',
    NOW()
  )
  RETURNING id INTO v_payment_id;
  
  RETURN jsonb_build_object(
    'client_package_id', v_client_package_id,
    'payment_id', v_payment_id,
    'sessions_remaining', v_sessions_included,
    'expires_at', v_expires_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 3. LOG SESSION & DECREMENT BALANCE
-- ============================================

-- Function to log a session and decrement balance
CREATE OR REPLACE FUNCTION log_session(
  p_client_package_id uuid,
  p_coach_id uuid,
  p_session_date timestamp with time zone,
  p_duration_minutes integer DEFAULT 60,
  p_notes text DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_client_id uuid;
  v_sessions_remaining integer;
  v_session_id uuid;
BEGIN
  -- Get client package details
  SELECT client_id, sessions_remaining INTO v_client_id, v_sessions_remaining
  FROM client_packages
  WHERE id = p_client_package_id AND status = 'active';
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client package not found or inactive';
  END IF;
  
  IF v_sessions_remaining <= 0 THEN
    RAISE EXCEPTION 'No sessions remaining in this package';
  END IF;
  
  -- Create session record
  INSERT INTO sessions (
    client_id,
    client_package_id,
    coach_id,
    session_date,
    duration_minutes,
    notes
  )
  VALUES (
    v_client_id,
    p_client_package_id,
    p_coach_id,
    p_session_date,
    p_duration_minutes,
    p_notes
  )
  RETURNING id INTO v_session_id;
  
  -- Decrement sessions remaining
  UPDATE client_packages
  SET sessions_remaining = sessions_remaining - 1,
      status = CASE 
        WHEN sessions_remaining - 1 = 0 THEN 'completed'::text
        ELSE status
      END
  WHERE id = p_client_package_id;
  
  RETURN jsonb_build_object(
    'session_id', v_session_id,
    'sessions_remaining', v_sessions_remaining - 1,
    'package_status', CASE WHEN v_sessions_remaining - 1 = 0 THEN 'completed' ELSE 'active' END
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 4. GET CLIENT SESSION BALANCE
-- ============================================

-- Function to get client's total session balance across all packages
CREATE OR REPLACE FUNCTION get_client_session_balance(p_client_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_total_remaining integer;
  v_packages jsonb;
BEGIN
  -- Get total sessions remaining
  SELECT COALESCE(SUM(sessions_remaining), 0) INTO v_total_remaining
  FROM client_packages
  WHERE client_id = p_client_id
    AND status = 'active'
    AND (expires_at IS NULL OR expires_at > CURRENT_DATE);
  
  -- Get package breakdown
  SELECT jsonb_agg(
    jsonb_build_object(
      'package_name', p.name,
      'sessions_remaining', cp.sessions_remaining,
      'purchased_at', cp.purchased_at,
      'expires_at', cp.expires_at
    )
  ) INTO v_packages
  FROM client_packages cp
  JOIN packages p ON cp.package_id = p.id
  WHERE cp.client_id = p_client_id
    AND cp.status = 'active'
    AND (cp.expires_at IS NULL OR cp.expires_at > CURRENT_DATE);
  
  RETURN jsonb_build_object(
    'total_sessions_remaining', v_total_remaining,
    'active_packages', COALESCE(v_packages, '[]'::jsonb)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 5. EXPIRE OLD PACKAGES (Run via cron)
-- ============================================

-- Function to mark expired packages
CREATE OR REPLACE FUNCTION expire_old_packages()
RETURNS integer AS $$
DECLARE
  v_expired_count integer;
BEGIN
  UPDATE client_packages
  SET status = 'expired'
  WHERE status = 'active'
    AND expires_at IS NOT NULL
    AND expires_at < CURRENT_DATE;
  
  GET DIAGNOSTICS v_expired_count = ROW_COUNT;
  
  RETURN v_expired_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- USAGE EXAMPLES
-- ============================================

-- Example 1: Client purchases Gold Pack
/*
SELECT purchase_package(
  p_client_id := 'client-uuid-here',
  p_package_id := 'gold-package-uuid',
  p_payment_method := 'stripe',
  p_amount_paid := 1500.00,
  p_stripe_payment_intent_id := 'pi_abc123'
);
*/

-- Example 2: Coach logs a session
/*
SELECT log_session(
  p_client_package_id := 'client-package-uuid',
  p_coach_id := 'coach-uuid',
  p_session_date := NOW(),
  p_duration_minutes := 60,
  p_notes := 'Great session, worked on squat form'
);
*/

-- Example 3: Get client's session balance
/*
SELECT get_client_session_balance('client-uuid-here');

-- Returns:
{
  "total_sessions_remaining": 25,
  "active_packages": [
    {
      "package_name": "Gold Pack",
      "sessions_remaining": 15,
      "purchased_at": "2026-01-15T10:30:00Z",
      "expires_at": "2026-07-15"
    },
    {
      "package_name": "Silver Pack",
      "sessions_remaining": 10,
      "purchased_at": "2026-02-01T14:00:00Z",
      "expires_at": "2026-08-01"
    }
  ]
}
*/

-- Example 4: Query coach's package offerings
/*
SELECT 
  id,
  name,
  description,
  sessions_included,
  price_sgd,
  is_active
FROM packages
WHERE coach_id = 'coach-uuid'
  AND is_active = true
ORDER BY price_sgd ASC;
*/

-- Example 5: Get client's purchase history
/*
SELECT 
  p.name as package_name,
  cp.sessions_remaining,
  pk.sessions_included,
  pk.sessions_included - cp.sessions_remaining as sessions_used,
  cp.purchased_at,
  cp.expires_at,
  cp.status,
  pay.amount_sgd,
  pay.payment_method
FROM client_packages cp
JOIN packages pk ON cp.package_id = pk.id
LEFT JOIN payments pay ON pay.client_package_id = cp.id
WHERE cp.client_id = 'client-uuid'
ORDER BY cp.purchased_at DESC;
*/
