# Supabase Setup Guide

## Prerequisites
1. Create a Supabase project at [supabase.com](https://supabase.com)
2. Note your project URL and anon key

## Database Setup

### 1. Run Core Schema
In Supabase SQL Editor, run the files in this order:

```bash
# 1. Core database schema (tables, indexes, RLS, functions)
schema.sql

# 2. Client invite system
invites.sql

# 3. Storage buckets and policies
storage.sql
```

### 2. Configure Authentication

In Supabase Dashboard → Authentication → Settings:

**Email Settings:**
- ✅ Enable email confirmations (optional for MVP)
- ✅ Enable email autoconfirm for testing

**Password Requirements:**
- Minimum length: 8 characters
- Require uppercase: Yes
- Require numbers: Yes

**JWT Expiry:**
- JWT expiry: 604800 (7 days)

### 3. Set Up User Metadata

When creating users via signup, include metadata:

```javascript
const { user, error } = await supabase.auth.signUp({
  email: 'client@example.com',
  password: 'SecurePass123!',
  options: {
    data: {
      name: 'Sarah Lee',
      role: 'client',
      invite_code: 'ABC12345' // For client signup
    }
  }
});
```

### 4. Create Coach Profile After Signup

```javascript
// After coach signs up, create coach record
const { data: coach, error } = await supabase
  .from('coaches')
  .insert({
    id: user.id, // Same as auth.users.id
    whatsapp_number: '+6591234567',
    business_name: 'Peak Performance SG'
  });
```

### 5. Create Client Profile After Signup

```javascript
// After client signs up, create client record
const { data: client, error } = await supabase
  .from('clients')
  .insert({
    user_id: user.id,
    coach_id: coachId, // Get from invite
    status: 'active',
    start_date: new Date().toISOString().split('T')[0],
    consent_whatsapp: true,
    consent_data_processing: true
  });
```

## File Upload Example

### Upload Meal Photo

```javascript
import { supabase } from './supabase-client';

async function uploadMealPhoto(userId, file) {
  const fileName = `${Date.now()}_${file.name}`;
  const filePath = `${userId}/${fileName}`;

  // Upload to storage
  const { data, error } = await supabase.storage
    .from('meal-photos')
    .upload(filePath, file);

  if (error) throw error;

  // Get public URL
  const { data: { publicUrl } } = supabase.storage
    .from('meal-photos')
    .getPublicUrl(filePath);

  return publicUrl;
}
```

### Upload Progress Photo

```javascript
async function uploadProgressPhoto(userId, file, photoType) {
  const fileName = `${photoType}_${Date.now()}.jpg`;
  const filePath = `${userId}/${fileName}`;

  const { data, error } = await supabase.storage
    .from('progress-photos')
    .upload(filePath, file);

  if (error) throw error;

  const { data: { publicUrl } } = supabase.storage
    .from('progress-photos')
    .getPublicUrl(filePath);

  return publicUrl;
}
```

## API Examples

### Create Check-In

```javascript
async function createCheckIn(clientId, checkInData) {
  const { data, error } = await supabase
    .from('check_ins')
    .insert({
      client_id: clientId,
      date: new Date().toISOString().split('T')[0],
      steps: checkInData.steps,
      hunger_level: checkInData.hungerLevel,
      energy_level: checkInData.energyLevel,
      weight_kg: checkInData.weightKg,
      meal_photo_url: checkInData.mealPhotoUrl,
      notes: checkInData.notes
    })
    .select()
    .single();

  return { data, error };
}
```

### Get Coach's Unreviewed Check-Ins

```javascript
async function getUnreviewedCheckIns(coachId) {
  const { data, error } = await supabase
    .from('check_ins')
    .select(`
      *,
      clients:client_id (
        id,
        users:user_id (
          name,
          email
        )
      )
    `)
    .eq('reviewed_by_coach', false)
    .gte('date', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
    .order('date', { ascending: false });

  return { data, error };
}
```

### Detect Red Flags

```javascript
async function getRedFlags(clientId) {
  const { data, error } = await supabase
    .rpc('detect_red_flags', { client_uuid: clientId });

  return { data, error };
}
```

### Create Client Invite

```javascript
async function createInvite(coachId, email) {
  const { data, error } = await supabase
    .rpc('create_client_invite', {
      p_coach_id: coachId,
      p_email: email,
      p_expires_in_days: 7
    });

  return { data, error };
}
```

## Environment Variables

Create `.env` file:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

## React Native Setup

```bash
npm install @supabase/supabase-js
```

```javascript
// lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

## Testing Checklist

- [ ] Coach can sign up and create profile
- [ ] Coach can generate client invite
- [ ] Client can sign up with valid invite code
- [ ] Client can submit check-in
- [ ] Coach can view unreviewed check-ins
- [ ] Coach can mark check-in as reviewed
- [ ] Client can upload meal photo
- [ ] Client can upload progress photo
- [ ] Coach can assign meal plan to client
- [ ] Red flag detection works correctly
- [ ] RLS policies prevent unauthorized access

## Next Steps

1. Implement React Native screens
2. Set up Expo push notifications
3. Integrate WhatsApp Business API
4. Set up Stripe for payments
5. Deploy Edge Functions for scheduled tasks (daily reminders, red flag checks)
