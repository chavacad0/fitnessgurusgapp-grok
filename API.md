# API Documentation

## Base URL
```
http://localhost:5001/api
```

---

## Endpoints

### 1. Health Check
Check if server and MongoDB are running.

**Endpoint:** `GET /api/health`

**Example:**
```bash
curl http://localhost:5001/api/health
```

**Response:**
```json
{
  "status": "ok",
  "mongodb": "connected",
  "timestamp": "2026-02-05T02:40:08.925Z"
}
```

---

### 2. Submit Check-In
Submit a daily check-in and automatically detect red flags.

**Endpoint:** `POST /api/clients/:clientId/checkins`

**Request Body:**
```json
{
  "date": "2026-02-06",        // YYYY-MM-DD format
  "energy": 8,                 // 1-10 scale
  "mood": 9,                   // 1-10 scale
  "workoutDone": true,         // boolean
  "notes": "Great workout!"    // optional string
}
```

**Example:**
```bash
curl -X POST http://localhost:5001/api/clients/test_harry/checkins \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2026-02-06",
    "energy": 9,
    "mood": 8,
    "workoutDone": true,
    "notes": "Feeling strong!"
  }'
```

**Success Response:**
```json
{
  "success": true,
  "checkin": {
    "client_id": "test_harry",
    "date": "2026-02-06",
    "energy": 9,
    "mood": 8,
    "workout_completed": true,
    "notes": "Feeling strong!",
    "_id": "69840b40e9ad2f07983cc407",
    "created_at": "2026-02-05T03:15:12.572Z"
  },
  "detectedFlags": [],
  "message": "Check-in saved, 0 red flag(s) detected"
}
```

**Error Response (validation):**
```json
{
  "success": false,
  "error": "Energy and mood must be between 1 and 10"
}
```

---

### 3. Fetch Check-Ins
Get recent check-ins for a client.

**Endpoint:** `GET /api/clients/:clientId/checkins?limit=7`

**Query Parameters:**
- `limit` (optional) - Number of check-ins to return (default: 7)

**Example:**
```bash
curl "http://localhost:5001/api/clients/test_harry/checkins?limit=5"
```

**Response:**
```json
{
  "success": true,
  "checkins": [
    {
      "_id": "6983fcc086bfde92271d462e",
      "client_id": "test_harry",
      "date": "2026-02-05",
      "energy": 7,
      "mood": 7,
      "hunger": 6,
      "workout_completed": true,
      "steps": 9084,
      "weight": 75,
      "notes": "Feeling great!",
      "created_at": "2026-02-05T02:13:20.003Z"
    }
    // ... more check-ins
  ],
  "count": 5
}
```

---

### 4. Fetch Red Flags
Get detected red flags for a client.

**Endpoint:** `GET /api/clients/:clientId/redflags?limit=20`

**Query Parameters:**
- `limit` (optional) - Number of red flags to return (default: 20)

**Example:**
```bash
curl "http://localhost:5001/api/clients/test_sarah/redflags?limit=10"
```

**Response:**
```json
{
  "success": true,
  "redFlags": [
    {
      "_id": "6983fcc086bfde92271d4631",
      "client_id": "test_sarah",
      "type": "LOW_ENERGY",
      "severity": "high",
      "message": "Low energy for 3 consecutive days",
      "detected_at": "2026-02-05T02:13:20.070Z",
      "related_check_ins": [
        "6983fcc086bfde92271d4629",
        "6983fcc086bfde92271d462c",
        "6983fcc086bfde92271d462f"
      ],
      "metadata": {
        "consecutive_days": 3
      }
    }
  ],
  "count": 1
}
```

---

### 5. Trigger Detection
Manually trigger red flag detection for a client.

**Endpoint:** `POST /api/clients/:clientId/redflags/detect`

**Example:**
```bash
curl -X POST http://localhost:5001/api/clients/test_ian/redflags/detect
```

**Response:**
```json
{
  "success": true,
  "flagsDetected": 1,
  "flags": [
    {
      "client_id": "test_ian",
      "type": "MISSED_WORKOUT",
      "severity": "medium",
      "message": "Missed workouts for 3 consecutive days",
      "detected_at": "2026-02-05T03:16:04.714Z",
      "related_check_ins": [
        "6983fcc086bfde92271d462a",
        "6983fcc086bfde92271d462d",
        "6983fcc086bfde92271d4630"
      ],
      "metadata": {
        "consecutive_days": 3
      },
      "_id": "69840b74e9ad2f07983cc408"
    }
  ]
}
```

---

## Red Flag Types

| Type | Severity | Trigger Condition |
|------|----------|-------------------|
| `LOW_ENERGY` | high | Energy ≤ 3 for 3 consecutive days |
| `MISSED_WORKOUT` | medium | Workout not completed for 3 consecutive days |
| `LOW_MOOD` | high | Mood ≤ 3 for 3 consecutive days |

---

## Quick Start

### 1. Start MongoDB
```bash
brew services list | grep mongodb
# Should show "started"
```

### 2. Seed Test Data
```bash
npm run test:redflags
```

### 3. Start API Server
```bash
npm run server:dev
```

### 4. Test Endpoints
```bash
# Health check
curl http://localhost:5001/api/health

# Submit check-in
curl -X POST http://localhost:5001/api/clients/test_harry/checkins \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-02-06","energy":9,"mood":8,"workoutDone":true}'

# Get check-ins
curl "http://localhost:5001/api/clients/test_harry/checkins?limit=5"

# Get red flags
curl "http://localhost:5001/api/clients/test_sarah/redflags"

# Manual detection
curl -X POST http://localhost:5001/api/clients/test_sarah/redflags/detect
```

---

## Error Handling

All endpoints return errors in this format:
```json
{
  "success": false,
  "error": "Error message here"
}
```

**Common HTTP Status Codes:**
- `200` - Success
- `400` - Bad request (validation error)
- `500` - Server error

---

## Mobile App Integration

### Example: React Native / Expo

```typescript
const API_URL = 'http://localhost:5001/api';

// Submit check-in
async function submitCheckIn(clientId: string, data: any) {
  const response = await fetch(
    `${API_URL}/clients/${clientId}/checkins`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }
  );
  return response.json();
}

// Fetch check-ins
async function getCheckIns(clientId: string, limit = 7) {
  const response = await fetch(
    `${API_URL}/clients/${clientId}/checkins?limit=${limit}`
  );
  return response.json();
}

// Fetch red flags
async function getRedFlags(clientId: string, limit = 20) {
  const response = await fetch(
    `${API_URL}/clients/${clientId}/redflags?limit=${limit}`
  );
  return response.json();
}
```

---

## Notes

- **CORS:** Enabled for local development
- **Auto-detection:** Happens automatically after each check-in submission
- **Data validation:** Energy and mood must be 1-10
- **Date format:** Must be YYYY-MM-DD
- **Port:** Default is 5001, configurable via PORT environment variable
