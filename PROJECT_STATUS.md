# FitnessGuruSG — Project Status

> **Last updated:** 2026-09-10 21:00 SGT
> **Previous history:** Archived in `docs/archive/PROJECT_STATUS_HISTORY_2026-09-10.md`

---

## 1. Executive Summary

FitnessGuruSG is a mobile fitness coaching app built with React Native (Expo) + Node/Express + MongoDB.

- **Coach side:** Manage clients, view daily check-ins, assign session plans, assign workouts, manage bookings/availability, track payments, view insights and red flags, send follow-up reminders.
- **Client side:** Submit daily check-ins (energy, appetite, steps, nutrition, progress photos), view and log assigned workouts, book coaching sessions, manage body profile, track progress.

The app is **feature-rich and working locally.** It is **not production-ready** — it runs on localhost, uses simulated payments, and has not been end-to-end tested with all recent changes.

---

## 2. Current Phase

**Feature-Rich Local Development + Pre-Production Verification**

Reasons:
- Many major features are built across 20+ screens and 45+ API endpoints.
- Mobile TypeScript now has **zero errors** (`npx tsc --noEmit` passes cleanly).
- Current progress has been committed (secrets scrubbed before commit).
- Backend is local-only (no production deployment).
- Payment is simulated only (no real payment provider).
- Full manual end-to-end testing is still required.

---

## 3. Latest Checkpoint — 2026-09-10

### Git Log

```
5597b63 Fix mobile booking TypeScript errors
66d14ea WIP: save current FitnessGuruSG app progress before test pass
f2cf93b Initial commit: MongoDB integration working
```

### What Was Done

- ✅ Full codebase audit completed (code + git + types + session handling)
- ✅ Secrets scrubbed from source code and documentation before commit
- ✅ `.env` files confirmed git-ignored (root + mobile)
- ✅ `@expo/vector-icons` package installed (was missing types)
- ✅ BookingScreen TypeScript `never`-type error fixed (intersection → union)
- ✅ Mobile `npx tsc --noEmit` passes with **zero errors**
- ✅ WIP app progress committed (136 files, +45,298 lines)
- ✅ Appetite/Hunger wording confirmed safe (UI-only, backend field unchanged)
- ✅ Expired session handling verified (global 401 → logout → LoginScreen)

### What's Next

- Manual end-to-end testing (client flow, then coach flow)
- No new features until testing passes

---

## 4. Feature Status Table

| Feature | Status | Notes | Needs Testing? |
|---|---|---|---|
| **Auth — Coach login** | Built | Email/password + rate limiting | Yes |
| **Auth — Client login** | Built | Password for self-registered, email-only for legacy | Yes |
| **Auth — Client registration** | Built | Self-registration with email/password | Yes |
| **Auth — Google OAuth** | Built | iOS client ID configured; new users default to client role | Yes |
| **Auth — Invite code / connect-coach** | Built | Lazy generation + connect flow | Yes |
| **Expired session handling** | Built | Global 401 → event bus → logout → LoginScreen, with dedup | Yes |
| **Coach dashboard** | Built | Real API data, stat tiles, action queue, today's sessions | Yes |
| **Client home / check-in** | Built | Energy, appetite, steps, nutrition, photos | Yes |
| **Energy tracking** | Built | 1–10 rating with inline picker | Yes |
| **Appetite tracking** | Built | UI label "Appetite", data field remains `hunger` | Yes |
| **Steps tracking** | Built | Numeric input, optional | Yes |
| **Nutrition logging** | Built | Manual input: calories, protein, carbs, fat | Yes |
| **Progress photos** | Built | Upload-on-select, max 3 per check-in | Yes |
| **Client progress screen** | Built | Check-in history list (no trend graphs yet) | Yes |
| **Workout assignment (coach)** | Built | Coach assigns exercises with sets/reps/weight/notes | Yes |
| **Workout logging (client)** | Built | Client logs actual performance + difficulty | Yes |
| **Workout history + personal bests** | Built | Previous performance shown inline | Yes |
| **Client profile / body profile** | Built | Height, weight, goal, injuries, experience | Yes |
| **Coach clients list** | Built | Filters: All / Follow-Up / Active Plan / No Plan / Missed | Yes |
| **Follow-up / missed check-in filters** | Built | Filter logic in ClientsScreen | Yes |
| **Check-in pause/resume** | Built | Auto-pause at 3+ missed days, resume button | Yes |
| **Booking calendar (coach)** | Built | Date strip, open/booked/blocked slots, MonthCalendar | Yes |
| **Open availability slots** | Built | Create/block/unblock | Yes |
| **Client booking** | Built | Browse + book open slots; feature flag may hide tab | Yes |
| **Payment / session packages** | Built (simulated) | SimulatedPaymentProvider — no real money | Yes |
| **Revenue / renewal dashboard** | Built | Monthly revenue summary endpoint | Yes |
| **Red flag detection** | Built | Automated detection + manual trigger | Yes |
| **WhatsApp integration** | Partially built | Routes + service exist, needs Meta API credentials | If configured |
| **Push notifications** | Not built | Preference card exists, no push infrastructure | N/A |
| **AI / bot insights** | Not built | `AUTO_BOT` type exists but zero AI logic | N/A |
| **Apple Health / health devices** | Not built | Future feature | N/A |
| **Production deployment** | Not built | Local-only, no hosting | N/A |
| **Real payment provider** | Not built | Simulated only — PaymentProvider interface ready | N/A |

---

## 5. Current Blockers

| # | Blocker | Impact |
|---|---|---|
| 1 | Full manual end-to-end testing not completed | Cannot verify all flows work together |
| 2 | Backend is local-only (localhost:5001) | No external access |
| 3 | MongoDB is local-only (127.0.0.1) | No Atlas / no backups |
| 4 | Real payment provider not integrated | Cannot process real transactions |
| 5 | No production API URL / domain | Mobile app points to LAN IP |
| 6 | Privacy policy and terms not written | App Store requirement |
| 7 | TestFlight / App Store preparation not done | No release build |
| 8 | Push notification infrastructure missing | Reminder preferences saved but not delivered |
| 9 | Mobile booking feature flag may be `false` | Client Book tab may be hidden |
| 10 | LAN IP changes with WiFi network | Requires manual `.env` update + rebuild |

---

## 6. Resolved Recently (2026-09-10)

- ✅ **Expired session red screen** — fixed with global 401 handling via `authEvents` event bus
- ✅ **Hunger → Appetite wording** — UI safely changed; backend field remains `hunger`
- ✅ **Secrets scrubbed** — removed hardcoded MongoDB password from `seed-demo.ts` and `PROJECT_STATUS.md`
- ✅ **Major WIP committed** — 136 files, 3 commits on `main`
- ✅ **@expo/vector-icons** — installed correctly via `npx expo install`
- ✅ **BookingScreen TS error** — fixed `OpenSlot & Booking & BlockedSlot` intersection (→ `never`) to safe union with `in` checks
- ✅ **Mobile TypeScript** — `npx tsc --noEmit` passes with zero errors
- ✅ **PROJECT_STATUS.md** — cleaned and reorganized; old content archived

---

## 7. Manual Testing Plan

### Client Flow

- [ ] Register new client account
- [ ] Login with email/password
- [ ] Connect to coach (invite code or auto-assign)
- [ ] Fill body profile (height, weight, goal, injuries, experience)
- [ ] Submit daily check-in (energy, appetite, steps, nutrition)
- [ ] Upload progress photo
- [ ] View progress screen
- [ ] View today's assigned workout
- [ ] Log workout performance
- [ ] Book a coaching session
- [ ] View / cancel booking
- [ ] Verify expired session handling (use expired JWT)

### Coach Flow

- [ ] Login with email/password
- [ ] View dashboard (stat tiles, action queue, today's sessions)
- [ ] View clients list with filters
- [ ] View client details (profile + payments + check-in)
- [ ] Assign plan to client
- [ ] Assign workout to client
- [ ] Add open availability slot
- [ ] Block a time slot
- [ ] Manually book a client (QuickBookModal)
- [ ] Complete / cancel a booking
- [ ] View revenue / session status
- [ ] Verify expired session handling

---

## 8. Safe Changes Now

These are safe to make without affecting core logic:

- UI copy / wording adjustments
- Small layout polish and spacing
- Empty state messages
- Documentation cleanup
- Bug fixes found during manual testing
- Feature flag adjustments (e.g. `BOOKING_SYSTEM_ENABLED`)

---

## 9. Do Not Work On Yet

- ❌ AI / chatbot insights
- ❌ Apple Health / HealthKit / Health Connect
- ❌ Push notification infrastructure
- ❌ Real payment provider (Stripe / HitPay / PayNow)
- ❌ Major refactors or new architecture
- ❌ New major screens
- ❌ Advanced analytics / trend graphs
- ❌ Production deployment (before local testing passes)
- ❌ MyFitnessPal integration (API is closed)
- ❌ App Store / Play Store submission

---

## 10. Next 7 Days

### Day 1 — Environment Verification
- [ ] Confirm MongoDB starts and is reachable
- [ ] Start backend: `npm run dev` (from root)
- [ ] Update mobile `.env` IP if needed: `ipconfig getifaddr en0`
- [ ] Start Expo: `npx expo start --clear` (from `fitnessgurusg-mobile/`)
- [ ] Run `npx tsc --noEmit` — confirm zero errors

### Day 2–3 — Client Flow Testing
- [ ] Test full client flow (register → check-in → workout → booking)
- [ ] Document what works and what breaks

### Day 4–5 — Coach Flow Testing
- [ ] Test full coach flow (login → dashboard → assign → book → review)
- [ ] Document what works and what breaks

### Day 6 — Bug Fixes
- [ ] Fix only bugs found during testing
- [ ] No new features

### Day 7 — Documentation + Commit
- [ ] Update this file with real test results
- [ ] Commit tested fixes
- [ ] Decide if ready for private beta preparation

---

## 11. Environment Notes

| Item | Value |
|---|---|
| Backend port | `5001` |
| Backend start | `npm run dev` (from project root) |
| Mobile start | `npx expo start --clear` (from `fitnessgurusg-mobile/`) |
| Mobile API URL | Set `EXPO_PUBLIC_API_URL` in `fitnessgurusg-mobile/.env` |
| LAN IP check | `ipconfig getifaddr en0` |
| After `.env` change | Must restart Expo — Metro hot-reload does NOT pick up `.env` changes |
| `.env` files | **Git-ignored — never commit** |
| Secrets | Never hardcode in source code; use `.env` + `process.env` only |
| Production API URL | Set `EXPO_PUBLIC_API_URL_PROD` for release builds |
| MongoDB | Local only — `MONGO_URI` in root `.env` |

---

## 12. Tech Stack

| Layer | Technology |
|---|---|
| Mobile | React Native 0.81.5 + Expo SDK 54 + TypeScript 5.9 |
| Backend | Node.js + Express 5 + TypeScript |
| Database | MongoDB 7 (local) |
| Auth | JWT (30-day expiry) + bcrypt + Google OAuth |
| State | React Context + AsyncStorage |
| Navigation | React Navigation 7 (native-stack + bottom-tabs) |
| Icons | @expo/vector-icons (Ionicons) |
| Images | expo-image-picker + multer (backend) |

---

## 13. Database Migration Strategy — MongoDB to Supabase

### Current Decision

MongoDB is currently being used as the temporary development database while the app is being built and tested locally.

Supabase is being considered as the future production database and backend platform, but migration should **not** happen immediately.

### Recommendation

Do not migrate to Supabase until the current MongoDB version passes full manual end-to-end testing.

Best timing:

1. Finish local testing with MongoDB.
2. Confirm the full client and coach flows work correctly.
3. Freeze new feature development.
4. Design the final Supabase schema based on the tested app.
5. Migrate before real users, real payments, or public launch.

### Why Not Migrate Yet

The current app still needs full manual testing. Migrating too early may create confusion because bugs could come from either:

- the app logic
- the API layer
- the database migration
- the new Supabase schema
- authentication changes

The safest approach is to prove the app flow first, then migrate the database.

### When It Is Safe to Start Supabase Migration

Supabase migration can begin when these are true:

- [ ] Client flow has been tested end-to-end
- [ ] Coach flow has been tested end-to-end
- [ ] Booking flow works locally
- [ ] Check-in flow works locally
- [ ] Workout assignment and logging work locally
- [ ] Session/package flow works locally
- [ ] Current bugs from testing are fixed
- [ ] No major feature changes are pending
- [ ] Project status is updated with verified test results

### Do Not Start Supabase Migration If

- [ ] Manual testing is not complete
- [ ] Booking flow is still unstable
- [ ] Payment/session flow is still unverified
- [ ] App still has major TypeScript or runtime errors
- [ ] New features are still being added
- [ ] Real users are already using the app without a migration plan

### Migration Rule

MongoDB → Supabase migration should happen **before production launch**, not after many real users are already using the app.

Migrating after launch is possible, but it is riskier because real user data would need to be moved carefully.

### Recommended Migration Order

Migrate in this order:

1. Coaches and clients
2. Authentication / user roles
3. Client profiles and body profiles
4. Daily check-ins
5. Progress photos / file storage
6. Workout assignments
7. Workout logs
8. Availability and bookings
9. Session plans and payment records
10. Dashboard summaries and insights
11. Red flag detection
12. Reminder preferences

### Supabase Migration Rules

- Do not rewrite the whole app at once.
- Do not migrate while adding new features.
- Do not remove MongoDB until Supabase has been tested.
- Keep a backup of MongoDB data before migration.
- Create a clear table mapping: MongoDB collection → Supabase table.
- Test each migrated module one by one.
- Keep manual input working even after migration.
- Do not add Apple Health, AI, push notifications, or real payment provider during migration.
- Do not launch publicly until Supabase auth, database rules, and storage permissions are verified.

### Supabase Benefits If Chosen

Supabase may be useful for production because it provides:

- hosted PostgreSQL database
- built-in authentication
- file storage
- row-level security
- dashboard for viewing data
- easier production database management

### Supabase Risks

Supabase migration is not just a database change. It may affect:

- authentication
- API routes
- file uploads
- permissions
- coach/client access rules
- storage security
- data structure
- testing requirements

Because of this, it should be treated as a dedicated migration phase.

### Final Recommendation

Use MongoDB to finish local development and testing.

If Supabase is still the preferred long-term production platform, migrate after testing passes and before private beta or public launch.

Do not migrate while the app is still changing quickly.

---

## Archive

Full project history, phase-by-phase development notes, change logs, and previous audit details are preserved in:

**`docs/archive/PROJECT_STATUS_HISTORY_2026-09-10.md`**

This includes:
- Phase 0–11 detailed planning and implementation notes
- Change log entries from 2026-03 through 2026-08
- Previous audit findings (2026-04-18, 2026-08-20)
- Old "current state" sections that are now outdated
- Historical booking/payment planning sections
- Health device integration research and recommendations
