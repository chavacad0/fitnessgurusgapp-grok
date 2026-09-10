import { validateClientOwnership } from '../repositories/mongoClientRepo';
import {
    getActivePlanForClient,
    deductSession,
    computePlanStatus,
} from '../repositories/mongoClientPlanRepo';
import { ClientPlan, PlanStatus } from '../types';

/**
 * Session Service — business logic for session tracking.
 *
 * All session operations go through here, never directly to repos from routes.
 * This keeps routes thin and business rules testable in isolation.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SessionStatusResponse {
    has_plan: boolean;
    plan_name?: string;
    plan_status?: PlanStatus;
    sessions_total?: number;
    sessions_used?: number;
    sessions_remaining?: number;
    expiry_date?: string;
}

export interface CompleteSessionResult {
    sessions_remaining: number;
    sessions_total: number;
    plan_status: PlanStatus;
    message: string;
}

// ─── Functions ────────────────────────────────────────────────────────────────

/**
 * Returns a client's current session status.
 *
 * Validates coach ownership before reading — a coach cannot view
 * session status for a client that doesn't belong to them.
 *
 * Returns { has_plan: false } if the client has no active plan.
 */
export async function getSessionStatus(
    clientId: string,
    coachId: string
): Promise<SessionStatusResponse> {
    // Ownership check
    const client = await validateClientOwnership(clientId, coachId);
    if (!client) {
        throw Object.assign(new Error('Client not found or access denied.'), { statusCode: 403 });
    }

    const plan = await getActivePlanForClient(clientId);
    if (!plan) {
        return { has_plan: false };
    }

    const plan_status       = computePlanStatus(plan);
    const sessions_remaining = plan.sessions_total - plan.sessions_used;

    return {
        has_plan: true,
        plan_name:           plan.plan_name,
        plan_status,
        sessions_total:      plan.sessions_total,
        sessions_used:       plan.sessions_used,
        sessions_remaining,
        expiry_date:         plan.expiry_date,
    };
}

/**
 * Completes one session for a client — deducts 1 from their active plan.
 *
 * Checks (in order):
 *  1. Coach owns the client
 *  2. Client has an active plan
 *  3. sessions_remaining > 0 (enforced atomically in deductSession)
 *
 * Returns the new session counts after deduction.
 */
export async function completeSession(
    clientId: string,
    coachId: string
): Promise<CompleteSessionResult> {
    // Ownership check
    const client = await validateClientOwnership(clientId, coachId);
    if (!client) {
        throw Object.assign(new Error('Client not found or access denied.'), { statusCode: 403 });
    }

    // Check plan exists before attempting atomic deduction (for a cleaner error message)
    const planBefore = await getActivePlanForClient(clientId);
    if (!planBefore) {
        throw Object.assign(new Error('No active session plan found for this client.'), { statusCode: 400 });
    }

    if (planBefore.sessions_total - planBefore.sessions_used <= 0) {
        throw Object.assign(new Error('No sessions remaining — cannot complete session.'), { statusCode: 400 });
    }

    // Atomic deduction — throws if sessions_remaining hits 0 concurrently
    const updatedPlan = await deductSession(clientId);
    const sessions_remaining = updatedPlan.sessions_total - updatedPlan.sessions_used;
    const plan_status         = computePlanStatus(updatedPlan);

    return {
        sessions_remaining,
        sessions_total: updatedPlan.sessions_total,
        plan_status,
        message: sessions_remaining === 0
            ? 'Session completed. No sessions remaining — renewal needed.'
            : `Session completed. ${sessions_remaining} session${sessions_remaining === 1 ? '' : 's'} remaining.`,
    };
}

/**
 * Enriches a list of { clientId, ... } items with session plan data.
 * Used by GET /clients/status to add plan badges to the coach dashboard.
 *
 * Makes a single-pass bulk fetch of active plans, then merges by client_id.
 * No N+1 queries.
 */
export async function enrichWithSessionStatus(
    clientIds: string[]
): Promise<Map<string, SessionStatusResponse>> {
    const { getDb } = await import('../db/mongo');
    const { computePlanStatus: cps } = await import('../repositories/mongoClientPlanRepo');
    const db    = await getDb();
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });

    const plans = await db.collection<ClientPlan>('client_plans')
        .find({
            client_id:   { $in: clientIds },
            status:      'active',
            expiry_date: { $gte: today },
        })
        .toArray();

    const map = new Map<string, SessionStatusResponse>();

    for (const plan of plans) {
        const plan_status        = cps(plan);
        const sessions_remaining = plan.sessions_total - plan.sessions_used;
        map.set(plan.client_id, {
            has_plan: true,
            plan_name:       plan.plan_name,
            plan_status,
            sessions_total:  plan.sessions_total,
            sessions_used:   plan.sessions_used,
            sessions_remaining,
            expiry_date:     plan.expiry_date,
        });
    }

    // Fill in has_plan: false for clients without a plan
    for (const id of clientIds) {
        if (!map.has(id)) {
            map.set(id, { has_plan: false });
        }
    }

    return map;
}
