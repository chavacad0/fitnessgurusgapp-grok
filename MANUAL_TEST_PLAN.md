# 📋 MANUAL TEST PLAN — FitnessGuruSG MVP

**Purpose:** Verify core functionality, error handling, and edge cases before deploying to production or adding authentication.

**Test Environment:**
- Backend: Node.js + Express + MongoDB (port 5001)
- Mobile: React Native + Expo (development mode)
- Test Data: Seeded clients in MongoDB

---

## 🚀 PRE-TEST SETUP

### [ ] 1. Ensure Backend is Running
```bash
# Terminal 1: Start backend
cd /Users/admin/Fitnessprac
npm run dev

# Verify output shows:
# ✅ Connected to MongoDB
# ✅ Server running on http://localhost:5001
```

### [ ] 2. Ensure Mobile App is Running
```bash
# Terminal 2: Start mobile app
cd /Users/admin/Fitnessprac/fitnessgurusg-mobile
npm start

# Then press 'i' for iOS simulator or 'a' for Android emulator
```

### [ ] 3. Verify Seed Data Exists
```bash
# Check MongoDB has test clients
cd /Users/admin/Fitnessprac
npm run seed
```

---

## ✅ TEST CASE 1: HAPPY PATH (Normal Check-In Flow)

**Objective:** Verify the complete user flow works without errors

### Steps:
1. [ ] Open the mobile app
2. [ ] **Clients Screen:** Verify client list loads with loading indicator
3. [ ] Verify at least 1 client appears in the list
4. [ ] Tap on a client (e.g., "Alice Chen")
5. [ ] **Check-In Screen:** Verify screen shows "Daily Check-In for Alice Chen"
6. [ ] Set Energy slider to **7**
7. [ ] Set Hunger slider to **5**
8. [ ] Enter Steps: **8000**
9. [ ] Enter Notes: "Feeling great today!"
10. [ ] Tap **Submit Check-In** button
11. [ ] Verify loading indicator appears
12. [ ] **Insights Screen:** Verify navigation to Insights screen
13. [ ] Verify success message: **"✅ Check-In Submitted!"**
14. [ ] Verify check-in data displays correctly:
    - Energy: 7/10
    - Hunger: 5/10
    - Steps: 8,000
    - Notes: "Feeling great today!"
15. [ ] Verify **NO red flags detected** message appears

**Expected Result:** ✅ Check-in submitted successfully, no errors, data displayed correctly

---

## 🚩 TEST CASE 2: RED FLAG TRIGGERING (Low Energy Pattern)

**Objective:** Verify red flag detection works when low energy pattern is detected

### Steps:
1. [ ] Open mobile app and navigate to Clients
2. [ ] Select a client
3. [ ] Submit 3 consecutive check-ins with **Energy = 2** (low energy):
   - Day 1: Energy 2, Hunger 5
   - Day 2: Energy 2, Hunger 6  
   - Day 3: Energy 2, Hunger 5
4. [ ] On the 3rd check-in, verify **Insights Screen** shows:
   - [ ] **"⚠️ Requires Coach Review"** warning
   - [ ] **"🚩 Red Flags Detected"** section
   - [ ] Red flag message mentions "low energy" or "consecutive days"
   - [ ] Severity level is shown

**Expected Result:** ✅ Red flag detected and displayed with warning

---

## ❌ TEST CASE 3: INVALID INPUT VALIDATION

**Objective:** Verify input validation prevents bad data from being submitted

### Test 3A: Missing Required Fields
1. [ ] Navigate to Check-In screen
2. [ ] Leave Energy at default (5)
3. [ ] Leave Hunger at default (5)
4. [ ] Leave Steps and Notes empty
5. [ ] Tap Submit
6. [ ] **Expected:** Check-in submits successfully (only energy/hunger are required)

### Test 3B: Out-of-Range Values (Backend Validation)
This is tested at the backend level since sliders enforce 1-10 range on mobile.

1. [ ] Use curl to test backend validation:
```bash
curl -X POST http://localhost:5001/api/clients/client_alice/checkins \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2026-02-06",
    "type": "MANUAL",
    "metrics": { "energy": 15, "hunger": 5 }
  }'
```

2. [ ] **Expected Response:** Error message about energy/hunger must be between 1-10

**Expected Result:** ✅ Invalid data rejected with clear error messages

---

## 🔌 TEST CASE 4: BACKEND FAILURE SIMULATION

**Objective:** Verify error handling and retry logic when backend is unavailable

### Test 4A: Kill Backend Mid-Flow
1. [ ] Start both backend and mobile app
2. [ ] Navigate to Clients screen (verify clients load)
3. [ ] **STOP THE BACKEND** (Ctrl+C in Terminal 1)
4. [ ] Go back to mobile app, navigate to Check-In screen
5. [ ] Fill out the form and tap Submit
6. [ ] **Expected:** Error message appears (e.g., "Network request failed")
7. [ ] Restart the backend (`npm run dev`)
8. [ ] Tap Submit again
9. [ ] **Expected:** Check-in submits successfully

### Test 4B: Wrong BASE_URL
1. [ ] Edit `fitnessgurusg-mobile/src/config/api.ts`
2. [ ] Change `BASE_URL` to `http://localhost:9999` (wrong port)
3. [ ] Restart Expo app
4. [ ] Navigate to Clients screen
5. [ ] **Expected:** 
   - Loading indicator appears
   - Error message appears: "Failed to load clients"
   - Retry button is visible
6. [ ] Fix `BASE_URL` back to `http://localhost:5001`
7. [ ] Tap **Retry** button
8. [ ] **Expected:** Clients load successfully

**Expected Result:** ✅ Error messages shown, retry logic works correctly

---

## 🗂️ TEST CASE 5: EMPTY STATES

**Objective:** Verify UI handles empty data gracefully

### Test 5A: No Clients (Empty Client List)
1. [ ] Clear all clients from MongoDB:
```bash
# In MongoDB shell or Compass
db.clients.deleteMany({})
```
2. [ ] Reload mobile app (shake device → Reload)
3. [ ] Navigate to Clients screen
4. [ ] **Expected:** 
   - "No clients found" message
   - "Add clients in the backend to get started" subtext

### Test 5B: No Check-Ins (Empty Insights)
1. [ ] Restore seed data (`npm run seed`)
2. [ ] Open mobile app, navigate to Insights tab directly
3. [ ] **Expected:**
   - "No check-in data yet" message
   - "Submit a check-in to see your insights here" subtext

**Expected Result:** ✅ Empty states display helpful messages

---

## 🔄 TEST CASE 6: REFRESH & RETRY LOGIC

**Objective:** Verify refresh and retry buttons work correctly

### Steps:
1. [ ] Navigate to Insights screen after submitting a check-in
2. [ ] Tap **Refresh** button
3. [ ] Verify loading indicator appears briefly
4. [ ] Kill backend, navigate to Clients screen, force error
5. [ ] Tap **Retry** button
6. [ ] Verify error message changes to indicate retry attempt
7. [ ] Restart backend
8. [ ] Tap **Retry** button again
9. [ ] Verify clients load successfully

**Expected Result:** ✅ Refresh and retry mechanisms work correctly

---

## 📱 TEST CASE 7: NAVIGATION FLOW

**Objective:** Verify navigation between screens works correctly

### Steps:
1. [ ] Start on Clients tab
2. [ ] Tap on a client
3. [ ] Verify navigation to Check-In screen with client name displayed
4. [ ] Submit check-in
5. [ ] Verify automatic navigation to Insights screen
6. [ ] Tap Clients tab at bottom
7. [ ] Verify navigation back to Clients screen
8. [ ] Select a different client
9. [ ] Verify Check-In screen shows the new client's name

**Expected Result:** ✅ Navigation is smooth and context is preserved

---

## 🎯 PHASE 5 ACCEPTANCE CRITERIA

**All tests must pass before proceeding to Phase 6 (Authentication)**

- [ ] Happy path works without errors
- [ ] Red flag detection triggers correctly
- [ ] Invalid input is rejected with clear error messages
- [ ] Backend failure shows error message with retry option
- [ ] Empty states display helpful messages
- [ ] Refresh/retry logic works correctly
- [ ] Navigation preserves context and shows correct client names

---

## 📝 RESULTS LOG

**Test Date:** _____________  
**Tester:** _____________  
**Environment:** _____________  

| Test Case | Status | Notes |
|-----------|--------|-------|
| Happy Path | ☐ Pass ☐ Fail |  |
| Red Flag Triggering | ☐ Pass ☐ Fail |  |
| Invalid Input | ☐ Pass ☐ Fail |  |
| Backend Failure | ☐ Pass ☐ Fail |  |
| Empty States | ☐ Pass ☐ Fail |  |
| Refresh/Retry | ☐ Pass ☐ Fail |  |
| Navigation | ☐ Pass ☐ Fail |  |

**Overall Result:** ☐ **PASS** ☐ **FAIL**

**Blocker Issues (if any):**
- 
- 

**Sign-off:** Phase 5 testing complete, safe to proceed to Phase 6 ☐ Yes ☐ No

---

## 📱 PHASE 7 MVP — ENGAGEMENT LOOP TEST CASES

**Purpose:** Verify the coach action queue, status badges, filter toggle, and reminder share functionality.

**Pre-requisite:** Phase 5 & 6 tests passing. At least one coach account and two clients in MongoDB.

---

### TEST CASE 8 — Status Badges Reflect Check-In State

**Objective:** Verify badges update correctly when a client checks in.

1. [ ] Log in and open the **Clients** tab
2. [ ] Verify each client shows either **"✓ Checked in"** (green) or **"⚠ Pending"** (amber)
3. [ ] Note a client shown as "⚠ Pending" — tap them and submit a check-in
4. [ ] Tap the **Clients** tab again
5. [ ] **Expected:** The same client now shows **"✓ Checked in"** (green badge)
6. [ ] Verify the badge changed without requiring an app restart

**Expected Result:** ✅ Badge updates automatically on return to Clients tab

---

### TEST CASE 9 — Filter Toggle: Needs Check-In

**Objective:** Verify the filter shows only pending clients.

1. [ ] Open the **Clients** tab — note the count shown on each filter tab
2. [ ] Tap **"Needs check-in (N)"** filter tab
3. [ ] **Expected:** Only clients without today's check-in are shown
4. [ ] If all clients have checked in: verify "All clients have checked in today" empty state appears
5. [ ] Tap **"All (N)"** filter tab
6. [ ] **Expected:** All clients visible again

**Expected Result:** ✅ Filter correctly hides/shows clients based on today's check-in status

---

### TEST CASE 10 — Reminder Share Message

**Objective:** Verify the reminder text is correct and the share sheet opens.

1. [ ] On the Clients tab, find a client showing **"⚠ Pending"**
2. [ ] Tap **"Share reminder"** below that client's name
3. [ ] **Expected:** Share sheet opens with message text similar to:
   > "Hi [Client Name], quick reminder to submit your check-in for today (20 Feb 2026) when you have a moment. Thank you!"
4. [ ] Verify the client's name appears correctly in the message
5. [ ] Verify the date is formatted as Singapore style: **"20 Feb 2026"** (not "2/20/2026")
6. [ ] Verify NO reminder button appears on clients who have already checked in

**Expected Result:** ✅ Reminder text is correct, date is Singapore-formatted, button hidden for checked-in clients

---

### TEST CASE 11 — Last Check-In Date Format

**Objective:** Verify the "Last:" date line is correctly formatted.

1. [ ] Open the Clients tab
2. [ ] For each client, verify the date line reads **"Last: 20 Feb 2026"** format
3. [ ] For a client with no previous check-ins, verify it shows **"Last: No check-in yet"**
4. [ ] Verify the date shown matches the last submitted check-in date in the database

**Expected Result:** ✅ Dates display in Singapore format, "No check-in yet" shown for new clients

---

### TEST CASE 12 — Empty State and Error Handling

**Objective:** Verify Phase 7 UI handles edge cases gracefully.

1. [ ] Stop the backend and open the Clients tab
2. [ ] **Expected:** Error state appears with Retry button
3. [ ] Restart backend and tap Retry
4. [ ] **Expected:** Client list loads with status badges
5. [ ] If all clients have checked in and filter is set to "Needs check-in":
   - **Expected:** "All clients have checked in today" message

**Expected Result:** ✅ Error states, retry logic, and empty filter states work correctly

---

---

### TEST CASE 13 — Logout and Re-Login (Status Retained)

**Objective:** Verify that logging out and back in shows the correct, current status without stale data.

1. [ ] Open the Clients tab and note the current badge states (Checked in / Pending)
2. [ ] Tap the **logout icon** (top-right of Clients screen)
3. [ ] Tap **Sign Out** on the confirmation dialog
4. [ ] **Expected:** App returns to Login screen immediately
5. [ ] Log in again with valid credentials
6. [ ] **Expected:** Clients tab loads fresh — badges match the state noted in step 1
7. [ ] Submit a check-in for one pending client, then log out and log back in
8. [ ] **Expected:** That client now shows **"Checked in"** after re-login (no stale cache)

**Expected Result:** ✅ Logout is immediate, re-login loads correct status with no stale data

---

## 🎯 PHASE 7 MVP ACCEPTANCE CRITERIA

**All 5 Phase 7 test cases must pass before proceeding to the next engagement feature.**

- [ ] Status badges correctly reflect today's check-in state (TC 8)
- [ ] Filter toggle shows/hides clients by check-in status (TC 9)
- [ ] Reminder share text is correct with Singapore date format (TC 10)
- [ ] Last check-in date displays in Singapore format with null fallback (TC 11)
- [ ] Logout and re-login shows fresh, correct status — no stale data (TC 13)

**Sign-off:** Phase 7 MVP engagement loop testing complete ☐ Yes ☐ No

---

## 📋 PHASE 7 EXECUTION LOG

**Run this after completing TC8–TC13. Do NOT mark Pass/Fail in advance.**

**Test Date:** _____________
**Tester:** _____________
**Backend URL:** http://localhost:5001
**Mobile:** Expo Go on iOS simulator / physical device
**Expo started:** `npx expo start` in `fitnessgurusg-mobile/`
**Coach account:** coach@test.com (or your registered account)

| TC | Description | Result | Notes |
|----|-------------|--------|-------|
| TC8 | Badge updates after check-in | ☐ Pass ☐ Fail | |
| TC9 | Filter toggle All / Pending | ☐ Pass ☐ Fail | |
| TC10 | Reminder share text + SG date | ☐ Pass ☐ Fail | |
| TC11 | Last check-in date SG format | ☐ Pass ☐ Fail | |
| TC12 | Error handling + retry | ☐ Pass ☐ Fail | |
| TC13 | Logout + re-login, status retained | ☐ Pass ☐ Fail | |

**Overall Phase 7 MVP result:** ☐ **PASS — safe to expand Phase 7** ☐ **FAIL — fix before proceeding**

**Blocking issues (if any):**
-
-

**Tester sign-off:** ___________________________ Date: _______________
