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

## API tests (safe)

`npm test` does not use `MONGO_URI` or `DB_NAME`. Set `TEST_MONGODB_URI` to a local MongoDB server. The database name defaults to `fitnessgurusg_test` and must end with `_test`. The test deletes only the rows it created. If the name does not end with `_test`, or `NODE_ENV` is not `test`, it stops before deleting anything.

```bash
TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm test
```

`npm run test:auth` is a separate suite. It also uses `TEST_MONGODB_URI` only, and it refuses to drop a database whose name does not end with `_test`.

`npm run test:photos` checks private progress photos. It uses `TEST_MONGODB_URI` only, `NODE_ENV=test`, and a database name ending in `_test`.

## Move old progress photos (one time)

Progress photos are no longer public. New photos go straight into a private folder. Photos already sitting in `uploads/` stay on disk, but the old `/uploads/...` link no longer opens them.

The move is a separate command. The server does not run it. Run a dry run first, and back up first.

1. Back up the database, and copy the `uploads/` folder somewhere safe.
2. Dry run (this is the default). It only prints counts. It does not move files or change the database:

```bash
npm run migrate:photos
```

3. When the counts look right, apply the move:

```bash
npm run migrate:photos -- --apply
```

The command prints counts only. It does not print file names, client names, or other personal data.

| Count | Meaning |
|---|---|
| files_seen | Files in the uploads folder |
| would_move | Dry run: files that would be moved |
| moved | Apply: files that were moved |
| already_migrated | A previous apply already moved this file |
| owner_unknown | No single owner was found. The file stays where it is, and it is not public |
| not_a_photo | Not a JPG, PNG, or HEIC. Left in place |
| not_stripped | Location data could not be removed safely. Left in place |
| skipped | Unreadable, or larger than 20 MB. Left in place |
| references_to_update | Dry run: check-ins or client records that would be updated |
| references_updated | Apply: records that now point at the private photo |

Running it again is safe. A second `--apply` does not create a second copy. Files whose owner cannot be determined are left in `uploads/` and are listed only as `owner_unknown`.

## Questions?

Refer to:
1. `docs/setup/SUPABASE_SETUP.md` - Setup & API examples
2. `supabase/functions/README.md` - Edge Functions deployment
3. `docs/product/database_schema.md.resolved` - Original schema documentation
