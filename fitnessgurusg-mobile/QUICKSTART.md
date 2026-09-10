# 🚀 Quick Start Guide - Mobile App

## Start the App (3 Steps)

### 1️⃣ Start Backend
```bash
cd /Users/admin/Fitnessprac
npm run dev
```
Backend runs on port 5001

### 2️⃣ Configure API URL
Edit `src/config/api.ts`:
- **iOS Simulator:** `http://localhost:5001` (default)
- **Android Emulator:** `http://10.0.2.2:5001`
- **Physical Phone:** `http://YOUR_IP:5001`

Find your IP:
```bash
ipconfig getifaddr en0
```

### 3️⃣ Start Expo
```bash
cd /Users/admin/Fitnessprac/fitnessgurusg-mobile
npx expo start
```

Then press:
- **i** for iOS Simulator
- **a** for Android Emulator
- Scan QR with Expo Go for physical device

## Test Backend Connection
1. App opens to **Clients** tab
2. Tap **"Test Backend Connection"**
3. Should see green success box with JSON response

## Success Output
```json
{
  "status": "ok",
  "timestamp": "2026-02-05T06:35:42.123Z"
}
```

## Troubleshooting
- **Network request failed** → Wrong BASE_URL for your device
- **Backend not running** → Start with `npm run dev` in backend folder
- **iOS simulator:** Use `localhost:5001`
- **Android emulator:** Use `10.0.2.2:5001`
- **Physical device:** Use your computer's IP address

---

📖 See [walkthrough.md](file:///Users/admin/.gemini/antigravity/brain/a7d600b7-e6d4-437f-8cf8-56b231bdd749/walkthrough.md) for full documentation
