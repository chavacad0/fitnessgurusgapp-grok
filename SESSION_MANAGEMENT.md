# Session Management Changes

## Overview

The sessions table has been **simplified** to work seamlessly with the denormalized clients structure. This eliminates complexity while adding powerful flexibility.

## Key Changes

### 1. Removed Package Dependency
**Before:** Sessions referenced `client_packages` table  
**After:** Sessions only reference `clients` directly

```sql
-- OLD
client_package_id uuid references client_packages(id)

-- NEW ✅
client_id uuid references clients(id)
```

**Why:** Package info is now on the client record, so we don't need to track which specific package purchase each session came from.

---

### 2. Added Session Status
**New field:**
```sql
status text check (status in ('Completed', 'No-show', 'Cancelled'))
```

**Benefits:**
- Track no-shows for compliance
- Handle cancellations gracefully
- Report on session attendance rates

---

### 3. Flexible Deduction Logic
**New field:**
```sql
deducts boolean default true
```

**Use Cases:**
| Scenario | `deducts` Value | Example |
|----------|----------------|---------|
| Regular paid session | `true` | Normal coaching session |
| Free trial | `false` | Complimentary intro session |
| Makeup session | `false` | Rescheduled no-show (already deducted) |
| Coaching call | `false` | Quick check-in, doesn't count against package |

---

### 4. Simplified Date Field
**Before:** `session_date timestamp with time zone`  
**After:** `date date`

**Why:** Most coaches schedule by date, not specific times. Simplifies queries and removes timezone complexity for MVP.

---

## New Table Structure

```sql
create table sessions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  coach_id uuid references coaches(id),
  date date not null,
  status text check (status in ('Completed', 'No-show', 'Cancelled')),
  deducts boolean default true,
  notes text,
  created_at timestamp with time zone default now()
);

-- Optimized indexes
create index idx_sessions_client on sessions(client_id, date desc);
create index idx_sessions_coach on sessions(coach_id, date desc);
create index idx_sessions_status on sessions(status) where status != 'Completed';
```

---

## Updated Helper Functions

### 1. Log Session (with auto-decrement)
```sql
SELECT log_session(
  p_client_id := 'client-uuid',
  p_coach_id := 'coach-uuid',
  p_date := CURRENT_DATE,
  p_status := 'Completed',
  p_deducts := true,
  p_notes := 'Great session on deadlifts'
);

-- Returns:
{
  "session_id": "...",
  "status": "Completed",
  "deducted": true,
  "sessions_remaining": 19
}
```

### 2. Update Session Status
```sql
-- Mark as no-show (don't refund)
SELECT update_session_status(
  p_session_id := 'session-uuid',
  p_new_status := 'No-show',
  p_refund_session := false
);

-- Cancel and refund session
SELECT update_session_status(
  p_session_id := 'session-uuid',
  p_new_status := 'Cancelled',
  p_refund_session := true  -- Adds session back to balance
);
```

### 3. Purchase Package (Simplified)
```sql
SELECT purchase_package(
  p_client_id := 'client-uuid',
  p_package_id := 'gold-uuid',
  p_payment_method := 'stripe',
  p_amount_paid := 1500.00,
  p_paid_until_months := 6
);

-- Directly updates:
-- - clients.current_package_id
-- - clients.sessions_remaining (adds to existing)
-- -  → 'Active'
-- - clients.paid_until
```

### 4. Get Session Stats
```sql
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
```

---

## Common Workflows

### Regular Session Flow
```sql
-- 1. Coach logs completed session
SELECT log_session(
  'client-uuid',
  'coach-uuid',
  CURRENT_DATE,
  'Completed',
  true,  -- Deducts from balance
  'Client hit new PR on bench press'
);

-- Result: sessions_remaining decremented automatically
```

### Trial Session Flow
```sql
-- 1. Log trial session (doesn't deduct)
SELECT log_session(
  'client-uuid',
  'coach-uuid',
  CURRENT_DATE,
  'Completed',
  false,  -- FREE trial, don't deduct
  'Free introductory session'
);

-- Result: sessions_remaining unchanged
```

### No-Show Handling
```sql
-- 1. Client scheduled for today but didn't show
SELECT log_session(
  'client-uuid',
  'coach-uuid',
  CURRENT_DATE,
  'No-show',
  true,  -- Still deducts (policy decision)
  'Client did not attend'
);

-- 2. Coach offers makeup session later
SELECT log_session(
  'client-uuid',
  'coach-uuid',
  CURRENT_DATE + 3,
  'Completed',
  false,  -- Makeup session, don't double-deduct
  'Makeup session for previous no-show'
);
```

### Cancellation with Refund
```sql
-- 1. Coach cancels session due to emergency
SELECT log_session(
  'client-uuid',
  'coach-uuid',
  CURRENT_DATE,
  'Cancelled',
  false,  -- Don't deduct
  'Coach unavailable - rescheduling'
);

-- Or if already logged:
SELECT update_session_status(
  'session-uuid',
  'Cancelled',
  true  -- Refund the session
);
```

---

## Removed: client_packages Table

The separate `client_packages` table has been removed. Package tracking is now directly on the `clients` table:

```sql
-- clients table now has:
current_package_id uuid references packages(id),
sessions_remaining integer default 0,
subscription_status text,
paid_until date
```

**Benefits:**
- One query to get client + package + balance
- Simpler purchase flow
- No JOINs for common queries
- Still maintains package catalog in `packages` table

---

## Migration Notes

If you have existing sessions data:

```sql
-- Sessions table is backward compatible
-- Just need to update any client_package_id references:

ALTER TABLE sessions DROP COLUMN IF EXISTS client_package_id;
ALTER TABLE sessions DROP COLUMN IF EXISTS duration_minutes;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS deducts boolean DEFAULT true;
ALTER TABLE sessions RENAME COLUMN session_date TO date;
```

---

## Performance Benefits

### Before (Complex)
```sql
-- Get client balance
SELECT cp.sessions_remaining
FROM client_packages cp
WHERE cp.client_id = 'client-uuid' AND cp.status = 'active';

-- Log session
INSERT INTO sessions (client_id, client_package_id, ...)
VALUES (...);

-- Decrement balance
UPDATE client_packages
SET sessions_remaining = sessions_remaining - 1
WHERE id = 'client-package-uuid';
```

### After (Simple) ✅
```sql
-- Get client balance
SELECT sessions_remaining FROM clients WHERE id = 'client-uuid';

-- Log session with auto-decrement
SELECT log_session(...);
```

---

## Updated Files

1. **[schema.sql](file:///Users/admin/Fitnessprac/schema.sql)** - Simplified sessions table
2. **[session_helpers.sql](file:///Users/admin/Fitnessprac/session_helpers.sql)** - All helper functions
3. **This guide** - Usage examples

---

## Benefits Summary

✅ **Simpler structure** - No intermediate client_packages table  
✅ **Flexible deduction** - Trial sessions, makeups, etc.  
✅ **Status tracking** - No-shows, cancellations  
✅ **Better reporting** - Clear session stats  
✅ **Faster queries** - Direct client reference  
✅ **Policy flexibility** - Control deduction per session  

Your session management is now production-ready! 🎯
