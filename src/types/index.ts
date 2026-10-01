/**
 * Shared TypeScript types for the application.
 * This is the SINGLE SOURCE OF TRUTH for all shared interfaces.
 * Do NOT redefine these in repositories, routes, or services.
 */

// ─── Client ─────────────────────────────────────────────────────────────────

/**
 * Plan lifecycle status on the client document.
 * Tracks the client-side view of the payment + plan activation state machine.
 *
 *  none            → client has no plan selected
 *  selected        → client has picked a plan, not yet paid
 *  payment_pending → payment intent created, awaiting provider confirmation
 *  active          → plan is live (payment confirmed + ClientPlan created)
 *  expired         → plan ran out of sessions or past expiry_date
 *  cancelled       → coach or client cancelled
 */
export type ClientPlanStatus =
    | 'none'
    | 'selected'
    | 'payment_pending'
    | 'active'
    | 'expired'
    | 'cancelled';

/**
 * Canonical Client interface — imported everywhere (backend repos, services, routes).
 *
 * Design note:
 *  - Coach-provisioned clients (old MVP): have no password_hash. Login is email-only.
 *  - Self-registered clients (new flow): have password_hash. Login requires email + password.
 *  - plan_status / selected_plan_id are lightweight fast-read fields on the client doc.
 *    The authoritative plan record lives in client_plans collection.
 */
export interface Client {
    _id?: string;
    id: string;              // UUID string — canonical client identifier in all queries
    name: string;
    email: string;
    coach_id: string;

    // ── Auth (self-registered clients only) ──────────────────────────────────
    /** bcrypt hash — present for self-registered clients, absent for coach-provisioned */
    password_hash?: string;

    // ── Plan state (denormalised for fast dashboard reads) ────────────────────
    /** Current plan lifecycle status. Defaults to 'none'. */
    plan_status?: ClientPlanStatus;
    /** plan_id ('starter' | 'performance' | 'elite') of the selected/active plan */
    selected_plan_id?: string;
    /** payment_intent_id from the payment provider — used to verify payment */
    payment_intent_id?: string;

    // ── Body profile (stable fitness info — NOT daily check-in data) ──────────
    /**
     * These fields are set by the client on their Profile tab.
     * They are stable (change rarely) unlike daily check-in metrics.
     * All optional — clients who haven't filled them in have no default.
     */
    /** Height in centimetres, e.g. 160 */
    height_cm?: number;
    /** Current body weight in kilograms, e.g. 65.5 */
    weight_kg?: number;
    /** Client's stated fitness goal, e.g. "Fat loss and strength" */
    fitness_goal?: string;
    /** Known injuries or health notes, e.g. "Knee pain left side" */
    injuries_notes?: string;
    /**
     * Training background.
     * Accepts the three canonical values OR a free-form string for coaches
     * who prefer custom labels.
     */
    training_experience?: 'beginner' | 'intermediate' | 'advanced' | string;

    // ── Body measurements (cm) — optional tape-measure values ─────────────
    /** Neck circumference in cm */
    neck_cm?: number;
    /** Chest / bust circumference in cm */
    chest_cm?: number;
    /** Waist circumference in cm */
    waist_cm?: number;
    /** Hips circumference in cm */
    hips_cm?: number;
}

/**
 * Safe client shape returned by the API.
 */
export type ClientPublic = Pick<Client, '_id' | 'id' | 'name'>;

// ─── Coach ───────────────────────────────────────────────────────────────────

export interface Coach {
    _id?: string;
    name: string;
    email: string;
    whatsapp_number?: string;
}

// ─── Check-In ────────────────────────────────────────────────────────────────

export type CheckInType = 'MANUAL' | 'AUTO_BOT' | 'RED_FLAG_RESPONSE';

/**
 * Nutrition data source — tracks the integration phase used to capture macros.
 *   'manual'    — Phase 1: client types values directly (MVP)
 *   'screenshot' — Phase 2: derive from a MyFitnessPal screenshot (OCR, future)
 *   'healthkit'  — Phase 3: Apple Health / Google Fit sync (future)
 */
export type NutritionSource = 'manual' | 'screenshot' | 'healthkit';

/**
 * Daily nutrition breakdown attached to a check-in.
 * All values are optional so a client can submit a check-in without nutrition data.
 */
export interface NutritionData {
    calories?: number;   // kcal — total daily intake
    protein?:  number;   // grams
    carbs?:    number;   // grams
    fat?:      number;   // grams
    source:    NutritionSource;
}

export interface CheckIn {
    _id?: string;
    client_id: string;
    date: string;               // ISO format YYYY-MM-DD

    type: CheckInType;
    createdAt?: Date;
    flaggedForReview?: boolean;

    metrics?: {
        energy: number;         // 1–10
        hunger: number;         // 1–10
        stepsToday?: number;
    };

    /**
     * Phase 1 — Manual nutrition input.
     * Phase 2 — Populated after OCR on a screenshot (future).
     * Phase 3 — Synced from Apple Health / Google Fit (future).
     * Absent when the client did not log nutrition for this check-in.
     */
    nutrition?: NutritionData;

    notes?: string;
    botMessageSent?: string;
    clientResponse?: string;

    /**
     * @deprecated Legacy flat schema — present for backward DB compatibility only.
     * All NEW code must read/write via metrics.energy, metrics.hunger, metrics.stepsToday.
     */
    energy?: number;
    hunger?: number;
    mood?: number;
    workout_completed?: boolean;
    steps?: number;
    weight?: number;
}

// ─── Red Flag ────────────────────────────────────────────────────────────────

export interface RedFlag {
    _id?: string;
    client_id: string;
    type: 'LOW_ENERGY' | 'MISSED_WORKOUT' | 'LOW_MOOD' | 'HIGH_HUNGER_WITH_LOW_ACTIVITY' | 'WORK_FATIGUE';
    severity: 'low' | 'medium' | 'high';
    message: string;
    detectedAt: Date;
    triggerCondition?: string;
    related_check_ins?: string[];
    metadata?: {
        consecutive_days?: number;
        average_value?: number;
    };
}

// ─── Automated Rules ─────────────────────────────────────────────────────────

export interface AutomatedRule {
    _id?: string;
    coach_id: string;
    trigger_type: 'red_flag' | 'daily_reminder' | 'missed_checkin';
    message_template: string;
    is_active: boolean;
}

// ─── Session Plan ────────────────────────────────────────────────────────────

/**
 * Plan status — derived at read time, never stored.
 * 'expiring_soon' = sessions_remaining <= 2 OR expiry within 7 days.
 */
export type PlanStatus = 'active' | 'expiring_soon' | 'expired' | 'none';

/**
 * A coaching session package assigned to a client.
 * Stored in the 'client_plans' collection.
 *
 * sessions_remaining is derived: sessions_total - sessions_used.
 * It is NOT stored to avoid drift — always compute it at read time.
 */
export interface ClientPlan {
    _id?: string;
    client_id: string;      // references Client.id
    coach_id: string;       // references Coach._id (ownership)
    plan_name: string;      // e.g. "Starter", "Progress", "Elite" — freeform label
    sessions_total: number; // total sessions purchased
    sessions_used: number;  // sessions completed (incremented by completeSession)
    start_date: string;     // YYYY-MM-DD
    expiry_date: string;    // YYYY-MM-DD — plan expires on this date (inclusive)
    status: 'active' | 'expired' | 'cancelled';  // admin-level status; derived plan_status is separate
    created_at: Date;
    updated_at: Date;
}

// ─── Coach Availability ──────────────────────────────────────────────────────

/**
 * A single time window the coach has marked as available.
 * Stored in the 'coach_availability' collection.
 */
export interface CoachAvailabilitySlot {
    _id?: string;
    coach_id: string;       // references Coach._id
    date: string;           // YYYY-MM-DD (Asia/Singapore date)
    start_time: string;     // HH:MM (24h, SGT)
    end_time: string;       // HH:MM (24h, SGT)
    is_booked: boolean;     // true once a Booking references this slot (atomic concurrency lock)
    booked_by_client_id?: string;  // set when is_booked = true
    /**
     * Display state for the slot.
     * 'available' — coach is free, clients can book
     * 'booked'    — a client has reserved this slot
     * 'blocked'   — coach has marked this time unavailable; hidden from clients
     *
     * Old documents without this field default to 'available' in all reads.
     */
    status?: 'available' | 'booked' | 'blocked';
    /**
     * Private coach note — reason for blocking this slot.
     * NEVER returned to clients. Examples: 'Lunch break', 'Personal appointment'.
     */
    blocked_reason?: string;
    created_at: Date;
}

// ─── Booking ─────────────────────────────────────────────────────────────────

/**
 * A confirmed session booking between a coach and a client.
 * Stored in the 'bookings' collection.
 *
 * Lifecycle: booked → completed (session auto-deducted) | cancelled
 * A completed booking automatically decrements sessions_used on the client's plan.
 */
export interface Booking {
    _id?: string;
    coach_id: string;                // references Coach._id
    client_id: string;               // references Client.id
    availability_slot_id: string;    // references CoachAvailabilitySlot._id
    date: string;                    // YYYY-MM-DD
    start_time: string;              // HH:MM
    end_time: string;                // HH:MM
    status: 'booked' | 'completed' | 'cancelled';
    notes?: string;
    created_at: Date;
    updated_at: Date;
}

// ─── Payment ─────────────────────────────────────────────────────────────────

export type PaymentMethod = 'cash' | 'bank_transfer' | 'paynow' | 'other';
export type PaymentStatus = 'pending' | 'confirmed' | 'refunded';

/**
 * A payment record created when a coach initiates or a client requests a plan purchase.
 * Stored in the 'payments' collection.
 *
 * Lifecycle:
 *   pending  → coach marks received → confirmed (triggers assignPlanToClient)
 *   confirmed → coach issues refund → refunded
 *
 * On confirmation:
 *   - assignPlanToClient() is called atomically
 *   - plan_assigned_id is set to the resulting ClientPlan._id
 *
 * Stripe-readiness:
 *   stripe_payment_intent_id is reserved for Phase 10.
 *   When Stripe is added, 'pending' will also cover "payment_intent created but not captured".
 */
export interface Payment {
    _id?: string;
    client_id: string;              // references Client.id
    coach_id: string;               // references Coach._id (coach who handles payment)
    plan_id: string;                // 'starter' | 'performance' | 'elite'
    plan_name: string;              // denormalised: "Starter Pack" etc.
    amount_sgd: number;             // e.g. 1900 (Starter), 3500 (Performance), 4800 (Elite)
    sessions_granted: number;       // e.g. 10 — matches plan definition
    payment_method: PaymentMethod;
    reference?: string;             // optional: bank ref, PayNow txn ID, receipt number
    status: PaymentStatus;
    paid_at?: Date;                 // set when status → 'confirmed'
    plan_assigned_id?: string;      // MongoDB _id of the ClientPlan created on confirmation
    notes?: string;                 // optional coach note
    created_at: Date;
    updated_at: Date;
    // stripe_payment_intent_id?: string;  // ← reserved for Phase 10
}


/**
 * Coach dashboard summary — returned by GET /api/coach/dashboard.
 */
export interface DashboardSummary {
    total_clients: number;
    pending_payments_count: number;          // payments awaiting coach confirmation
    low_session_clients: Array<{
        client_id: string;
        client_name: string;
        sessions_remaining: number;
        expiry_date: string;
    }>;
    expiring_clients: Array<{               // active plans expiring within 7 days
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
        status: Booking['status'];
    }>;
}

