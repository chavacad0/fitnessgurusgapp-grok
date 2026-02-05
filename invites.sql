-- ============================================
-- Client Invitations System (Simplified)
-- ============================================

create table invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  coach_id uuid references coaches(id) on delete cascade,
  expires_at timestamp with time zone,
  accepted boolean default false,
  created_at timestamp with time zone default now()
);

create index idx_invitations_email on invitations(email);
create index idx_invitations_coach on invitations(coach_id);

-- Enable RLS
alter table invitations enable row level security;

-- RLS Policies: Coaches can manage their own invitations
create policy "Coaches can manage own invitations"
  on invitations for all
  using (auth.uid() = coach_id)
  with check (auth.uid() = coach_id);

-- ============================================
-- Helper Functions
-- ============================================

-- Function to create invitation
CREATE OR REPLACE FUNCTION create_invitation(
  p_coach_id uuid,
  p_email text,
  p_expires_days integer DEFAULT 7
)
RETURNS uuid AS $$
DECLARE
  v_invitation_id uuid;
  v_expires_at timestamp with time zone;
BEGIN
  -- Check if email already has pending invitation
  IF EXISTS (
    SELECT 1 FROM invitations 
    WHERE email = p_email 
      AND accepted = false 
      AND (expires_at IS NULL OR expires_at > NOW())
  ) THEN
    RAISE EXCEPTION 'Email already has a pending invitation';
  END IF;
  
  -- Check if email already registered as client
  IF EXISTS (SELECT 1 FROM clients WHERE email = p_email) THEN
    RAISE EXCEPTION 'Email already registered as a client';
  END IF;
  
  -- Set expiration
  v_expires_at := NOW() + (p_expires_days || ' days')::interval;
  
  -- Create invitation
  INSERT INTO invitations (coach_id, email, expires_at)
  VALUES (p_coach_id, p_email, v_expires_at)
  RETURNING id INTO v_invitation_id;
  
  RETURN v_invitation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to validate and accept invitation
CREATE OR REPLACE FUNCTION accept_invitation(
  p_invitation_id uuid,
  p_user_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_coach_id uuid;
  v_email text;
  v_expires_at timestamp with time zone;
  v_accepted boolean;
BEGIN
  -- Get invitation details
  SELECT coach_id, email, expires_at, accepted
  INTO v_coach_id, v_email, v_expires_at, v_accepted
  FROM invitations
  WHERE id = p_invitation_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found';
  END IF;
  
  IF v_accepted THEN
    RAISE EXCEPTION 'Invitation already accepted';
  END IF;
  
  IF v_expires_at IS NOT NULL AND v_expires_at < NOW() THEN
    RAISE EXCEPTION 'Invitation expired';
  END IF;
  
  -- Mark invitation as accepted
  UPDATE invitations
  SET accepted = true
  WHERE id = p_invitation_id;
  
  RETURN jsonb_build_object(
    'coach_id', v_coach_id,
    'email', v_email,
    'user_id', p_user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get pending invitations for coach
CREATE OR REPLACE FUNCTION get_pending_invitations(p_coach_id uuid)
RETURNS TABLE (
  invitation_id uuid,
  email text,
  created_at timestamp with time zone,
  expires_at timestamp with time zone,
  is_expired boolean
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    id,
    invitations.email,
    invitations.created_at,
    invitations.expires_at,
    (expires_at IS NOT NULL AND expires_at < NOW()) as is_expired
  FROM invitations
  WHERE invitations.coach_id = p_coach_id
    AND accepted = false
  ORDER BY invitations.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Usage Examples
-- ============================================

/*
-- 1. Coach creates an invitation
SELECT create_invitation(
  p_coach_id := 'coach-uuid',
  p_email := 'newclient@example.com',
  p_expires_days := 7
);

-- 2. Client accepts invitation during signup
SELECT accept_invitation(
  p_invitation_id := 'invitation-uuid',
  p_user_id := auth.uid()
);

-- 3. Get coach's pending invitations
SELECT * FROM get_pending_invitations('coach-uuid');

-- 4. Manually mark invitation as expired/invalid
UPDATE invitations 
SET expires_at = NOW() - INTERVAL '1 day'
WHERE id = 'invitation-uuid';
*/
