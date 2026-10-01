# 📋 PHASE 7 DEVICE TEST LOG — FitnessGuruSG

**Test Session Date:** 2026-02-20 15:26 SGT  
**Tester:** Senior QA (Automated Run)  
**Backend URL:** http://localhost:5001  
**Mobile:** Expo React Native (mobile-only build — no web support)

---

## ⚙️ PRE-TEST ENVIRONMENT VERIFICATION

| Check | Result | Evidence |
|---|---|---|
| Backend running (port 5001) | ✅ PASS | `{"status":"ok","mongodb":"connected"}` |
| MongoDB connected | ✅ PASS | Confirmed in health response |
| Coach account exists | ✅ PASS | `coach@test.com` → JWT issued |
| Test clients seeded with correct coach_id | ✅ PASS | 3 clients inserted under coach `6997fdda07da36e29ccf0bc3` |
| Status endpoint returns correct data | ✅ PASS | See table below |
| Web browser access to app | ❌ BLOCKED | Expo is running in mobile-only mode. No `react-native-web`/`react-dom` installed. Browser test not possible. |

### Status Endpoint Evidence (curl-verified 2026-02-20)

```json
GET /api/clients/status?date=2026-02-20
Authorization: Bearer <coach token>

Response:
{
  "success": true,
  "date": "2026-02-20",
  "clients": [
    { "clientId": "phase7_alice", "clientName": "Alice Chen",  "hasCheckedInToday": false, "lastCheckInDate": "2026-02-19" },
    { "clientId": "phase7_bob",   "clientName": "Bob Tan",     "hasCheckedInToday": true,  "lastCheckInDate": "2026-02-20" },
    { "clientId": "phase7_clara", "clientName": "Clara Lim",   "hasCheckedInToday": false, "lastCheckInDate": null }
  ]
}
```

**Backend logic is provably correct:**
- Alice → `hasCheckedInToday: false` → must render Pending badge ✅ (code path confirmed)
- Bob → `hasCheckedInToday: true` → must render Checked in badge ✅ (code path confirmed)
- Clara → `lastCheckInDate: null` → must render "No check-ins recorded" ✅ (code path confirmed)

---

## 🔴 BLOCKING ISSUE — UI Test Cannot Execute

**Root cause:** Expo is started as `npx expo start` (mobile mode). The Expo dev server at port 8081 serves the Metro JSON manifest only — it does not serve an HTML page for web browsers.

**What is needed to unblock:**
```bash
# Option A (recommended for UI testing without physical device):
cd fitnessgurusg-mobile
npx expo start --web    # Requires: npx expo install react-native-web react-dom @expo/metro-runtime

# Option B (preferred for real validation):
# Open Expo Go app on iPhone/iPad → scan QR code from terminal → test on physical device
# OR: Open iOS Simulator on this Mac → press 'i' in Expo terminal
```

**TC8–TC13 results pending physical device / simulator test.**

---

## 📋 TEST CASE LOG

### TC8 — Status Badges Reflect Check-In State
- **Status:** ⏳ PENDING — Requires iOS simulator or physical device
- **Backend precondition:** ✅ VERIFIED — Alice=Pending, Bob=CheckedIn, Clara=Pending (curl-confirmed)
- **Code evidence:** `ClientsScreen.tsx` line 89–99 — `hasCheckedInToday` drives `badgeSuccess`/`badgeWarning` styles
- **Risk:** Low — logic is trivial boolean from API

---

### TC9 — Filter Toggle: All vs Pending
- **Status:** ⏳ PENDING — Requires iOS simulator or physical device
- **Backend precondition:** ✅ VERIFIED — 2 pending clients, 1 checked in
- **Code evidence:** `ClientsScreen.tsx` lines 85–86 — `filter === 'all' ? clients : pending` in-memory filter
- **Risk:** Low — no async calls involved

---

### TC10 — Reminder Share Message
- **Status:** ⏳ PENDING — Requires iOS simulator or physical device
- **Code evidence:** `ClientsScreen.tsx` line 22–24 — `buildReminderText()` uses `en-SG` locale → "20 Feb 2026"
- **Note:** `Share.share()` will not open in web mode even if web were available — requires native device

---

### TC11 — Last Check-In Date Format
- **Status:** ⏳ PENDING — Requires iOS simulator or physical device
- **Backend precondition:** ✅ VERIFIED — Alice: "2026-02-19", Bob: "2026-02-20", Clara: null
- **Code evidence:** `ClientsScreen.tsx` lines 13–19 — `formatDateSG()` uses `en-SG` locale → "19 Feb 2026"
- **Expected display:** Alice="19 Feb 2026", Bob="20 Feb 2026", Clara="No check-ins recorded"

---

### TC12 — Error Handling
- **Status:** ⏳ PENDING — Requires iOS simulator or physical device
- **Code evidence:** `ClientsScreen.tsx` lines 160–168 — error card + "Try again" retry button rendered when `error !== null`

---

### TC13 — Logout + Re-Login (Status Retained)
- **Status:** ⏳ PENDING — Requires iOS simulator or physical device
- **Code evidence:** `AuthContext.tsx` + `AsyncStorage` — token cleared on logout, re-fetched on login; `useFocusEffect` refetches status on Clients tab focus

---

## 🎯 OVERALL GATE STATUS

| Gate | Result |
|---|---|
| Backend API correctness | ✅ VERIFIED via curl |
| Status endpoint data accuracy | ✅ VERIFIED via curl |
| UI test (TC8–TC13) | ⏳ PENDING — physical device required |

**Phase 7 "Manual Device Validation" gate: ❌ NOT YET CLOSED**

**Unblocking action required:**
> Open the iOS Simulator on this Mac (Xcode required) and press `i` in the Expo terminal, OR open Expo Go on a physical device and scan the QR code. Then execute TC8–TC13 and fill in the results table in `MANUAL_TEST_PLAN.md`.

---

## 📝 Re-Test Instructions (when device is available)

1. Expo already running: `npx expo start` in `fitnessgurusg-mobile/`
2. Test data already seeded (Alice=Pending, Bob=CheckedIn, Clara=No history)
3. Login: `coach@test.com` / `<your-test-password>`
4. Execute TC8–TC13 from `MANUAL_TEST_PLAN.md`
5. Fill in the execution log table at the bottom of `MANUAL_TEST_PLAN.md`
6. If all pass → update `PROJECT_STATUS.md` Phase 7 manual test to confirmed ✅
