# 🔄 FRESH INSTALL VERIFICATION CHECKLIST

**Purpose:** Ensure the app works correctly from a clean state without cached data or residual configuration.

**When to run this:**
- Before deploying to production
- After major backend changes
- When debugging persistent state issues
- Before handing off to QA or stakeholders

---

## 📱 MOBILE APP — FRESH INSTALL

### Option 1: Clear Expo Cache (Recommended for Development)

```bash
# Navigate to mobile directory
cd /Users/admin/Fitnessprac/fitnessgurusg-mobile

# Clear Expo cache
npx expo start --clear

# OR use the shortcuts after starting:
# Shift + R = Reload app
# Shift + M = Toggle menu
```

### Option 2: Full Reinstall (iOS Simulator)

1. [ ] **Delete the app from simulator:**
   - Long-press the app icon on simulator
   - Tap the "x" to delete
   - Or use: `xcrun simctl uninstall booted com.yourcompany.fitnessgurusg`

2. [ ] **Clear Expo global cache:**
   ```bash
   rm -rf ~/.expo
   rm -rf node_modules/.cache
   ```

3. [ ] **Reinstall:**
   ```bash
   cd /Users/admin/Fitnessprac/fitnessgurusg-mobile
   npm start
   # Press 'i' for iOS simulator
   ```

### Option 3: Full Reinstall (Android Emulator)

1. [ ] **Uninstall from emulator:**
   ```bash
   adb uninstall com.yourcompany.fitnessgurusg
   ```

2. [ ] **Clear cache and reinstall:**
   ```bash
   cd /Users/admin/Fitnessprac/fitnessgurusg-mobile
   rm -rf android/.gradle
   npx expo start --clear
   # Press 'a' for Android emulator
   ```

---

## 🖥️ BACKEND — FRESH START

### 1. Restart Backend Server

```bash
# Stop current backend (Ctrl+C in terminal)

# Restart from project root
cd /Users/admin/Fitnessprac
npm run dev

# Verify startup logs show:
# ✅ Connected to MongoDB
# ✅ Server running on http://localhost:5001
```

### 2. Reset MongoDB Data (Optional — Use with caution)

**⚠️ WARNING: This will DELETE all data**

```bash
# Option A: Drop entire database
# In MongoDB shell or Compass:
use fitnessgurusg
db.dropDatabase()

# Option B: Clear specific collections
db.checkins.deleteMany({})
db.redflags.deleteMany({})
db.clients.deleteMany({})

# Then re-seed:
cd /Users/admin/Fitnessprac
npm run seed
```

### 3. Verify MongoDB Connection

```bash
# Test with curl
curl http://localhost:5001/api/health

# Expected response:
# {"status":"ok","mongodb":"connected","timestamp":"..."}
```

---

## ✅ FRESH INSTALL END-TO-END TEST

After performing fresh install, verify the complete flow:

1. [ ] **Backend is running** (`npm run dev` shows MongoDB connected)

2. [ ] **Mobile app launches** (no crash, no errors in terminal)

3. [ ] **Clients Screen loads**
   - [ ] Loading indicator appears
   - [ ] Client list displays (if seed data exists)
   - [ ] OR "No clients found" message (if DB is empty)

4. [ ] **Select a client** (if seed data exists)
   - [ ] Navigation to Check-In screen works
   - [ ] Client name displays correctly

5. [ ] **Submit a check-in**
   - [ ] Energy/Hunger sliders work
   - [ ] Submit button works
   - [ ] Navigation to Insights screen works
   - [ ] Check-in data displays correctly

6. [ ] **Verify backend logs** (should show timestamps and route names)
   ```
   [2026-02-06T09:30:00.000Z] [GET /clients] Fetching all clients
   [2026-02-06T09:30:00.100Z] [GET /clients] ✅ Retrieved 3 clients
   [2026-02-06T09:30:15.000Z] [POST /checkins] Received check-in for client: client_alice
   [2026-02-06T09:30:15.200Z] [POST /checkins] ✅ Check-in created for client_alice
   ```

7. [ ] **Red flag detection works** (submit 3 low-energy check-ins)
   - [ ] Backend logs show: `🚩 X red flag(s) detected for client_xxx`
   - [ ] Insights screen shows red flag warning

---

## 🐛 COMMON ISSUES

### Mobile app won't connect to backend

**Symptom:** "Failed to load clients" error immediately

**Solution:**
1. Verify backend is running on port 5001
2. Check `fitnessgurusg-mobile/src/config/api.ts` has correct `BASE_URL`
   - For iOS simulator: `http://localhost:5001`
   - For Android emulator: `http://10.0.2.2:5001`
3. Restart both backend and mobile app

### MongoDB connection fails

**Symptom:** Backend logs show "Failed to connect to MongoDB"

**Solution:**
1. Verify MongoDB is running: `brew services list | grep mongodb`
2. Start MongoDB: `brew services start mongodb-community`
3. Test connection: `mongosh`

### Expo won't start or shows cache errors

**Symptom:** "Unable to resolve module" or "Metro bundler failed"

**Solution:**
```bash
cd fitnessgurusg-mobile
rm -rf node_modules
npm install
npx expo start --clear
```

---

## ✅ SIGN-OFF

**Fresh install verification completed:** ☐ Yes ☐ No

**Date:** _____________  
**Tested by:** _____________  
**Environment:** ☐ iOS Simulator ☐ Android Emulator ☐ Physical Device

**Issues found:**
- 
- 

**Resolution:**
- 
- 

**Safe to proceed to next phase:** ☐ Yes ☐ No
