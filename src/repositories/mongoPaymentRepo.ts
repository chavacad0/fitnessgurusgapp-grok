import { ObjectId } from 'mongodb';
import { getDb } from '../db/mongo';
import { Payment, PaymentMethod } from '../types';

/**
 * Payment Repository — all DB access for the 'payments' collection.
 *
 * Business rules enforced:
 *  - Only the owning coach can confirm a payment (coachId validated in service)
 *  - confirmPayment is idempotent: calling it twice is a no-op (returns existing)
 *  - status transitions: pending → confirmed → refunded (no skipping)
 */

// ─── Create ───────────────────────────────────────────────────────────────────

/**
 * Creates a new pending payment record.
 * Called when a coach initiates a plan purchase for a client.
 */
export async function createPayment(data: {
    client_id: string;
    coach_id: string;
    plan_id: string;
    plan_name: string;
    amount_sgd: number;
    sessions_granted: number;
    payment_method: PaymentMethod;
    reference?: string;
    notes?: string;
}): Promise<Payment> {
    const db  = await getDb();
    const now = new Date();

    const payment: Payment = {
        ...data,
        status:     'pending',
        created_at: now,
        updated_at: now,
    };

    const result = await db.collection<Payment>('payments').insertOne(payment as any);
    return { ...payment, _id: result.insertedId.toString() };
}

// ─── Confirm ──────────────────────────────────────────────────────────────────

/**
 * Confirms a pending payment — sets status to 'confirmed' and paid_at to now.
 * Optionally records the plan_assigned_id (the resulting ClientPlan._id).
 *
 * Returns the updated Payment, or null if:
 *  - payment not found
 *  - payment doesn't belong to this coach
 *  - payment is already confirmed (caller should treat as idempotent success)
 */
export async function confirmPaymentRecord(
    paymentId: string,
    coachId: string | undefined,   // optional — undefined for client-only accounts
    planAssignedId?: string,
): Promise<Payment | null> {
    const db  = await getDb();
    const now = new Date();

    let oid: ObjectId;
    try {
        oid = new ObjectId(paymentId);
    } catch {
        return null;
    }

    // coach_id filter is only applied when a coachId is present.
    // Client-initiated payments for coach-less accounts set coach_id: undefined
    // on the payment record, so a strict equality check would miss them.
    const filter: Record<string, any> = {
        _id:    oid as any,
        status: 'pending',   // idempotent: already confirmed → no match → null
    };
    if (coachId) filter['coach_id'] = coachId;

    return db.collection<Payment>('payments').findOneAndUpdate(
        filter,
        {
            $set: {
                status:           'confirmed',
                paid_at:          now,
                updated_at:       now,
                ...(planAssignedId ? { plan_assigned_id: planAssignedId } : {}),
            },
        },
        { returnDocument: 'after' }
    );
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Returns all payments for a specific client, newest first.
 */
export async function getPaymentsByClient(clientId: string): Promise<Payment[]> {
    const db = await getDb();
    return db.collection<Payment>('payments')
        .find({ client_id: clientId })
        .sort({ created_at: -1 })
        .toArray() as unknown as Payment[];
}

/**
 * Returns all PENDING payments for a coach, oldest-first (action queue).
 */
export async function getPendingPaymentsForCoach(coachId: string): Promise<Payment[]> {
    const db = await getDb();
    return db.collection<Payment>('payments')
        .find({ coach_id: coachId, status: 'pending' })
        .sort({ created_at: 1 })
        .toArray() as unknown as Payment[];
}

/**
 * Returns recent confirmed payments for a coach (payment ledger / history).
 */
export async function getConfirmedPaymentsForCoach(
    coachId: string,
    limit = 50,
): Promise<Payment[]> {
    const db = await getDb();
    return db.collection<Payment>('payments')
        .find({ coach_id: coachId, status: 'confirmed' })
        .sort({ paid_at: -1 })
        .limit(limit)
        .toArray() as unknown as Payment[];
}

/**
 * Fetches a single payment by ID.
 */
export async function getPaymentById(paymentId: string): Promise<Payment | null> {
    const db = await getDb();
    try {
        return db.collection<Payment>('payments').findOne({
            _id: new ObjectId(paymentId) as any,
        }) as unknown as Payment | null;
    } catch {
        return null;
    }
}

/**
 * Returns the total confirmed revenue for a coach within a calendar month.
 *
 * @param coachId   Coach's sub/id from JWT
 * @param month     "YYYY-MM" — e.g. "2026-05"
 *
 * Only payments with status 'confirmed' and a paid_at within [monthStart, monthEnd]
 * are counted. Pending, refunded, or failed payments are excluded.
 */
export async function getMonthlyRevenueForCoach(
    coachId: string,
    month: string,   // "YYYY-MM"
): Promise<number> {
    const db = await getDb();

    const [y, m]   = month.split('-').map(Number);
    const monthStart = new Date(y, m - 1, 1);
    const monthEnd   = new Date(y, m, 1);  // exclusive upper bound

    const result = await db.collection<Payment>('payments').aggregate([
        {
            $match: {
                coach_id: coachId,
                status:   'confirmed',
                paid_at:  { $gte: monthStart, $lt: monthEnd },
            },
        },
        {
            $group: {
                _id:   null,
                total: { $sum: '$amount_sgd' },
            },
        },
    ]).toArray();

    return (result[0] as any)?.total ?? 0;
}
