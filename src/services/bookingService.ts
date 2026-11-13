import { getAllClients, validateClientOwnership } from '../repositories/mongoClientRepo';
import { getActivePlanForClient, getActivePlansForCoach, computePlanStatus } from '../repositories/mongoClientPlanRepo';
import { getAvailabilitySlotById, markSlotBooked, markSlotAvailable, createAvailabilitySlot } from '../repositories/mongoAvailabilityRepo';
import { createBooking, completeBooking, cancelBooking, getTodayBookings, getBookingsByCoach, getBookingById, rescheduleBooking, countBookedSessions } from '../repositories/mongoBookingRepo';
import { completeSession } from './sessionService';
import { getPendingPaymentsForCoach } from '../repositories/mongoPaymentRepo';
import { Booking, DashboardSummary } from '../types';

/**
 * Booking Service — all booking business logic.
 *
 * Rules enforced:
 *  1. bookSession:      slot must exist + be available + client has sessions left to book + plan not expired
 *  2. quickBookSession: same rules; creates slot + booking in one atomic-ish call
 *  3. completeBookingById: coach must own the booking; session auto-deducted on completion
 *  4. cancelBookingById:   coach must own the booking; slot is reset to available
 *  5. getDashboardSummary: aggregates total clients, low-session alerts, expiring plans, pending payments, bookings
 */

/**
 * Sentence shown when a booking would use a session the client does not have.
 * Uses the name stored on the client record. Falls back when that name is blank.
 */
export function sessionsLeftBookingMessage(clientName: string | null | undefined): string {
    const trimmed = typeof clientName === 'string' ? clientName.trim() : '';
    const who = trimmed.length > 0 ? trimmed : 'This client';
    return `${who} has 0 sessions left. Booking needs a new plan.`;
}

/**
 * Sessions still on the plan, minus sessions already reserved by a booking
 * that has not been completed or cancelled. Completed sessions are in
 * sessions_used, so they are not counted twice.
 */
async function assertSessionsLeftToBook(
    client: { id: string; name?: string | null },
    plan: { sessions_total: number; sessions_used: number },
): Promise<void> {
    const reserved = await countBookedSessions(client.id);
    const sessionsLeft = plan.sessions_total - plan.sessions_used - reserved;
    if (sessionsLeft <= 0) {
        throw Object.assign(new Error(sessionsLeftBookingMessage(client.name)), { statusCode: 400 });
    }
}

// ─── Book Session (slot-first) ────────────────────────────────────────────────

export interface BookSessionPayload {
    coach_id: string;
    client_id: string;
    availability_slot_id: string;
    notes?: string;
}

export async function bookSession(payload: BookSessionPayload): Promise<Booking> {
    const { coach_id, client_id, availability_slot_id, notes } = payload;

    const slot = await getAvailabilitySlotById(availability_slot_id);
    if (!slot) throw Object.assign(new Error('Availability slot not found.'), { statusCode: 404 });
    if (slot.coach_id !== coach_id) throw Object.assign(new Error('Slot does not belong to this coach.'), { statusCode: 403 });

    // Explicit status checks — produce clear, user-facing error messages
    if (slot.status === 'blocked') {
        throw Object.assign(new Error('This time is blocked by the coach and cannot be booked.'), { statusCode: 409 });
    }
    if (slot.is_booked || slot.status === 'booked') {
        throw Object.assign(new Error('This time is already booked.'), { statusCode: 409 });
    }

    const client = await validateClientOwnership(client_id, coach_id);
    if (!client) throw Object.assign(new Error('Client not found or does not belong to this coach.'), { statusCode: 403 });

    const plan = await getActivePlanForClient(client_id);
    if (!plan) throw Object.assign(new Error('Client has no active session plan. Assign a plan before booking.'), { statusCode: 400 });

    // 0 sessions (including ones already booked) uses the sessions-left message.
    // A plan that is expired for another reason keeps the existing expired sentence.
    await assertSessionsLeftToBook(client, plan);

    const planStatus = computePlanStatus(plan);
    if (planStatus === 'expired') throw Object.assign(new Error("Client's session plan has expired."), { statusCode: 400 });

    // Atomic slot claim — prevents double-booking under concurrency
    const bookedSlot = await markSlotBooked(availability_slot_id, client_id);
    if (!bookedSlot) throw Object.assign(new Error('Slot was just booked by another request. Please refresh.'), { statusCode: 409 });

    const now = new Date();
    try {
        return await createBooking({
            coach_id, client_id, availability_slot_id,
            date: slot.date, start_time: slot.start_time, end_time: slot.end_time,
            status: 'booked', notes, created_at: now, updated_at: now,
        });
    } catch (err) {
        await markSlotAvailable(availability_slot_id);
        throw err;
    }
}

// ─── Quick Book (one-step) ────────────────────────────────────────────────────

export interface QuickBookPayload {
    coach_id: string;
    client_id: string;
    date: string;       // YYYY-MM-DD
    start_time: string; // HH:MM
    end_time: string;   // HH:MM
    notes?: string;
}

/**
 * Coach-friendly one-step booking.
 * Creates an availability slot AND a booking in one call.
 * If booking creation fails, the slot is rolled back.
 *
 * Enforces: client must have an active plan with sessions remaining.
 */
export async function quickBookSession(payload: QuickBookPayload): Promise<Booking> {
    const { coach_id, client_id, date, start_time, end_time, notes } = payload;

    const client = await validateClientOwnership(client_id, coach_id);
    if (!client) throw Object.assign(new Error('Client not found or does not belong to this coach.'), { statusCode: 403 });

    const plan = await getActivePlanForClient(client_id);
    if (!plan) throw Object.assign(new Error('Client has no active session plan. Assign a plan before booking.'), { statusCode: 400 });

    await assertSessionsLeftToBook(client, plan);

    const planStatus = computePlanStatus(plan);
    if (planStatus === 'expired') throw Object.assign(new Error("Client's session plan has expired."), { statusCode: 400 });

    const now  = new Date();
    const slot = await createAvailabilitySlot(coach_id, { date, start_time, end_time });


    const bookedSlot = await markSlotBooked(slot._id!, client_id);
    if (!bookedSlot) throw Object.assign(new Error('Failed to claim slot — please try again.'), { statusCode: 409 });

    try {
        return await createBooking({
            coach_id, client_id,
            availability_slot_id: slot._id!,
            date, start_time, end_time,
            status: 'booked', notes, created_at: now, updated_at: now,
        });
    } catch (err) {
        await markSlotAvailable(slot._id!);
        throw err;
    }
}

// ─── Complete Booking ─────────────────────────────────────────────────────────

export interface CompleteBookingResult {
    booking: Booking;
    sessions_remaining: number;
    plan_status: string;
    message: string;
}

/**
 * Marks a booking completed and deducts 1 session from the client's plan.
 * Session deduction only happens here — not on booking, not on cancellation.
 */
export async function completeBookingById(bookingId: string, coachId: string): Promise<CompleteBookingResult> {
    const booking = await completeBooking(bookingId, coachId);
    if (!booking) {
        throw Object.assign(
            new Error('Booking not found, already completed/cancelled, or does not belong to this coach.'),
            { statusCode: 404 }
        );
    }
    const sessionResult = await completeSession(booking.client_id, coachId);
    return {
        booking,
        sessions_remaining: sessionResult.sessions_remaining,
        plan_status:        sessionResult.plan_status,
        message:            sessionResult.message,
    };
}

// ─── Cancel Booking ───────────────────────────────────────────────────────────

/**
 * Cancels a booking and releases the availability slot.
 * Sessions are NOT deducted — cancellation does not consume a session.
 */
export async function cancelBookingById(bookingId: string, coachId: string): Promise<Booking> {
    const existing = await getBookingById(bookingId);
    if (!existing || existing.coach_id !== coachId) {
        throw Object.assign(new Error('Booking not found or does not belong to this coach.'), { statusCode: 404 });
    }
    if (existing.status !== 'booked') {
        throw Object.assign(new Error(`Cannot cancel a booking with status '${existing.status}'.`), { statusCode: 400 });
    }
    const cancelled = await cancelBooking(bookingId, coachId);
    if (!cancelled) throw Object.assign(new Error('Failed to cancel booking.'), { statusCode: 500 });
    await markSlotAvailable(existing.availability_slot_id);
    return cancelled;
}

// ─── Reschedule Booking ───────────────────────────────────────────────────────

/**
 * Updates the start_time and end_time of a 'booked' session.
 * Used by drag-to-reschedule on the coach BookingScreen.
 *
 * Rules:
 *  - Coach must own the booking
 *  - Booking must have status 'booked' (not completed/cancelled)
 *  - Times must be valid HH:MM format
 *  - start_time must be before end_time
 */
export async function rescheduleBookingById(
    bookingId: string,
    coachId: string,
    start_time: string,
    end_time: string,
): Promise<Booking> {
    const TIME_RE = /^\d{2}:\d{2}$/;
    if (!TIME_RE.test(start_time) || !TIME_RE.test(end_time)) {
        throw Object.assign(new Error('start_time and end_time must be HH:MM format.'), { statusCode: 400 });
    }
    if (start_time >= end_time) {
        throw Object.assign(new Error('end_time must be after start_time.'), { statusCode: 400 });
    }

    const existing = await getBookingById(bookingId);
    if (!existing || existing.coach_id !== coachId) {
        throw Object.assign(new Error('Booking not found or does not belong to this coach.'), { statusCode: 404 });
    }
    if (existing.status !== 'booked') {
        throw Object.assign(new Error(`Cannot reschedule a booking with status '${existing.status}'.`), { statusCode: 400 });
    }

    const updated = await rescheduleBooking(bookingId, coachId, start_time, end_time);
    if (!updated) {
        throw Object.assign(new Error('Reschedule failed — booking may have been modified concurrently.'), { statusCode: 500 });
    }
    return updated;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function daysUntil(targetDate: string): number {
    const todaySGT = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
    const today    = new Date(`${todaySGT}T00:00:00+08:00`);
    const target   = new Date(`${targetDate}T00:00:00+08:00`);
    return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Builds the coach dashboard summary in 4 parallel queries:
 *  - total clients
 *  - clients with sessions_remaining <= 2
 *  - clients with plan expiring within 7 days
 *  - bookings for the given date (defaults to today SGT)
 *  - pending payment count
 *
 * @param date  Optional YYYY-MM-DD. Defaults to today (Asia/Singapore).
 */
export async function getDashboardSummary(coachId: string, date?: string): Promise<DashboardSummary> {
    const [clients, activePlans, todayBookings, pendingPayments] = await Promise.all([
        getAllClients(coachId),
        getActivePlansForCoach(coachId),
        date ? getBookingsByCoach(coachId, date) : getTodayBookings(coachId),
        getPendingPaymentsForCoach(coachId),
    ]);

    const clientNameMap = new Map(clients.map(c => [c.id, c.name]));

    // Low-session clients: sessions_remaining <= 2
    const lowSessionClients = activePlans
        .map(plan => ({
            client_id:          plan.client_id,
            client_name:        clientNameMap.get(plan.client_id) ?? 'Unknown',
            sessions_remaining: plan.sessions_total - plan.sessions_used,
            expiry_date:        plan.expiry_date,
        }))
        .filter(item => item.sessions_remaining <= 2)
        .sort((a, b) => a.sessions_remaining - b.sessions_remaining);

    // Expiring clients: plan expires within 7 days AND still has sessions remaining
    const expiringClients = activePlans
        .map(plan => ({
            client_id:          plan.client_id,
            client_name:        clientNameMap.get(plan.client_id) ?? 'Unknown',
            sessions_remaining: plan.sessions_total - plan.sessions_used,
            expiry_date:        plan.expiry_date,
            days_until_expiry:  daysUntil(plan.expiry_date),
        }))
        .filter(item => item.days_until_expiry >= 0 && item.days_until_expiry <= 7 && item.sessions_remaining > 0)
        .sort((a, b) => a.days_until_expiry - b.days_until_expiry);

    const bookingsSummary = todayBookings.map(b => ({
        booking_id:  b._id?.toString() ?? '',
        client_id:   b.client_id,
        client_name: clientNameMap.get(b.client_id) ?? 'Unknown',
        start_time:  b.start_time,
        end_time:    b.end_time,
        status:      b.status,
    }));

    return {
        total_clients:          clients.length,
        pending_payments_count: pendingPayments.length,
        low_session_clients:    lowSessionClients,
        expiring_clients:       expiringClients,
        today_bookings:         bookingsSummary,
    };
}
