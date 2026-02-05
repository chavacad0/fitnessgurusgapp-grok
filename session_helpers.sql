-- ============================================
-- Session Management Helper Functions
-- (Updated for simplified sessions structure)
-- ============================================

-- ============================================
-- 1. LOG SESSION WITH AUTO-DECREMENT
-- ============================================

-- Function to log a session and optionally decrement balance
CREATE OR REPLACE FUNCTION log_session(
  p_client_id uuid,
  p_coach_id uuid,
  p_date date,
  p_status text DEFAULT 'Completed',
  p_deducts boolean DEFAULT true,
  p_notes text DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_session_id uuid;
  v_sessions_remaining integer;
  v_new_balance integer;
BEGIN
  -- Get current session balance
  SELECT sessions_remaining INTO v_sessions_remaining
  FROM clients
  WHERE id = p_client_id;
  
  -- Check if client has sessions if this session deducts
  IF p_deducts AND (v_sessions_remaining IS NULL OR v_sessions_remaining <= 0) THEN
    RAISE EXCEPTION 'Client has no sessions remaining';
  END IF;
  
  -- Create session record
  INSERT INTO sessions (
    client_id,
    coach_id,
    date,
    status,
    deducts,
    notes
  )
  VALUES (
    p_client_id,
    p_coach_id,
    p_date,
    p_status,
    p_deducts,
    p_notes
  )
  RETURNING id INTO v_session_id;
  
  -- Decrement balance if this session should count
  IF p_deducts THEN
    UPDATE clients
    SET sessions_remaining = sessions_remaining - 1
    WHERE id = p_client_id
    RETURNING sessions_remaining INTO v_new_balance;
  ELSE
    v_new_balance := v_sessions_remaining;
  END IF;
  
  RETURN jsonb_build_object(
    'session_id', v_session_id,
    'status', p_status,
    'deducted', p_deducts,
    'sessions_remaining', v_new_balance
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 2. UPDATE SESSION STATUS
-- ============================================

-- Function to mark session as no-show or cancelled
CREATE OR REPLACE FUNCTION update_session_status(
  p_session_id uuid,
  p_new_status text,
  p_refund_session boolean DEFAULT false
)
RETURNS jsonb AS $$
DECLARE
  v_old_status text;
  v_was_deducted boolean;
  v_client_id uuid;
  v_new_balance integer;
BEGIN
  -- Get session details
  SELECT status, deducts, client_id 
  INTO v_old_status, v_was_deducted, v_client_id
  FROM sessions
  WHERE id = p_session_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found';
  END IF;
  
  -- Update session status
  UPDATE sessions
  SET status = p_new_status
  WHERE id = p_session_id;
  
  -- If refunding a session that was deducted, add it back
  IF p_refund_session AND v_was_deducted THEN
    UPDATE clients
    SET sessions_remaining = sessions_remaining + 1
    WHERE id = v_client_id
    RETURNING sessions_remaining INTO v_new_balance;
  ELSE
    SELECT sessions_remaining INTO v_new_balance
    FROM clients WHERE id = v_client_id;
  END IF;
  
  RETURN jsonb_build_object(
    'session_id', p_session_id,
    'old_status', v_old_status,
    'new_status', p_new_status,
    'refunded', p_refund_session,
    'sessions_remaining', v_new_balance
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 3. GET CLIENT SESSION HISTORY
-- ============================================

CREATE OR REPLACE FUNCTION get_client_session_history(
  p_client_id uuid,
  p_limit integer DEFAULT 30
)
RETURNS TABLE (
  session_id uuid,
  date date,
  status text,
  deducted boolean,
  coach_name text,
  notes text
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id,
    s.date,
    s.status,
    s.deducts,
    c.name as coach_name,
    s.notes
  FROM sessions s
  LEFT JOIN coaches co ON s.coach_id = co.id
  LEFT JOIN clients c ON co.id = c.id
  WHERE s.client_id = p_client_id
  ORDER BY s.date DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 4. CLIENT PURCHASES PACKAGE (Simplified)
-- ============================================

-- Function to handle package purchase - updates client record directly
CREATE OR REPLACE FUNCTION purchase_package(
  p_client_id uuid,
  p_package_id uuid,
  p_payment_method text,
  p_amount_paid numeric,
  p_stripe_payment_intent_id text DEFAULT NULL,
  p_paid_until_months integer DEFAULT 6
)
RETURNS jsonb AS $$
DECLARE
  v_sessions_included integer;
  v_payment_id uuid;
  v_paid_until date;
BEGIN
  -- Get package details
  SELECT sessions_included INTO v_sessions_included
  FROM packages
  WHERE id = p_package_id AND is_active = true;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Package not found or inactive';
  END IF;
  
  -- Calculate paid_until date
  v_paid_until := CURRENT_DATE + (p_paid_until_months || ' months')::interval;
  
  -- Update client record with package
  UPDATE clients
  SET 
    current_package_id = p_package_id,
    sessions_remaining = COALESCE(sessions_remaining, 0) + v_sessions_included,
    subscription_status = 'Active',
    paid_until = v_paid_until
  WHERE id = p_client_id;
  
  -- Record payment
  INSERT INTO payments (
    client_id,
    amount_sgd,
    payment_method,
    stripe_payment_intent_id,
    status,
    paid_at
  )
  VALUES (
    p_client_id,
    p_amount_paid,
    p_payment_method,
    p_stripe_payment_intent_id,
    'completed',
    NOW()
  )
  RETURNING id INTO v_payment_id;
  
  RETURN jsonb_build_object(
    'payment_id', v_payment_id,
    'sessions_added', v_sessions_included,
    'total_sessions_remaining', (SELECT sessions_remaining FROM clients WHERE id = p_client_id),
    'paid_until', v_paid_until,
    'subscription_status', 'Active'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 5. GET CLIENT SESSION STATS
-- ============================================

CREATE OR REPLACE FUNCTION get_client_session_stats(p_client_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_stats jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_sessions', COUNT(*),
    'completed', COUNT(*) FILTER (WHERE status = 'Completed'),
    'no_shows', COUNT(*) FILTER (WHERE status = 'No-show'),
    'cancelled', COUNT(*) FILTER (WHERE status = 'Cancelled'),
    'sessions_deducted', COUNT(*) FILTER (WHERE deducts = true),
    'sessions_remaining', (SELECT sessions_remaining FROM clients WHERE id = p_client_id),
    'current_package', (
      SELECT jsonb_build_object(
        'name', p.name,
        'sessions_included', p.sessions_included
      )
      FROM clients c
      JOIN packages p ON c.current_package_id = p.id
      WHERE c.id = p_client_id
    )
  ) INTO v_stats
  FROM sessions
  WHERE client_id = p_client_id;
  
  RETURN v_stats;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- USAGE EXAMPLES
-- ============================================

-- Example 1: Client purchases Gold package
/*
SELECT purchase_package(
  p_client_id := 'client-uuid',
  p_package_id := 'gold-package-uuid',
  p_payment_method := 'stripe',
  p_amount_paid := 1500.00,
  p_stripe_payment_intent_id := 'pi_abc123',
  p_paid_until_months := 6
);

-- Returns:
{
  "payment_id": "...",
  "sessions_added": 20,
  "total_sessions_remaining": 20,
  "paid_until": "2026-08-04",
  "subscription_status": "Active"
}
*/

-- Example 2: Log a completed session (deducts)
/*
SELECT log_session(
  p_client_id := 'client-uuid',
  p_coach_id := 'coach-uuid',
  p_date := CURRENT_DATE,
  p_status := 'Completed',
  p_deducts := true,
  p_notes := 'Great session on squats'
);

-- Returns:
{
  "session_id": "...",
  "status": "Completed",
  "deducted": true,
  "sessions_remaining": 19
}
*/

-- Example 3: Log a trial session (doesn't deduct)
/*
SELECT log_session(
  p_client_id := 'client-uuid',
  p_coach_id := 'coach-uuid',
  p_date := CURRENT_DATE,
  p_status := 'Completed',
  p_deducts := false,
  p_notes := 'Free trial session'
);
*/

-- Example 4: Mark session as no-show (with refund)
/*
SELECT update_session_status(
  p_session_id := 'session-uuid',
  p_new_status := 'No-show',
  p_refund_session := false  -- Don't refund no-shows
);
*/

-- Example 5: Cancel session and refund
/*
SELECT update_session_status(
  p_session_id := 'session-uuid',
  p_new_status := 'Cancelled',
  p_refund_session := true  -- Add session back to balance
);
*/

-- Example 6: Get client session history
/*
SELECT * FROM get_client_session_history('client-uuid', 10);
*/

-- Example 7: Get session stats
/*
SELECT get_client_session_stats('client-uuid');

-- Returns:
{
  "total_sessions": 15,
  "completed": 12,
  "no_shows": 2,
  "cancelled": 1,
  "sessions_deducted": 12,
  "sessions_remaining": 8,
  "current_package": {
    "name": "Gold",
    "sessions_included": 20
  }
}
*/
