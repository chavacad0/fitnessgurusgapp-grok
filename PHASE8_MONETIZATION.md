# 💳 PHASE 8 — MONETIZATION DESIGN

> Status: Design/Planning — no code yet
> Created: 2026-03-27
> Owner: Coach-facing SaaS product

---

## 1. WHO PAYS

**The coach pays. Not the client.**

### Justification

| Signal | Detail |
|---|---|
| **Value recipient** | The coach saves 30–60 min/day that was spent chasing clients, reading WhatsApp, and building manual trackers |
| **Outcome owner** | The coach is accountable for client results — better data = better coaching = client retention |
| **Decision maker** | The coach chooses and pays for tools (same as they would for Calendly, Notion, or scheduling apps) |
| **Singapore context** | Fitness coaches in SG charge SGD 200–600/month per client. A tool costing SGD 29–49/month pays for itself with 1 retained client |
| **Client role** | Clients use the app for free — they are the **data source**, not the customer |

---

## 2. PRICING MODEL (Singapore-Friendly, MVP)

### Principle
Simple, low friction, single-tier upgrade. No annual lock-in at launch.

---

### Tier Structure

| | 🆓 Free | 🚀 Pro — SGD 29/month |
|---|---|---|
| **Clients** | Up to 3 | Unlimited |
| **Daily check-in submission** | ✅ | ✅ |
| **Basic client list** | ✅ | ✅ |
| **Checked-in / pending badges** | ✅ | ✅ |
| **Share reminder button** | ✅ | ✅ |
| **Streak tracking** | ❌ Locked | ✅ |
| **Red flag detection** | ❌ Locked | ✅ |
| **Insights screen (analytics)** | ❌ Locked | ✅ |
| **Filter: Needs Check-in** | ❌ Locked | ✅ |
| **Last check-in date visible** | ❌ Locked | ✅ |

### Price Justification

- **SGD 29/month** ≈ SGD 0.97/day — less than one coffee
- Replaces 30–60 min of manual admin per day for the coach
- Coaches managing 10+ clients save far more value than the cost
- Positioned below Trainerize (USD 30+/month) — comparable feature set for solo coaches
- Low enough that a coach will trial it without needing approval from anyone

### Future pricing (post-MVP, do not implement now)
- Annual plan: SGD 249/year (save ~SGD 100 vs monthly)
- Agency plan: SGD 99/month for multiple coaches under one account

---

## 3. FEATURE GATING — DETAILED TABLE

### Philosophy
- **Free tier** = enough to try the core loop (check-in → see status)
- **Pro tier** = everything that actually saves time at scale (insights, patterns, streak intelligence)
- The moment a coach has more than 3 clients, they hit the wall and upgrade

### Gating Map

| Feature | Free | Pro | Gate location |
|---|---|---|---|
| Submit check-in | ✅ | ✅ | None |
| View client list (up to 3) | ✅ | — | Backend: `GET /api/clients` returns max 3 if `tier = 'free'` |
| View client list (4+) | ❌ | ✅ | Backend: count check + 403 with upgrade message |
| Checked-in / pending badge | ✅ | ✅ | None |
| Share reminder button | ✅ | ✅ | None |
| Last check-in date | ❌ | ✅ | Mobile: blur/lock if `isPro === false` |
| Filter: Needs Check-in | ❌ | ✅ | Mobile: disabled with Pro badge |
| Streak tracker | ❌ | ✅ | Mobile: replaced by upgrade prompt in `ClientsScreen` |
| Red flag detection | ❌ | ✅ | Backend: `GET /api/clients/:id/redflags` returns 403 if Free |
| Insights screen | ❌ | ✅ | Mobile: full screen replaced by `UpgradeScreen` |

---

## 4. IMPLEMENTATION PLAN (NO CODE YET)

### Architecture decision: where does `tier` live?

**Option A — stored in DB (`coaches` collection)**
- Add `subscriptionTier: 'free' | 'pro'` field to the `coaches` MongoDB document
- Read it on login / in `GET /api/auth/me`
- Include it in the JWT payload **or** fetch it on app start from `/api/auth/me`

**Recommendation: store in DB, include in `/api/auth/me` response. Do NOT put it in the JWT** (JWT is long-lived; tier can change when Stripe pays/lapses — you need the DB to be authoritative).

---

### Step-by-step implementation order

#### Step 1 — Backend: add `subscriptionTier` to coach model
- `coaches` MongoDB document gains field: `subscriptionTier: 'free' | 'pro'` (default `'free'`)
- No migration needed — new field, new coaches will have it; existing coach gets `'free'` by default on first read
- File: `src/models/coachModel.ts`, `src/repositories/mongoCoachRepo.ts`

#### Step 2 — Backend: expose tier in `/api/auth/me`
- `GET /api/auth/me` already exists and returns coach profile
- Extend response to include `subscriptionTier`
- Mobile reads this on app start and stores in `AuthContext`
- File: `src/api/authRoutes.ts`

#### Step 3 — Backend: `requiresPro` middleware
- New file: `src/middleware/requiresPro.ts`
- Pattern: reads `req.coach.sub` → fetches coach from DB → checks `subscriptionTier`
- If `'free'`: returns `{ success: false, error: 'Pro subscription required', upgradeRequired: true }` with HTTP 403
- If `'pro'`: calls `next()`
- Apply to: `GET /api/clients/status` (streak field), `GET /api/clients/:id/redflags`
- For client count limit: inline check in `getAllClients()` — if Free and count > 3, return first 3 + `{ limited: true }` flag

#### Step 4 — Mobile: expose `isPro` in `AuthContext`
- After login, call `GET /api/auth/me` → store `subscriptionTier` in context
- Derive `isPro = subscriptionTier === 'pro'`
- All screens read `const { isPro } = useAuth()`
- File: `fitnessgurusg-mobile/src/context/AuthContext.tsx`

#### Step 5 — Mobile: gate `InsightsScreen`
- If `isPro === false`: render `<UpgradeScreen />` instead of insights dashboard
- `UpgradeScreen.tsx` — simple screen: headline, 3 Pro benefits, "Upgrade to Pro" button (links to Stripe later)
- File: `fitnessgurusg-mobile/src/screens/InsightsScreen.tsx`, new `UpgradeScreen.tsx`

#### Step 6 — Mobile: gate `ClientsScreen` Pro features
- Streak column: if `isPro === false` → show `🔒 Pro` badge instead of streak number
- Filter tabs: if `isPro === false` → "Needs Check-in" tab is grayed with `🔒 Pro` label, tap shows upgrade prompt
- Last check-in date: if `isPro === false` → blurred/hidden with inline "Upgrade" text
- File: `fitnessgurusg-mobile/src/screens/ClientsScreen.tsx`

#### Step 7 — Stripe integration (AFTER steps 1–6 are live)
- Create Stripe account (Singapore entity, SGD currency)
- Backend: `POST /api/billing/create-checkout` → Stripe Checkout session (pre-built hosted page — no custom payment UI needed)
- Backend: `POST /api/billing/webhook` → handle `invoice.paid` (set `tier = 'pro'`) and `customer.subscription.deleted` (set `tier = 'free'`)
- Mobile: "Upgrade to Pro" button opens `Linking.openURL(checkoutUrl)`
- No in-app purchase — coach pays via browser/Stripe; app checks tier on next `/api/auth/me` call

---

## 5. WHAT SUCCESS LOOKS LIKE (VERIFICATION)

Before moving to Phase 9 deployment, Phase 8 is complete when:

- [ ] A Free coach sees exactly 3 clients, streak locked, insights locked, upgrade prompts visible
- [ ] A Pro coach sees all clients, full streak, full insights, no locks
- [ ] Stripe test mode: checking out with test card `4242 4242 4242 4242` upgrades the coach to Pro in <5 seconds
- [ ] Subscription cancellation in Stripe test mode downgrades the coach to Free within 1 webhook delivery
- [ ] No Pro data leaks to Free coaches via API (403 returned correctly)

---

## 6. DO NOT DO YET (PHASE 8 SCOPE LIMITS)

- ❌ Annual pricing plans — post-MVP
- ❌ Coupon codes / trials — post-MVP
- ❌ Multi-coach agency accounts — post-MVP
- ❌ In-app purchases (Apple/Google) — significantly more complex; not needed for coach-facing tool
- ❌ Revenue analytics dashboard — Phase 10
- ❌ Client-facing billing — clients are always free
