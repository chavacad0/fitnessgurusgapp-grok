/**
 * Client Payment Service — client-initiated in-app payment flow.
 *
 * ════════════════════════════════════════════════════════════════════════
 * PAYMENT PROVIDER ABSTRACTION
 * ════════════════════════════════════════════════════════════════════════
 *
 * Production integration is NOT yet connected. A SimulatedPaymentProvider
 * is used during development. It always returns success.
 *
 * TO INTEGRATE A REAL PROVIDER:
 *  1. Implement the PaymentProvider interface below (e.g. HitPayProvider)
 *  2. Replace `const provider = new SimulatedPaymentProvider()` with yours
 *  3. All downstream code (routes, mobile) stays unchanged
 *
 * Recommended providers for SGD market:
 *  - HitPay  (PayNow + cards, easy SG onboarding)   https://hitpayapp.com
 *  - Stripe  (global, excellent SDK, more setup)      https://stripe.com
 *
 * ════════════════════════════════════════════════════════════════════════
 */

import { v4 as uuidv4 }         from 'uuid';
import { getPlanById, computeExpiryDate } from '../config/plans';
import { assignPlanToClient }             from '../repositories/mongoClientPlanRepo';
import { updateClientPlanStatus }         from '../repositories/mongoClientAuthRepo';
import {
    createPayment,
    confirmPaymentRecord,
    getPaymentById,
} from '../repositories/mongoPaymentRepo';

// ─── Payment Provider Interface ───────────────────────────────────────────────

interface CreateIntentResult {
    /** Unique identifier for this payment intent (provider-assigned or simulated) */
    intentId:      string;
    /**
     * Client secret — used by some providers (e.g. Stripe) to initialize
     * a payment sheet on the mobile side. Not used by HitPay.
     * Set to undefined when not applicable.
     */
    clientSecret?: string;
    /**
     * Redirect URL — used by redirect-based providers (e.g. HitPay).
     * Mobile opens this URL in a WebView or browser.
     * Set to undefined when not applicable.
     */
    redirectUrl?: string;
}

interface VerifyResult {
    success: boolean;
    paidAt?: Date;
    failureReason?: string;
}

/**
 * PaymentProvider — the contract every provider must satisfy.
 * All provider-specific logic lives inside the implementing class.
 */
interface PaymentProvider {
    /**
     * Create a payment intent / request for the given amount.
     * Returns an intentId the mobile uses to complete payment.
     */
    createPaymentIntent(
        amountSgd: number,
        metadata:  { client_id: string; plan_id: string; payment_record_id: string }
    ): Promise<CreateIntentResult>;

    /**
     * Verify that a payment intent was successfully completed.
     * Called after the mobile reports payment completion.
     * Returns { success: true } or { success: false, failureReason }.
     */
    verifyPayment(intentId: string): Promise<VerifyResult>;
}

// ─── Simulated Payment Provider ───────────────────────────────────────────────

/**
 * TODO: REPLACE WITH REAL PAYMENT PROVIDER (HitPay / Stripe) BEFORE PRODUCTION.
 *
 * This provider always returns success. It is for local development and
 * end-to-end flow testing only. No real money is involved.
 *
 * The intentId format is `sim_<uuid>` so you can identify simulated payments in the DB.
 */
class SimulatedPaymentProvider implements PaymentProvider {
    async createPaymentIntent(
        amountSgd: number,
        metadata:  { client_id: string; plan_id: string; payment_record_id: string }
    ): Promise<CreateIntentResult> {
        console.log(
            `[SimulatedPaymentProvider] Creating intent: $${amountSgd} SGD`,
            `for client ${metadata.client_id}, plan ${metadata.plan_id}`
        );
        return {
            intentId:    `sim_${uuidv4()}`,
            clientSecret: undefined,
            redirectUrl:  undefined,
        };
    }

    async verifyPayment(intentId: string): Promise<VerifyResult> {
        console.log(`[SimulatedPaymentProvider] Verifying intentId: ${intentId}`);
        // Simulated provider always succeeds
        // TODO: Replace with real provider API call
        return {
            success: true,
            paidAt:  new Date(),
        };
    }
}

// ─── Active provider (swap this line to change providers) ────────────────────
const provider: PaymentProvider = new SimulatedPaymentProvider();
// const provider: PaymentProvider = new HitPayProvider({ apiKey: process.env.HITPAY_API_KEY! });
// const provider: PaymentProvider = new StripeProvider({ secretKey: process.env.STRIPE_SECRET_KEY! });

// ─── Service functions ────────────────────────────────────────────────────────

/**
 * Step 1 of client payment flow: create a payment intent.
 *
 * Called by POST /api/payments/client-create.
 * Requires the client to have selected a plan (plan_status: 'selected').
 *
 * Flow:
 *  1. Validate plan_id
 *  2. Create a Payment record with status: 'pending'
 *  3. Call provider.createPaymentIntent()
 *  4. Store intentId on the payment record
 *  5. Update client.plan_status → 'payment_pending'
 *  6. Return { payment_id, intent_id, amount_sgd, clientSecret?, redirectUrl? }
 */
export async function createClientPaymentIntent(params: {
    client_id: string;
    coach_id?: string;   // optional — null when client has no linked coach
    plan_id:   string;
}): Promise<{
    payment_id:    string;
    intent_id:     string;
    amount_sgd:    number;
    clientSecret?: string;
    redirectUrl?:  string;
}> {
    const plan = getPlanById(params.plan_id);
    if (!plan) {
        throw Object.assign(
            new Error(`Invalid plan: '${params.plan_id}'. Valid options: starter, performance, elite.`),
            { statusCode: 400 }
        );
    }

    // ── Idempotency guard ─────────────────────────────────────────────────────
    // If a pending payment already exists for this client+plan, reuse it.
    // This prevents double-charging when the mobile calls create twice
    // (e.g. double-tap, React state race condition, network retry).
    const { getDb: getDbForIdempotency } = await import('../db/mongo');
    const dbCheck = await getDbForIdempotency();
    const existingPending = await dbCheck.collection('payments').findOne({
        client_id: params.client_id,
        plan_id:   plan.id,
        status:    'pending',
    });
    if (existingPending) {
        console.log(
            `[clientPaymentService] Reusing existing pending payment ${
                existingPending._id
            } for client ${params.client_id} plan ${plan.id}`
        );
        return {
            payment_id:   existingPending._id.toString(),
            intent_id:    existingPending.payment_intent_id ?? `sim_reused_${existingPending._id}`,
            amount_sgd:   plan.price_sgd,
            clientSecret: undefined,
            redirectUrl:  undefined,
        };
    }
    // ── End idempotency guard ─────────────────────────────────────────────────

    // 1. Create Payment record (status: 'pending') so we have an ID before calling provider
    const payment = await createPayment({
        client_id:        params.client_id,
        coach_id:         params.coach_id,
        plan_id:          plan.id,
        plan_name:        plan.name,
        amount_sgd:       plan.price_sgd,
        sessions_granted: plan.sessions,
        payment_method:   'other', // provider-handled; may be updated post-confirmation
    });

    const paymentId = (payment as any)._id?.toString() ?? payment._id;

    // 2. Call provider to create the actual intent
    const intent = await provider.createPaymentIntent(plan.price_sgd, {
        client_id:         params.client_id,
        plan_id:           plan.id,
        payment_record_id: paymentId,
    });

    // 3. Store intentId on the payment record for later verification
    // (mongoPaymentRepo.createPayment doesn't have a stripe_intent field yet,
    // but we store it via a direct update — forward-compatible when Stripe is added)
    const { getDb } = await import('../db/mongo');
    const { ObjectId } = await import('mongodb');
    const db = await getDb();
    await db.collection('payments').updateOne(
        { _id: new ObjectId(paymentId) as any },
        { $set: { payment_intent_id: intent.intentId } }
    );

    // 4. Update client plan_status → payment_pending
    await updateClientPlanStatus(params.client_id, {
        plan_status:        'payment_pending',
        payment_intent_id:  intent.intentId,
    });

    return {
        payment_id:   paymentId,
        intent_id:    intent.intentId,
        amount_sgd:   plan.price_sgd,
        clientSecret: intent.clientSecret,
        redirectUrl:  intent.redirectUrl,
    };
}

/**
 * Step 2 of client payment flow: verify payment and activate plan.
 *
 * Called by POST /api/payments/client-confirm.
 * The mobile calls this after the user completes payment in the provider UI.
 *
 * Flow:
 *  1. Load the payment record
 *  2. provider.verifyPayment(intentId) — verify with real provider
 *  3. On SUCCESS:
 *     a. assignPlanToClient() → create active ClientPlan
 *     b. confirmPaymentRecord() → status: 'confirmed', paid_at: now
 *     c. updateClientPlanStatus → 'active', clear payment_intent_id
 *  4. On FAILURE:
 *     a. Leave payment status as 'pending' (client can retry)
 *     b. Return { success: false, error }
 *
 * Atomic guarantee:
 *  Plan assignment happens FIRST. Payment is marked confirmed ONLY after plan exists.
 *  If assignPlanToClient throws, payment stays pending — client can retry.
 */
export async function confirmClientPayment(params: {
    payment_id:  string;
    intent_id:   string;
    client_id:   string;
    coach_id?:   string;   // optional — null when client has no linked coach
}): Promise<{
    success:           boolean;
    plan_status?:      string;
    sessions_total?:   number;
    sessions_remaining?: number;
    expiry_date?:      string;
    error?:            string;
}> {
    // 1. Load the payment record
    const payment = await getPaymentById(params.payment_id);
    if (!payment) {
        throw Object.assign(new Error('Payment not found'), { statusCode: 404 });
    }
    if (payment.client_id !== params.client_id) {
        throw Object.assign(new Error('Access denied'), { statusCode: 403 });
    }
    if (payment.status === 'confirmed') {
        // Idempotent — already activated (e.g. duplicate mobile callback)
        const plan = getPlanById(payment.plan_id);
        return {
            success:           true,
            plan_status:       'active',
            sessions_total:    plan?.sessions,
            sessions_remaining: plan?.sessions,
        };
    }

    // 2. Verify with provider
    const verification = await provider.verifyPayment(params.intent_id);

    if (!verification.success) {
        return {
            success: false,
            error:   verification.failureReason ?? 'Payment could not be verified. Please try again.',
        };
    }

    // 3. Activate plan (plan assignment FIRST, then payment confirmation)
    const plan = getPlanById(payment.plan_id);
    if (!plan) {
        throw new Error(`Plan '${payment.plan_id}' is no longer available.`);
    }

    const todaySGT   = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
    const expiryDate = computeExpiryDate(plan.expiry_days);

    const assignedPlan = await assignPlanToClient(params.client_id, params.coach_id, {
        plan_name:      plan.name,
        sessions_total: plan.sessions,
        start_date:     todaySGT,
        expiry_date:    expiryDate,
    });

    // Mark payment confirmed after plan is live
    await confirmPaymentRecord(params.payment_id, params.coach_id, assignedPlan._id);

    // Update client plan_status → active
    await updateClientPlanStatus(params.client_id, {
        plan_status:       'active',
        payment_intent_id: undefined as any, // clear intent id now that it's confirmed
    });

    return {
        success:            true,
        plan_status:        'active',
        sessions_total:     plan.sessions,
        sessions_remaining: plan.sessions, // all sessions available on a brand new plan
        expiry_date:        expiryDate,
    };
}
