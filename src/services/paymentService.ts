import { getPlanById, computeExpiryDate, PlanId } from '../config/plans';
import { assignPlanToClient }                       from '../repositories/mongoClientPlanRepo';
import {
    createPayment,
    confirmPaymentRecord,
    getPendingPaymentsForCoach,
    getPaymentsByClient,
    getPaymentById,
} from '../repositories/mongoPaymentRepo';
import { Payment, PaymentMethod } from '../types';

/**
 * Payment Service — orchestrates payment record creation + plan assignment.
 *
 * Why a service (not just routes)?
 *  - confirmPayment must atomically: confirm the payment AND assign the plan.
 *    If plan assignment fails, we must NOT mark the payment confirmed.
 *  - All business-rule errors bubble as thrown Error objects with clear messages.
 *    Routes catch these and translate to HTTP status codes.
 */

// ─── Initiate ─────────────────────────────────────────────────────────────────

/**
 * Initiates a payment for a client purchasing a session plan.
 * Creates a Payment record with status 'pending'.
 *
 * Called by:
 *  - Coach (assigns plan to client)
 *  - Client (requests plan — coach must still confirm)
 *
 * @throws 400 if planId is not in the plan catalogue
 */
export async function initiatePayment(params: {
    coach_id: string;
    client_id: string;
    plan_id: PlanId | string;
    payment_method: PaymentMethod;
    reference?: string;
    notes?: string;
}): Promise<{ payment: Payment; plan_details: ReturnType<typeof getPlanById> }> {
    const plan = getPlanById(params.plan_id);
    if (!plan) {
        throw new Error(`Invalid plan: '${params.plan_id}'. Valid options: starter, performance, elite.`);
    }

    const payment = await createPayment({
        client_id:        params.client_id,
        coach_id:         params.coach_id,
        plan_id:          plan.id,
        plan_name:        plan.name,
        amount_sgd:       plan.price_sgd,
        sessions_granted: plan.sessions,
        payment_method:   params.payment_method,
        reference:        params.reference,
        notes:            params.notes,
    });

    return { payment, plan_details: plan };
}

// ─── Confirm ──────────────────────────────────────────────────────────────────

/**
 * Coach confirms payment received → assigns sessions to client.
 *
 * Atomic guarantee:
 *  - Plan assignment happens FIRST
 *  - Payment is marked 'confirmed' ONLY after plan is successfully created
 *  - If plan creation throws, payment stays 'pending' — coach can retry
 *
 * @throws 404 if payment not found
 * @throws 403 if payment belongs to a different coach
 * @throws 409 if payment is already confirmed (idempotent — safe to surface)
 * @throws 400 if plan_id no longer maps to a valid plan (shouldn't happen)
 */
export async function confirmPaymentAndAssignPlan(
    paymentId: string,
    coachId: string,
): Promise<{ payment: Payment; sessions_remaining: number; expiry_date: string }> {
    // 1. Load the payment
    const existing = await getPaymentById(paymentId);
    if (!existing) {
        throw new Error('PAYMENT_NOT_FOUND');
    }
    if (existing.coach_id !== coachId) {
        throw new Error('PAYMENT_FORBIDDEN');
    }
    if (existing.status === 'confirmed') {
        throw new Error('PAYMENT_ALREADY_CONFIRMED');
    }

    // 2. Re-validate plan (catalogue hasn't changed, but defensive check)
    const plan = getPlanById(existing.plan_id);
    if (!plan) {
        throw new Error(`Plan '${existing.plan_id}' is no longer available.`);
    }

    // 3. Compute dates from TODAY (not from when payment was created)
    const todaySGT   = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
    const expiryDate = computeExpiryDate(plan.expiry_days);

    // 4. Assign the plan FIRST — if this throws, payment stays pending
    const assignedPlan = await assignPlanToClient(
        existing.client_id,
        coachId,
        {
            plan_name:      plan.name,
            sessions_total: plan.sessions,
            start_date:     todaySGT,
            expiry_date:    expiryDate,
        }
    );

    // 5. Mark payment confirmed now that plan is live
    const confirmedPayment = await confirmPaymentRecord(
        paymentId,
        coachId,
        assignedPlan._id,
    );

    // confirmedPayment can be null if another request raced us — treat as idempotent success
    const finalPayment = confirmedPayment ?? { ...existing, status: 'confirmed' as const, paid_at: new Date() };

    return {
        payment:           finalPayment as Payment,
        sessions_remaining: plan.sessions,        // brand new plan — all sessions available
        expiry_date:        expiryDate,
    };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getPendingPayments(coachId: string): Promise<Payment[]> {
    return getPendingPaymentsForCoach(coachId);
}

export async function getClientPaymentHistory(
    coachId: string,
    clientId: string,
): Promise<Payment[]> {
    // Ownership: the service is called after validateClientOwnership in routes
    return getPaymentsByClient(clientId);
}
