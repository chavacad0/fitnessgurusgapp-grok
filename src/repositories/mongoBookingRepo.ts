import { ObjectId } from 'mongodb';
import { getDb } from '../db/mongo';
import { Booking } from '../types';

/**
 * Booking Repository — all DB access for the bookings collection.
 *
 * A booking links a client to a specific CoachAvailabilitySlot.
 * Lifecycle: booked → completed (session auto-deducted) | cancelled
 */

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Returns all bookings for a coach, optionally filtered by date.
 * Sorted by date + start_time ascending.
 */
export async function getBookingsByCoach(
    coachId: string,
    date?: string
): Promise<Booking[]> {
    const db    = await getDb();
    const query: any = { coach_id: coachId };
    if (date) query.date = date;

    return db.collection<Booking>('bookings')
        .find(query)
        .sort({ date: 1, start_time: 1 })
        .toArray();
}

/**
 * Returns all bookings for a specific client.
 */
export async function getBookingsByClient(clientId: string): Promise<Booking[]> {
    const db = await getDb();
    return db.collection<Booking>('bookings')
        .find({ client_id: clientId })
        .sort({ date: 1, start_time: 1 })
        .toArray();
}

/**
 * Returns today's bookings for a coach (Asia/Singapore date).
 * Used by the dashboard summary.
 */
export async function getTodayBookings(coachId: string): Promise<Booking[]> {
    const today = getTodaySGT();
    return getBookingsByCoach(coachId, today);
}

/**
 * Returns a single booking by its _id.
 * Returns null if not found or if _id format is invalid.
 */
export async function getBookingById(bookingId: string): Promise<Booking | null> {
    const db = await getDb();
    try {
        const booking = await db.collection<Booking>('bookings')
            .findOne({ _id: new ObjectId(bookingId) as any });
        return booking ?? null;
    } catch {
        return null;
    }
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Creates a new booking document.
 * Caller (bookingService) is responsible for all pre-creation checks:
 *  - slot is available
 *  - client has sessions remaining
 *  - client plan is not expired
 */
export async function createBooking(booking: Omit<Booking, '_id'>): Promise<Booking> {
    const db     = await getDb();
    const result = await db.collection<Booking>('bookings').insertOne(booking as any);
    return { ...booking, _id: result.insertedId.toString() };
}

/**
 * Marks a booking as completed.
 * Returns the updated booking, or null if not found / wrong coach.
 *
 * Caller (bookingService) calls deductSession() separately after this succeeds.
 */
export async function completeBooking(
    bookingId: string,
    coachId: string
): Promise<Booking | null> {
    const db = await getDb();
    try {
        return await db.collection<Booking>('bookings').findOneAndUpdate(
            {
                _id:      new ObjectId(bookingId) as any,
                coach_id: coachId,
                status:   'booked',   // can only complete from 'booked' state
            },
            {
                $set: { status: 'completed', updated_at: new Date() },
            },
            { returnDocument: 'after' }
        );
    } catch {
        return null;
    }
}

/**
 * Marks a booking as cancelled.
 * Returns the updated booking, or null if not found / wrong coach.
 */
export async function cancelBooking(
    bookingId: string,
    coachId: string
): Promise<Booking | null> {
    const db = await getDb();
    try {
        return await db.collection<Booking>('bookings').findOneAndUpdate(
            {
                _id:      new ObjectId(bookingId) as any,
                coach_id: coachId,
                status:   'booked',   // can only cancel from 'booked' state
            },
            {
                $set: { status: 'cancelled', updated_at: new Date() },
            },
            { returnDocument: 'after' }
        );
    } catch {
        return null;
    }
}

/**
 * Marks a booking as cancelled — client-owned version.
 * Filters by client_id instead of coach_id so clients can only cancel
 * their own bookings.
 * Returns the updated booking, or null if not found / wrong client.
 */
export async function cancelBookingByClient(
    bookingId: string,
    clientId: string
): Promise<Booking | null> {
    const db = await getDb();
    try {
        return await db.collection<Booking>('bookings').findOneAndUpdate(
            {
                _id:       new ObjectId(bookingId) as any,
                client_id: clientId,
                status:    'booked',   // can only cancel from 'booked' state
            },
            {
                $set: { status: 'cancelled', updated_at: new Date() },
            },
            { returnDocument: 'after' }
        );
    } catch {
        return null;
    }
}


/**
 * Updates the time window of a booking (drag-to-reschedule).
 * Only 'booked' sessions can be rescheduled — completed/cancelled are immutable.
 * Coach ownership is enforced via coach_id filter.
 * Also updates the associated availability_slot times to keep them in sync.
 */
export async function rescheduleBooking(
    bookingId: string,
    coachId: string,
    start_time: string,
    end_time: string,
): Promise<Booking | null> {
    const db = await getDb();
    try {
        return await db.collection<Booking>('bookings').findOneAndUpdate(
            {
                _id:      new ObjectId(bookingId) as any,
                coach_id: coachId,
                status:   'booked',   // only reschedule future sessions
            },
            {
                $set: { start_time, end_time, updated_at: new Date() },
            },
            { returnDocument: 'after' }
        );
    } catch {
        return null;
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getTodaySGT(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}
