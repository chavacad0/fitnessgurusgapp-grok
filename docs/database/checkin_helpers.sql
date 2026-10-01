-- ============================================
-- Check-In Helper Functions
-- (Updated for simplified structure)
-- ============================================

-- ============================================
-- AUTO-FLAG CHECK-INS BASED ON RULES
-- ============================================

-- Function to automatically flag check-ins based on red flag criteria
CREATE OR REPLACE FUNCTION auto_flag_checkin()
RETURNS TRIGGER AS $$
BEGIN
  -- Auto-flag if:
  -- 1. Hunger > 7 (high hunger)
  -- 2. Energy < 4 (low energy)
  IF (NEW.hunger > 7 OR NEW.energy < 4) THEN
    NEW.flagged := true;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to run auto-flag on insert/update
DROP TRIGGER IF EXISTS trigger_auto_flag_checkin ON check_ins;
CREATE TRIGGER trigger_auto_flag_checkin
  BEFORE INSERT OR UPDATE ON check_ins
  FOR EACH ROW
  EXECUTE FUNCTION auto_flag_checkin();

-- ============================================
-- DETECT MISSING CHECK-INS
-- ============================================

-- Function to find clients with missing check-ins
CREATE OR REPLACE FUNCTION get_missing_checkins(
  p_coach_id uuid,
  p_days_threshold integer DEFAULT 2
)
RETURNS TABLE (
  client_id uuid,
  client_name text,
  last_checkin_date date,
  days_since_checkin integer
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id,
    c.name,
    MAX(ci.date) as last_checkin_date,
    (CURRENT_DATE - MAX(ci.date))::integer as days_since_checkin
  FROM clients c
  LEFT JOIN check_ins ci ON c.id = ci.client_id
  WHERE c.coach_id = p_coach_id
    AND c.subscription_status = 'Active'
  GROUP BY c.id, c.name
  HAVING 
    MAX(ci.date) IS NULL 
    OR (CURRENT_DATE - MAX(ci.date)) >= p_days_threshold
  ORDER BY days_since_checkin DESC NULLS FIRST;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- GET FLAGGED CHECK-INS FOR COACH
-- ============================================

CREATE OR REPLACE FUNCTION get_flagged_checkins(
  p_coach_id uuid,
  p_days_back integer DEFAULT 7
)
RETURNS TABLE (
  checkin_id uuid,
  client_id uuid,
  client_name text,
  date date,
  steps integer,
  hunger integer,
  energy integer,
  notes text,
  reviewed boolean
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ci.id,
    ci.client_id,
    c.name,
    ci.date,
    ci.steps,
    ci.hunger,
    ci.energy,
    ci.notes,
    ci.reviewed
  FROM check_ins ci
  JOIN clients c ON ci.client_id = c.id
  WHERE c.coach_id = p_coach_id
    AND ci.flagged = true
    AND ci.date >= CURRENT_DATE - p_days_back
  ORDER BY ci.date DESC, ci.reviewed ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- GET UNREVIEWED CHECK-INS
-- ============================================

CREATE OR REPLACE FUNCTION get_unreviewed_checkins(
  p_coach_id uuid,
  p_days_back integer DEFAULT 7
)
RETURNS TABLE (
  checkin_id uuid,
  client_id uuid,
  client_name text,
  date date,
  steps integer,
  hunger integer,
  energy integer,
  weight numeric,
  flagged boolean,
  created_at timestamp with time zone
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ci.id,
    ci.client_id,
    c.name,
    ci.date,
    ci.steps,
    ci.hunger,
    ci.energy,
    ci.weight,
    ci.flagged,
    ci.created_at
  FROM check_ins ci
  JOIN clients c ON ci.client_id = c.id
  WHERE c.coach_id = p_coach_id
    AND ci.reviewed = false
    AND ci.date >= CURRENT_DATE - p_days_back
  ORDER BY 
    ci.flagged DESC,  -- Flagged items first
    ci.date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- MARK CHECK-IN AS REVIEWED
-- ============================================

CREATE OR REPLACE FUNCTION mark_checkin_reviewed(
  p_checkin_id uuid
)
RETURNS void AS $$
BEGIN
  UPDATE check_ins
  SET reviewed = true
  WHERE id = p_checkin_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- GET CLIENT CHECK-IN STATS
-- ============================================

CREATE OR REPLACE FUNCTION get_client_checkin_stats(
  p_client_id uuid,
  p_days_back integer DEFAULT 30
)
RETURNS jsonb AS $$
DECLARE
  v_stats jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_checkins', COUNT(*),
    'checkin_rate', ROUND((COUNT(*)::numeric / p_days_back) * 100, 1),
    'avg_steps', ROUND(AVG(steps)),
    'avg_hunger', ROUND(AVG(hunger), 1),
    'avg_energy', ROUND(AVG(energy), 1),
    'current_weight', (
      SELECT weight 
      FROM check_ins 
      WHERE client_id = p_client_id AND weight IS NOT NULL 
      ORDER BY date DESC 
      LIMIT 1
    ),
    'weight_change', (
      (SELECT weight FROM check_ins WHERE client_id = p_client_id AND weight IS NOT NULL ORDER BY date DESC LIMIT 1) -
      (SELECT weight FROM check_ins WHERE client_id = p_client_id AND weight IS NOT NULL ORDER BY date ASC LIMIT 1)
    ),
    'flagged_count', COUNT(*) FILTER (WHERE flagged = true),
    'streak_days', (
      SELECT COUNT(*)
      FROM generate_series(
        CURRENT_DATE - INTERVAL '1 day' * p_days_back,
        CURRENT_DATE,
        '1 day'::interval
      ) d
      WHERE EXISTS (
        SELECT 1 FROM check_ins 
        WHERE client_id = p_client_id 
          AND date = d::date
      )
    )
  ) INTO v_stats
  FROM check_ins
  WHERE client_id = p_client_id
    AND date >= CURRENT_DATE - p_days_back;
  
  RETURN v_stats;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- USAGE EXAMPLES
-- ============================================

-- Example 1: Get coach's flagged check-ins
/*
SELECT * FROM get_flagged_checkins('coach-uuid', 7);
*/

-- Example 2: Get unreviewed check-ins (sorted by flagged first)
/*
SELECT * FROM get_unreviewed_checkins('coach-uuid', 7);
*/

-- Example 3: Find clients with missing check-ins
/*
SELECT * FROM get_missing_checkins('coach-uuid', 2);

-- Returns clients who haven't checked in for 2+ days
*/

-- Example 4: Mark check-in as reviewed
/*
SELECT mark_checkin_reviewed('checkin-uuid');
*/

-- Example 5: Get client check-in statistics
/*
SELECT get_client_checkin_stats('client-uuid', 30);

-- Returns:
{
  "total_checkins": 25,
  "checkin_rate": 83.3,
  "avg_steps": 10500,
  "avg_hunger": 5.2,
  "avg_energy": 7.1,
  "current_weight": 72.5,
  "weight_change": -2.3,
  "flagged_count": 3,
  "streak_days": 12
}
*/

-- Example 6: Manually flag a check-in
/*
UPDATE check_ins 
SET flagged = true 
WHERE id = 'checkin-uuid';
*/

-- Example 7: Get check-ins for specific date range
/*
SELECT 
  date,
  steps,
  hunger,
  energy,
  weight,
  flagged,
  reviewed
FROM check_ins
WHERE client_id = 'client-uuid'
  AND date BETWEEN '2026-01-01' AND '2026-01-31'
ORDER BY date DESC;
*/
