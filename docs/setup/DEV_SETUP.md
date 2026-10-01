# DEV_SETUP.md — FitnessGuruSG Local Development Guide

> This is the authoritative guide for running the project from a clean state.
> Read this first before touching `.env` files or rebuilding the app.

---

## 1. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | ≥ 18 | `node -v` |
| npm | ≥ 9 | `npm -v` |
| MongoDB | running locally | `mongosh --eval "db.adminCommand('ping')"` |
| Expo CLI | bundled | `npx expo --version` |
| Xcode | ≥ 14 | For iOS simulator (macOS only) |

---

## 2. Start the Backend

```bash
cd ~/Fitnessprac2
npm run server
```

Expected output on healthy start:
```
✅ Environment validated
✅ GOOGLE_CLIENT_ID loaded (961130275460-k...)
✅ MongoDB connected
✅ Server running on http://localhost:5001
```

If you see `❌ FATAL: JWT_SECRET too short` — the `.env` value is too short (< 32 chars).
Generate a new one:
```bash
openssl rand -hex 32
```
Then paste it into `.env` as `JWT_SECRET=<output>` and restart.

---

## 3. Fix the LAN IP (do this every time your network changes)

The iOS Simulator cannot reach `localhost` — it resolves to the simulator itself, not your Mac.
You must use your Mac's real LAN IP.

**Step 1 — Find your current IP:**
```bash
ipconfig getifaddr en0
```
Example output: `192.168.1.45`

**Step 2 — Update the mobile `.env`:**
```
# fitnessgurusg-mobile/.env
EXPO_PUBLIC_API_URL=http://192.168.1.45:5001
```

**Step 3 — Rebuild the app (hot-reload is NOT enough for `.env` changes):**
```bash
cd ~/Fitnessprac2/fitnessgurusg-mobile
npx expo run:ios
```

> ⚠️ Metro's hot-reload does **not** pick up `.env` file changes. You must do a full rebuild
> any time you change `EXPO_PUBLIC_*` values.

---

## 4. Clear Metro Cache (do this when you see old/stale errors)

If you see a crash error that you know has been fixed in source (e.g. `planModal doesn't exist`),
Metro is serving a stale bundle. Force a clean rebuild:

```bash
cd ~/Fitnessprac2/fitnessgurusg-mobile

# Option A — fastest (clean Metro cache only)
npx expo start --clear

# Option B — full clean rebuild (use when Option A doesn't fix it)
rm -rf ios/build
npx expo run:ios --no-build-cache
```

Inside the running simulator you can also:
- Shake the device → **Reload**
- Or press `r` in the Metro terminal

---

## 5. Environment Files Overview

### Backend: `Fitnessprac2/.env`

| Variable | Purpose | Status |
|---|---|---|
| `MONGO_URI` | Local MongoDB connection | ✅ Set |
| `JWT_SECRET` | Signs auth tokens (min 32 chars) | ✅ Rotated 2026-04-17 |
| `GOOGLE_CLIENT_ID` | Verifies Google ID tokens server-side | ✅ Set |
| `PORT` | Server port (default: 5001) | Optional |
| `CORS_ORIGIN` | Allowed origins (default: localhost:8081) | Optional |

### Mobile: `fitnessgurusg-mobile/.env`

| Variable | Purpose | Status |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | Dev backend URL (LAN IP) | ⚠️ Update when IP changes |
| `EXPO_PUBLIC_API_URL_PROD` | Prod backend URL | ❌ Not deployed yet |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Google OAuth web client ID | ✅ Set |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | Google OAuth iOS client ID | ✅ Set |

> ⚠️ Both `.env` files are git-ignored. Never commit real secrets to git.
> Share them with teammates via a secure channel (1Password, encrypted Slack DM, etc.).

---

## 6. Rotating the JWT Secret

When rotating the secret (e.g. before production deployment, or if it's been compromised):

```bash
# Generate a new secret
openssl rand -hex 32

# Paste into Fitnessprac2/.env:
JWT_SECRET=<new value>

# Restart the backend
npm run server
```

**Effect:** All existing session tokens are immediately invalidated. All users (coaches + clients)
will be logged out and prompted to sign in again. This is expected and safe.

---

## 7. Verifying the Setup is Healthy

```bash
# 1. Backend health check (should return { status: 'ok', mongodb: 'connected' })
curl http://localhost:5001/api/health

# 2. Test login (replace with a real coach email/password from your DB)
curl -X POST http://localhost:5001/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"coach@example.com","password":"yourpassword"}'

# 3. Verify the token works (replace TOKEN with the jwt from step 2)
curl http://localhost:5001/api/clients \
     -H "Authorization: Bearer TOKEN"
```

---

## 8. Before Any External Testing (Handoff / Beta)

- [ ] Update `EXPO_PUBLIC_API_URL` to the tester's reachable IP (or a deployed URL)
- [ ] Confirm `JWT_SECRET` is not the old dev placeholder
- [ ] Confirm MongoDB has real test data (not empty)
- [ ] Run `npx expo run:ios` fresh — do not share a stale bundle
- [ ] Share `.env` values securely (NOT via git, email, or Slack public channels)

---

## 9. Before Production Deployment (Phase 9 Checklist)

- [ ] Provision a cloud server (Railway / Render / VPS)
- [ ] Provision MongoDB Atlas cluster
- [ ] Set `MONGO_URI` to Atlas connection string (not `127.0.0.1`)
- [ ] Generate a new `JWT_SECRET` on the production host: `openssl rand -hex 32`
- [ ] Set `CORS_ORIGIN` to your production frontend/mobile origin
- [ ] Set `EXPO_PUBLIC_API_URL_PROD` to your live backend URL
- [ ] Build a production Expo binary (`eas build`)
- [ ] Never store secrets in environment variables committed to git
- [ ] Delete or archive `requiresPro.ts` (it is a no-op dead file)
