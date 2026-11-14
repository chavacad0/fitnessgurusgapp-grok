/**
 * Shared TypeScript types for the mobile app.
 * Single source of truth for API response shapes on the mobile side.
 *
 * These mirror the backend public types — update here when the API contract changes.
 */

// ─── Role ────────────────────────────────────────────────────────────────────

/**
 * The two supported roles in the app.
 * 'coach' → AppTabs (Clients / CheckIn / Insights)
 * 'client' → ClientAppTabs (Home / Progress / Profile)
 */
export type Role = 'coach' | 'client';

// ─── Auth ────────────────────────────────────────────────────────────────────

/**
 * Unified authenticated user — works for both coaches and clients.
 * Stored in AuthContext after a successful login.
 */
export interface AuthUser {
    id: string;         // MongoDB _id as string
    email: string;
    name: string;
    role: Role;
    clientId?: string;  // clients only; clients.id UUID used for API calls
    /** Clients only. False until an invitation code links them to a coach. */
    hasCoach?: boolean;
}

export interface LoginResponse {
    success: boolean;
    token: string;
    coach: CoachPublic;
}

/**
 * POST /api/auth/google response — discriminated by `role`.
 *  - Coaches get the coach profile (sub = coaches._id).
 *  - Clients get their canonical client record (sub = clients.id UUID).
 *    No coach object is returned for clients.
 */
export type GoogleLoginResponse =
    | { success: boolean; token: string; role: 'coach'; coach: CoachPublic; client?: undefined }
    | {
        success: boolean;
        token:   string;
        role:    'client';
        coach?:  undefined;
        client: {
            _id:       string;   // MongoDB ObjectId of the clients document
            id:        string;   // UUID — canonical client identifier
            email:     string;
            name:      string;
            coach_id:  string | null;
            has_coach: boolean;
        };
    };

// ─── Coach ───────────────────────────────────────────────────────────────────

export interface CoachPublic {
    _id: string;
    email: string;
    name: string;
    role: Role;
    createdAt: string;
}

// ─── Client ──────────────────────────────────────────────────────────────────

/**
 * Client as returned by GET /api/clients.
 * Matches the `ClientPublic` projection from the backend.
 */
export interface ClientPublic {
    _id?: string;
    id: string;
    name: string;
}

/**
 * Session plan status for a client.
 * Derived from the client's active coaching package.
 */
export type PlanStatus = 'active' | 'expiring_soon' | 'expired' | 'none';

/**
 * Client engagement + session status — returned by GET /api/clients/status.
 * Powers the coach action queue in ClientsScreen.
 *
 * Session fields are optional — they are populated when the client has
 * an active coaching package. They will be absent for clients not yet
 * assigned to a plan (existing API calls remain unaffected).
 */
export interface ClientStatusItem {
    // ── Check-in status ──────────────────────────────────────────────────────
    clientId: string;
    clientName: string;
    hasCheckedInToday: boolean;
    lastCheckInDate: string | null; // YYYY-MM-DD or null (no check-ins ever)
    streak: number;                 // consecutive days with check-ins; 0 if not checked in today

    // ── Missed check-in / pause state ────────────────────────────────────────
    /** Consecutive days WITHOUT a check-in (0 = checked in today or recently) */
    missed_checkin_streak?: number;
    /** 'paused' when missed_checkin_streak >= 3 or client explicitly paused */
    check_in_status?: 'active' | 'paused';
    /** undefined = not yet chosen; true = opted in; false = "not now" */
    check_in_reminders_enabled?: boolean;

    // ── Session plan fields (optional — populated when a plan is assigned) ──
    plan_name?: string;             // e.g. "Starter", "Progress", "Elite"
    plan_status?: PlanStatus;       // 'active' | 'expiring_soon' | 'expired' | 'none'
    sessions_total?: number;        // total sessions purchased in current plan
    sessions_used?: number;         // sessions completed so far
    sessions_remaining?: number;    // sessions_total - sessions_used
    expiry_date?: string;           // ISO date string (YYYY-MM-DD) — plan expiry
}

/**
 * Client-specific profile — returned by the client auth endpoint.
 */
export interface ClientUserProfile {
    _id: string;
    id: string;
    email: string;
    name: string;
    coach_id?: string | null;   // absent until the client connects with an invite code
    has_coach?: boolean;
}

/**
 * Response from POST /api/auth/client-login.
 */
export interface ClientLoginResponse {
    success: boolean;
    token: string;
    client: ClientUserProfile;
}

// ─── Check-In ────────────────────────────────────────────────────────────────

/**
 * Tracks which integration phase was used to capture nutrition data.
 *   'manual'     — Phase 1: client types values directly (MVP, implemented)
 *   'screenshot' — Phase 2: OCR from a MyFitnessPal screenshot (planned)
 *   'healthkit'  — Phase 3: Apple Health / Google Fit sync (future)
 */
export type NutritionSource = 'manual' | 'screenshot' | 'healthkit';

/**
 * Optional nutrition block sent with a check-in.
 * All macro fields are optional — a client can log calories-only, or skip entirely.
 */
export interface NutritionData {
    calories?: number;  // kcal
    protein?:  number;  // grams
    carbs?:    number;  // grams
    fat?:      number;  // grams
    source:    NutritionSource;
}

export interface CheckInRequest {
    date: string; // YYYY-MM-DD
    type: 'MANUAL' | 'AUTO_BOT' | 'RED_FLAG_RESPONSE';
    metrics: {
        energy: number;
        hunger: number;
        stepsToday?: number;
    };
    /** Phase 1 — manual nutrition input. Omit entirely if client skips nutrition. */
    nutrition?: NutritionData;
    notes?: string;
    /** Private photo links from upload, each `/api/photos/<id>`. */
    photos?: string[];
}

/**
 * A single persisted check-in record, as returned by the backend.
 *
 * Field names use snake_case to match the MongoDB document shape.
 * The DB stores client_id and coach_id — NOT clientId/coachId.
 */
export interface CheckIn {
    _id: string;
    client_id: string;  // snake_case — matches DB field name
    coach_id?: string;  // snake_case — matches DB field name (optional: not always stored)
    date: string;       // YYYY-MM-DD
    type: 'MANUAL' | 'AUTO_BOT' | 'RED_FLAG_RESPONSE';
    metrics: {
        energy: number;
        hunger: number;
        stepsToday?: number;
    };
    /** Populated when the client logged nutrition for this check-in. */
    nutrition?: NutritionData;
    notes?: string;
    /** Private photo links saved on this check-in. Each is `/api/photos/<id>`. */
    photos?: string[];
    createdAt: string;
    updatedAt?: string;
}

export interface CheckInResponse {
    success: boolean;
    checkin: CheckIn;
    detectedFlags: RedFlag[];
    message: string;
}

// ─── Red Flags ────────────────────────────────────────────────────────────────

/**
 * A single red flag record, as returned by the backend.
 */
export interface RedFlag {
    _id: string;
    client_id: string;  // snake_case — matches DB field name
    coach_id?: string;  // snake_case — matches DB field name
    date: string;       // YYYY-MM-DD
    type: string;       // e.g. 'LOW_ENERGY', 'MISSED_CHECKIN'
    severity: 'low' | 'medium' | 'high';
    resolved: boolean;
    notes?: string;
    createdAt: string;
    // Optional: populated by backend when flag is resolved
    message?: string;
    triggerCondition?: string;
    detectedAt?: string;
}

// ─── Booking (Future) ─────────────────────────────────────────────────────────

/**
 * A single availability window set by the coach.
 * Used to populate booking slots clients can reserve.
 * Backend endpoint: GET /api/coach/availability
 */
export interface CoachAvailabilitySlot {
    _id?: string;           // MongoDB ObjectId string (from backend)
    id: string;
    date: string;           // YYYY-MM-DD
    start_time: string;     // HH:MM (24h)
    end_time: string;       // HH:MM (24h)
    is_booked: boolean;
    booked_by_client_id?: string;
    /**
     * Display state: 'available' | 'booked' | 'blocked'.
     * Old docs without this field default to 'available'.
     * 'blocked' slots are hidden from clients by the backend.
     */
    status?: 'available' | 'booked' | 'blocked';
    /**
     * Coach-private reason for blocking — never shown to clients.
     * Only present in coach API responses.
     */
    blocked_reason?: string;
    source?: 'rules';
}

export interface AvailabilityRange {
    start: string;
    end: string;
}

export interface AvailabilityWeekday {
    day: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
    enabled: boolean;
    ranges: AvailabilityRange[];
}

export interface AvailabilityRules {
    timezone: 'Asia/Singapore';
    hours_saved: boolean;
    slot_length_minutes: 30 | 45 | 60 | 90;
    buffer_minutes: 0 | 10 | 15;
    weekdays: AvailabilityWeekday[];
    blocks: Array<{
        id: string;
        date: string;
        kind: 'range' | 'day_off';
        start?: string;
        end?: string;
        label?: string;
    }>;
    overrides: Array<{
        id: string;
        date: string;
        kind: 'extra' | 'closed';
        ranges?: AvailabilityRange[];
        note?: string;
        slot_count?: number;
    }>;
}

export type CoachScheduleItem =
    | { kind: 'open'; slot_id: string; start_time: string; end_time: string; duration_minutes: number }
    | {
        kind: 'booked';
        booking_id: string;
        client_id: string;
        client_name: string;
        start_time: string;
        end_time: string;
        status: 'booked' | 'completed' | 'cancelled';
        duration_minutes: number;
    }
    | { kind: 'blocked'; block_id: string; start_time: string; end_time: string; label: string; legacy: boolean }
    | { kind: 'day_off'; block_id: string; label: string }
    | { kind: 'closed'; override_id: string; note?: string };

export interface CoachSchedule {
    timezone: 'Asia/Singapore';
    date: string;
    hours_saved: boolean;
    slot_length_minutes: number;
    buffer_minutes: number;
    counts: { open: number; booked: number; done: number; missed: number };
    items: CoachScheduleItem[];
    month: Record<string, { open: number; booked: number; done: number; missed: number }>;
}

/**
 * A confirmed session booking between a coach and client.
 * Backend endpoint: POST /api/sessions/book
 *
 * Note: backend sends _id (MongoDB ObjectId). Both _id and id are handled
 * defensively throughout the app using `item._id ?? item.id`.
 */
export interface BookingSlot {
    _id?: string;           // MongoDB ObjectId string (from backend)
    id: string;             // legacy / fallback id
    coach_id: string;
    client_id: string;
    availability_slot_id: string;
    date: string;           // YYYY-MM-DD
    start_time: string;
    end_time: string;
    status: 'booked' | 'pending' | 'confirmed' | 'completed' | 'cancelled';
    notes?: string;
    created_at: string;
}

/**
 * Summary of the next upcoming session for a client.
 * Displayed on the dashboard.
 */
export interface NextSession {
    booking_id: string;
    date: string;           // YYYY-MM-DD
    start_time: string;
    end_time: string;
    client_name: string;
}

// ─── Session Status ───────────────────────────────────────────────────────────

/**
 * Response from GET /api/clients/:clientId/session-status.
 * Used for per-client badge rendering on the coach screen.
 */
export interface SessionStatusResponse {
    success: boolean;
    has_plan: boolean;
    plan_name?: string;
    plan_status?: PlanStatus;
    sessions_total?: number;
    sessions_used?: number;
    sessions_remaining?: number;
    expiry_date?: string;   // YYYY-MM-DD
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

/**
 * Response from GET /api/coach/dashboard.
 */
export interface DashboardSummary {
    total_clients: number;
    pending_payments_count: number;
    low_session_clients: Array<{
        client_id: string;
        client_name: string;
        sessions_remaining: number;
        expiry_date: string;
    }>;
    expiring_clients: Array<{
        client_id: string;
        client_name: string;
        sessions_remaining: number;
        expiry_date: string;
        days_until_expiry: number;
    }>;
    today_bookings: Array<{
        booking_id: string;
        client_id: string;
        client_name: string;
        start_time: string;
        end_time: string;
        status: 'booked' | 'completed' | 'cancelled';
    }>;
}

export interface QuickBookPayload {
    client_id: string;
    date: string;       // YYYY-MM-DD
    start_time: string; // HH:MM
    end_time: string;   // HH:MM
    notes?: string;
}

/**
 * Lightweight per-date summary used by MonthCalendar for dot indicators.
 * Populated from GET /api/coach/availability?from=YYYY-MM-01 response.
 */
export interface DaySummary {
    date: string;           // YYYY-MM-DD
    openCount?: number;     // open (unbooked) availability slots
    bookedCount?: number;   // booked sessions
    doneCount?: number;     // completed sessions
    missedCount?: number;   // cancelled/missed sessions
}


// ─── Plan Assignment ──────────────────────────────────────────────────────────

/**
 * Payload for POST /api/clients/:clientId/plan.
 * Assigns a new session package to a client.
 */
export interface ClientPlanAssignment {
    plan_name: string;       // e.g. "Starter", "Progress", "Elite" — freeform
    sessions_total: number;  // total sessions in package
    start_date: string;      // YYYY-MM-DD
    expiry_date: string;     // YYYY-MM-DD
}

// ─── Payment ──────────────────────────────────────────────────────────────────

export type PaymentMethod = 'cash' | 'bank_transfer' | 'paynow' | 'other';
export type PaymentStatus = 'pending' | 'confirmed' | 'refunded';

/**
 * A payment record as returned by the API.
 * Mirrors the backend Payment interface.
 */
export interface Payment {
    _id: string;
    client_id: string;
    coach_id: string;
    plan_id: string;
    plan_name: string;
    amount_sgd: number;
    sessions_granted: number;
    payment_method: PaymentMethod;
    reference?: string;
    status: PaymentStatus;
    paid_at?: string;           // ISO date string when status = confirmed
    plan_assigned_id?: string;
    notes?: string;
    created_at: string;
    updated_at: string;
}

// ─── Plan Catalogue ───────────────────────────────────────────────────────────

/**
 * A single plan definition from GET /api/plans.
 * Mirrors SESSION_PLANS entries in backend src/config/plans.ts.
 */
export interface SessionPlanCatalogue {
    id: 'starter' | 'performance' | 'elite';
    name: string;
    sessions: number;
    price_sgd: number;
    expiry_days: number;
    description: string;
    badge_color: string;
}

export type PlanId = SessionPlanCatalogue['id'];


// ─── Workout Assignment (coach-created) ───────────────────────────────────────

/**
 * A single exercise inside a coach-assigned workout.
 * ALL fields are read-only for the client — only the coach can set these.
 */
export interface WorkoutExercise {
    id:             string;   // stable UUID — referenced by ExerciseLog.exercise_id
    name:           string;   // coach-assigned, client cannot edit
    target_sets:    number;
    target_reps:    number;
    target_weight?: number;   // kg, optional
    notes?:         string;   // coach tip, read-only for client
}

/**
 * A workout assigned by the coach to a client for a specific date.
 * Client can read but cannot modify any field.
 */
export interface WorkoutAssignment {
    _id:       string;        // MongoDB ObjectId as string
    coach_id:  string;
    client_id: string;
    date:      string;        // YYYY-MM-DD
    title:     string;
    exercises: WorkoutExercise[];
    created_at: string;
    updated_at: string;
}

// ─── Workout Log (client-created) ────────────────────────────────────────────

/**
 * Client's performance record for a single assigned exercise.
 * exercise_id references WorkoutExercise.id from the assignment.
 * Backend validates that exercise_id exists in the assignment.
 * Backend IGNORES any submitted name/target fields (security boundary).
 */
export interface ExerciseLog {
    exercise_id:    string;
    completed:      boolean;
    actual_sets?:   number;
    actual_reps?:   number;
    actual_weight?: number;   // kg
    difficulty?:    number;   // 1–10
    notes?:         string;
}

/**
 * A client's workout log for one assignment.
 * Upserted — client can re-submit to update their log for the day.
 */
export interface WorkoutLog {
    _id:           string;
    assignment_id: string;
    client_id:     string;
    date:          string;    // YYYY-MM-DD
    exercise_logs: ExerciseLog[];
    created_at:    string;
    updated_at:    string;
}

/**
 * Combined response from GET /api/clients/me/workout/today.
 * assignment: null → no workout assigned today (check-in still works normally).
 * log: null       → workout assigned but client hasn't logged yet.
 */
export interface WorkoutAssignmentWithLog {
    success:    boolean;
    assignment: WorkoutAssignment | null;
    log:        WorkoutLog | null;
}

// ─── Workout History ──────────────────────────────────────────────────────────

/**
 * A single entry from GET /api/clients/me/workout/history.
 * Pairs a coach-assigned workout with the client's performance log.
 */
export interface WorkoutHistoryEntry {
    assignment: WorkoutAssignment;
    log:        WorkoutLog | null;
}

/**
 * Response from GET /api/clients/me/workout/history.
 */
export interface WorkoutHistoryResponse {
    success: boolean;
    entries: WorkoutHistoryEntry[];
}
