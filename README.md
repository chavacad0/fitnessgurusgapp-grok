# Fitness Coaching App - File Structure

Open findings: [docs/AUDIT.md](docs/AUDIT.md). Shipped and in-review changes: [CHANGELOG.md](CHANGELOG.md).

```
/Users/admin/Fitnessprac/
├── docs/
│   ├── database/
│   │   ├── schema.sql              # Main database schema (run first)
│   │   ├── invites.sql             # Client invite system
│   │   └── storage.sql             # Storage buckets & policies
│   ├── setup/
│   │   └── SUPABASE_SETUP.md      # Complete setup guide
│   └── product/
│       └── database_schema.md.resolved  # Frozen v1 schema (reference)
└── supabase/
    └── functions/
        ├── README.md              # Edge Functions deployment guide
        ├── daily-reminders/
        │   └── index.ts          # Daily check-in reminders
        └── red-flag-detector/
            └── index.ts          # Red flag detection & alerts
```

## Quick Start

### 1. Set Up Supabase Project
```bash
# Create project at supabase.com
# Note your project URL and keys
```

### 2. Run SQL Migrations
In Supabase SQL Editor, run in order:
1. `docs/database/schema.sql` - Core database
2. `docs/database/invites.sql` - Invite system
3. `docs/database/storage.sql` - File storage

### 3. Deploy Edge Functions
```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF

# Deploy functions
cd supabase/functions
supabase functions deploy daily-reminders
supabase functions deploy red-flag-detector
```

### 4. Set Up Cron Jobs
Run the cron job SQL from `supabase/functions/README.md` to schedule:
- Daily reminders at 8 PM SGT
- Red flag detection every 6 hours

### 5. Create Storage Buckets
Buckets are created via SQL in `docs/database/storage.sql`:
- `meal-photos` (private)
- `progress-photos` (private)
- `meal-plan-pdfs` (private)
- `avatars` (public)

## Tech Stack (Supabase Implementation)

| Component | Technology |
|-----------|-----------|
| Database | PostgreSQL (via Supabase) |
| Authentication | Supabase Auth (JWT) |
| Storage | Supabase Storage (S3-compatible) |
| API | Auto-generated REST & GraphQL |
| Realtime | Supabase Realtime subscriptions |
| Edge Functions | Deno Deploy |
| Mobile App | React Native + Expo |
| State Management | React Query + Zustand |

## Key Features Implemented

### Database
✅ 15 tables with proper relationships  
✅ Row Level Security (RLS) policies for privacy  
✅ Indexes for coach review queue performance  
✅ Triggers for auto-updated timestamps  
✅ Helper functions for red flag detection  

### Authentication & Security
✅ Coach and client roles via metadata  
✅ Invite-only client onboarding  
✅ PDPA compliance (consent tracking)  
✅ Password hashing (Supabase built-in)  

### File Storage
✅ Private buckets for sensitive photos  
✅ RLS policies on storage objects  
✅ Coach can view client files  
✅ Clients can only view own files  

### Automation
✅ Daily check-in reminders (Edge Function)  
✅ Red flag detection (Edge Function)  
✅ Scheduled cron jobs  
✅ Push notification creation  

## Next Steps

### Mobile App Development
1. Set up React Native + Expo project
2. Install `@supabase/supabase-js`
3. Create screens:
   - Coach: Dashboard, Review Queue, Client Detail
   - Client: Check-In Form, Progress View, Meal Plans
4. Implement file uploads for photos
5. Add push notification handling

### Integrations
- [ ] WhatsApp Business API (Twilio/360dialog)
- [ ] Stripe payment processing
- [ ] Expo push notifications
- [ ] Email service (SendGrid/AWS SES)

### Testing
- [ ] Test RLS policies with different users
- [ ] Verify red flag detection logic
- [ ] Test file upload/download
- [ ] Validate invite system
- [ ] Load test with 100+ clients

## Code Examples

All code examples are in `docs/setup/SUPABASE_SETUP.md`:
- User signup (coach & client)
- Check-in creation
- File uploads
- Red flag detection
- Client invite generation

## Questions?

Refer to:
1. `docs/setup/SUPABASE_SETUP.md` - Setup & API examples
2. `supabase/functions/README.md` - Edge Functions deployment
3. `docs/product/database_schema.md.resolved` - Original schema documentation
