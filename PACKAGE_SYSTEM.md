# Package System Changes

## What Changed?

The package system has been refactored to separate **package catalog** (templates) from **client purchases** (instances). This gives you more flexibility to offer different tiers.

### Old Structure ❌
- `packages` table contained client-specific purchases
- Had to create a new package record for each client
- No reusable package templates

### New Structure ✅
```
packages (catalog)
  ├── Silver Pack (10 sessions, $800)
  ├── Gold Pack (20 sessions, $1500)
  └── Platinum Pack (30 sessions, $2100)

client_packages (purchases)
  ├── Client A → Gold Pack (15 sessions remaining)
  ├── Client B → Silver Pack (8 sessions remaining)
  └── Client C → Platinum Pack (30 sessions remaining)
```

---

## New Tables

### `packages` - Package Catalog
Coach-created templates that can be offered to multiple clients.

| Field | Type | Description |
|-------|------|-------------|
| `id` | uuid | Primary key |
| `coach_id` | uuid | Coach who created this package |
| `name` | text | "Silver", "Gold", "Platinum" |
| `description` | text | Optional description |
| `sessions_included` | integer | Number of sessions in package |
| `price_sgd` | numeric | Price in SGD |
| `currency` | text | Default: 'SGD' |
| `is_active` | boolean | Can be offered to clients |

**Example:**
```sql
INSERT INTO packages (coach_id, name, sessions_included, price_sgd)
VALUES 
  ('coach-uuid', 'Silver', 10, 800),
  ('coach-uuid', 'Gold', 20, 1500);
```

---

### `client_packages` - Client Purchases
Individual package purchases by clients (instances).

| Field | Type | Description |
|-------|------|-------------|
| `id` | uuid | Primary key |
| `client_id` | uuid | Client who purchased |
| `package_id` | uuid | Which package template |
| `sessions_remaining` | integer | **Decrements as sessions used** |
| `purchased_at` | timestamp | When purchased |
| `expires_at` | date | Optional expiry |
| `status` | text | 'active', 'expired', 'completed' |

**Example:**
```sql
-- Client purchases Gold Pack (20 sessions)
INSERT INTO client_packages (client_id, package_id, sessions_remaining)
VALUES ('client-uuid', 'gold-package-uuid', 20);
```

---

## Helper Functions

### 1. Purchase Package
```sql
SELECT purchase_package(
  p_client_id := 'client-uuid',
  p_package_id := 'gold-package-uuid',
  p_payment_method := 'stripe',
  p_amount_paid := 1500.00,
  p_stripe_payment_intent_id := 'pi_abc123'
);

-- Returns:
{
  "client_package_id": "...",
  "payment_id": "...",
  "sessions_remaining": 20,
  "expires_at": "2026-08-04"
}
```

### 2. Log Session (Auto-decrement balance)
```sql
SELECT log_session(
  p_client_package_id := 'client-package-uuid',
  p_coach_id := 'coach-uuid',
  p_session_date := NOW(),
  p_duration_minutes := 60,
  p_notes := 'Worked on squat form'
);

-- Returns:
{
  "session_id": "...",
  "sessions_remaining": 19,
  "package_status": "active"
}
```

### 3. Get Client Balance
```sql
SELECT get_client_session_balance('client-uuid');

-- Returns:
{
  "total_sessions_remaining": 25,
  "active_packages": [
    {
      "package_name": "Gold Pack",
      "sessions_remaining": 15,
      "expires_at": "2026-07-15"
    }
  ]
}
```

---

## Migration from Old Schema

If you already have data in the old `packages` table:

```sql
-- 1. Rename old packages table
ALTER TABLE packages RENAME TO old_packages;

-- 2. Run new schema.sql to create new tables

-- 3. Migrate data
-- Create default package templates
INSERT INTO packages (coach_id, name, sessions_included, price_sgd, is_active)
SELECT DISTINCT
  c.coach_id,
  'Legacy Package',
  op.total_sessions,
  op.price_sgd,
  true
FROM old_packages op
JOIN clients c ON op.client_id = c.id;

-- Create client_packages from old purchases
INSERT INTO client_packages (client_id, package_id, sessions_remaining, purchased_at, expires_at, status)
SELECT 
  op.client_id,
  (SELECT id FROM packages WHERE coach_id = c.coach_id LIMIT 1),
  op.total_sessions - op.used_sessions,
  op.purchased_at,
  op.expires_at,
  op.status
FROM old_packages op
JOIN clients c ON op.client_id = c.id;

-- 4. Drop old table (after verification)
-- DROP TABLE old_packages;
```

---

## API Usage Examples

### Coach Creates Package Offerings
```javascript
// Create 3 package tiers
const packages = [
  { name: 'Silver', sessions: 10, price: 800 },
  { name: 'Gold', sessions: 20, price: 1500 },
  { name: 'Platinum', sessions: 30, price: 2100 }
];

for (const pkg of packages) {
  await supabase.from('packages').insert({
    coach_id: coachId,
    name: pkg.name,
    description: `${pkg.sessions} sessions`,
    sessions_included: pkg.sessions,
    price_sgd: pkg.price
  });
}
```

### Client Views Available Packages
```javascript
// Get packages offered by client's coach
const { data: packages } = await supabase
  .from('packages')
  .select('*')
  .eq('coach_id', clientCoachId)
  .eq('is_active', true)
  .order('price_sgd', { ascending: true });

// Returns: [Silver, Gold, Platinum]
```

### Client Purchases Package
```javascript
const { data, error } = await supabase
  .rpc('purchase_package', {
    p_client_id: clientId,
    p_package_id: goldPackageId,
    p_payment_method: 'stripe',
    p_amount_paid: 1500.00,
    p_stripe_payment_intent_id: 'pi_abc123'
  });
```

### Coach Logs Session
```javascript
const { data } = await supabase
  .rpc('log_session', {
    p_client_package_id: clientPackageId,
    p_coach_id: coachId,
    p_session_date: new Date().toISOString(),
    p_duration_minutes: 60,
    p_notes: 'Great progress on deadlifts'
  });

console.log(`Sessions remaining: ${data.sessions_remaining}`);
```

### Client Views Session Balance
```javascript
const { data: balance } = await supabase
  .rpc('get_client_session_balance', {
    p_client_id: clientId
  });

console.log(`Total: ${balance.total_sessions_remaining}`);
// Shows combined balance across all active packages
```

---

## Benefits

✅ **Reusable package templates** - Create once, sell many times  
✅ **Flexible pricing** - Easily update package prices without affecting existing purchases  
✅ **Better analytics** - Track which packages are most popular  
✅ **Multi-package support** - Clients can have multiple active packages  
✅ **Clear separation** - Catalog vs purchases clearly separated  

---

## Files to Review

1. **[schema.sql](file:///Users/admin/Fitnessprac/schema.sql)** - Updated package tables
2. **[package_helpers.sql](file:///Users/admin/Fitnessprac/package_helpers.sql)** - Helper functions
3. **This file** - Migration guide and examples

---

## Next Steps

1. Run updated `schema.sql` in Supabase
2. Run `package_helpers.sql` to add helper functions
3. Create your package offerings in the coach dashboard
4. Update mobile app to show package catalog
