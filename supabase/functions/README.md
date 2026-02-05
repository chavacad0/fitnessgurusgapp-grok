# Supabase Edge Functions

## Overview
These Edge Functions run on Deno Deploy and handle scheduled tasks for the fitness coaching app.

## Functions

### 1. `daily-reminders`
Sends check-in reminders to clients who haven't submitted their daily check-in.

**Trigger:** Cron job at 8 PM SGT daily  
**Endpoint:** `https://your-project.supabase.co/functions/v1/daily-reminders`

### 2. `red-flag-detector`
Scans all active clients for red flags (missed check-ins, low energy, high hunger) and notifies coaches.

**Trigger:** Cron job every 6 hours  
**Endpoint:** `https://your-project.supabase.co/functions/v1/red-flag-detector`

## Deployment

### Prerequisites
```bash
npm install -g supabase
supabase login
```

### Link Project
```bash
supabase link --project-ref your-project-ref
```

### Deploy Functions
```bash
# Deploy all functions
supabase functions deploy

# Or deploy individually
supabase functions deploy daily-reminders
supabase functions deploy red-flag-detector
```

### Set Environment Variables
```bash
supabase secrets set WHATSAPP_ACCESS_TOKEN=your_token
supabase secrets set WHATSAPP_PHONE_NUMBER_ID=your_phone_id
```

## Set Up Cron Jobs

In Supabase Dashboard → Database → Cron Jobs (or use `pg_cron`):

### Daily Reminders (8 PM SGT)
```sql
select cron.schedule(
  'daily-reminders-8pm',
  '0 20 * * *', -- 8 PM SGT (UTC+8, so 12:00 UTC)
  $$
  select net.http_post(
    url := 'https://your-project.supabase.co/functions/v1/daily-reminders',
    headers := '{"Authorization": "Bearer ' || current_setting('app.service_role_key') || '"}'::jsonb
  ) as request_id;
  $$
);
```

### Red Flag Detector (Every 6 hours)
```sql
select cron.schedule(
  'red-flag-detector-6h',
  '0 */6 * * *', -- Every 6 hours
  $$
  select net.http_post(
    url := 'https://your-project.supabase.co/functions/v1/red-flag-detector',
    headers := '{"Authorization": "Bearer ' || current_setting('app.service_role_key') || '"}'::jsonb
  ) as request_id;
  $$
);
```

## Testing Locally

### Start Local Supabase
```bash
supabase start
supabase functions serve
```

### Test Function
```bash
curl -i --location --request POST \
  'http://localhost:54321/functions/v1/daily-reminders' \
  --header 'Authorization: Bearer YOUR_ANON_KEY' \
  --header 'Content-Type: application/json'
```

## Logs & Monitoring

### View Logs
```bash
supabase functions logs daily-reminders
supabase functions logs red-flag-detector
```

### In Dashboard
Supabase Dashboard → Edge Functions → Select function → Logs

## WhatsApp Integration (Optional)

To enable WhatsApp messaging in `daily-reminders`, add this function:

```typescript
async function sendWhatsAppMessage(phone: string, message: string) {
  const accessToken = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  
  const response = await fetch(
    `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { body: message }
      })
    }
  );
  
  return response.json();
}
```

Then uncomment the WhatsApp section in the function code.
