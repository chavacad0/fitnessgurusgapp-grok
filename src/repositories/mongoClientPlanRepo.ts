import { ObjectId } from 'mongodb';
import { getDb } from '../db/mongo';
import { ClientPlan, PlanStatus } from '../types';

/**
 * Client Plan Repository — all DB access for the client_plans collection.
 *
 * Business rules enforced here:
 *  - Only ONE plan per client can have status 'active' at a time.
 *  - sessions_remaining is DERIVED (sessions_total - sessions_used), never stored.
 *  - deductSession() uses a single atomic findOneAndUpdate with $inc — no race conditions.
 *  - A plan cannot be deducted below 0 sessions (conditional $inc with $expr guard).
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compute the derived plan_status from a ClientPlan document.
 * Called at READ time — status is never stored.
 *
 * Rules:
 *  'expired'       → expiry_date is in the past (compared to today SGT)
 *  'expiring_soon' → sessions_remaining <= 2 OR expiry within 7 days
 *  'active'        → otherwise
 */
export function computePlanStatus(plan: ClientPlan): PlanStatus {
    if (plan.status !== 'active') return 'expired';

    const todaySGT = getTodaySGT();
    if (plan.expiry_date < todaySGT) return 'expired';

    const daysLeft = daysUntil(plan.expiry_date, todaySGT);
    const sessionsRemaining = plan.sessions_total - plan.sessions_used;

    if (sessionsRemaining <= 0) return 'expired';
    if (sessionsRemaining <= 2 || daysLeft <= 7) return 'expiring_soon';

    return 'active';
}

/** Returns today's date as YYYY-MM-DD in Asia/Singapore timezone. */
function getTodaySGT(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

/** Days from todayStr to targetDate (positive = future). */
function daysUntil(targetDate: string, todayStr: string): number {
    const today  = new Date(`${todayStr}T00:00:00+08:00`);
    const target = new Date(`${targetDate}T00:00:00+08:00`);
    return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Returns the active ClientPlan for a client, or null if none exists.
 * "Active" = status === 'active' AND expiry_date >= today.
 *
 * A client can only have one active plan at a time.
 */
export async function getActivePlanForClient(clientId: string): Promise<ClientPlan | null> {
    const db    = await getDb();
    const today = getTodaySGT();

    // Sort by created_at descending — guarantees the newest active plan is returned
    // in the unlikely event two active records coexist (e.g. rapid double-upgrade).
    const plan = await db.collection<ClientPlan>('client_plans').findOne(
        {
            client_id: clientId,
            status:    'active',
            expiry_date: { $gte: today },
        },
        { sort: { created_at: -1 } }
    );

    return plan ?? null;
}


/**
 * Returns all plans for a client (active + expired + cancelled), newest first.
 * Used for plan history view.
 */
export async function getAllPlansForClient(clientId: string): Promise<ClientPlan[]> {
    const db = await getDb();
    return db.collection<ClientPlan>('client_plans')
        .find({ client_id: clientId })
        .sort({ created_at: -1 })
        .toArray();
}

/**
 * Returns all active plans for a coach's clients.
 * Used by the dashboard to find low-session clients.
 */
export async function getActivePlansForCoach(coachId: string): Promise<ClientPlan[]> {
    const db    = await getDb();
    const today = getTodaySGT();

    return db.collection<ClientPlan>('client_plans')
        .find({ coach_id: coachId, status: 'active', expiry_date: { $gte: today } })
        .toArray();
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Assigns a new session plan to a client.
 * Any previously active plan for this client is first expired (status → 'expired').
 * Returns the newly created plan.
 */
export async function assignPlanToClient(
    clientId: string,
    coachId: string,
    plan: {
        plan_name: string;
        sessions_total: number;
        start_date: string;   // YYYY-MM-DD
        expiry_date: string;  // YYYY-MM-DD
    }
): Promise<ClientPlan> {
    const db = await getDb();
    const now = new Date();

    // Expire any currently active plan for this client
    await db.collection('client_plans').updateMany(
        { client_id: clientId, status: 'active' },
        { $set: { status: 'expired', updated_at: now } }
    );

    const newPlan: ClientPlan = {
        client_id:      clientId,
        coach_id:       coachId,
        plan_name:      plan.plan_name,
        sessions_total: plan.sessions_total,
        sessions_used:  0,
        start_date:     plan.start_date,
        expiry_date:    plan.expiry_date,
        status:         'active',
        created_at:     now,
        updated_at:     now,
    };

    const result = await db.collection<ClientPlan>('client_plans').insertOne(newPlan as any);
    return { ...newPlan, _id: result.insertedId.toString() };
}

/**
 * Atomically deducts 1 session from the client's active plan.
 *
 * Uses a conditional $inc so sessions_used can NEVER exceed sessions_total.
 * Returns the updated plan, or throws if:
 *  - no active plan exists
 *  - sessions_remaining is already 0
 *
 * The $expr condition: { $lt: ['$sessions_used', '$sessions_total'] }
 * ensures the increment only fires when sessions_used < sessions_total.
 * This is atomic — a single findOneAndUpdate round-trip with no race window.
 */
export async function deductSession(clientId: string): Promise<ClientPlan> {
    const db    = await getDb();
    const today = getTodaySGT();

    const updated = await db.collection<ClientPlan>('client_plans').findOneAndUpdate(
        {
            client_id:   clientId,
            status:      'active',
            expiry_date: { $gte: today },
            // Conditional guard: only deduct if sessions remain
            $expr: { $lt: ['$sessions_used', '$sessions_total'] },
        },
        {
            $inc: { sessions_used: 1 },
            $set: { updated_at: new Date() },
        },
        { returnDocument: 'after' }
    );

    if (!updated) {
        // Determine WHY it failed for a clear error message
        const plan = await getActivePlanForClient(clientId);
        if (!plan) {
            throw new Error('No active plan found for this client.');
        }
        throw new Error('No sessions remaining — cannot deduct.');
    }

    return updated;
}
