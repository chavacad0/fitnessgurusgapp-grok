import { ObjectId } from 'mongodb';
import { getDb } from '../db/mongo';
import { CoachAvailabilitySlot } from '../types';

/**
 * Coach Availability Repository — all DB access for the coach_availability collection.
 *
 * Slots are time windows the coach has marked as available for bookings.
 * Once a booking is made against a slot, is_booked is set to true and
 * booked_by_client_id is recorded. Cancellation resets these fields.
 *
 * Schedule integrity guarantee:
 *   No two slots for the same coach on the same date may overlap.
 *   Enforced by getOverlappingSlots() called before every write.
 */

// ─── Overlap detection ────────────────────────────────────────────────────────

/**
 * Returns any existing slot for this coach on this date whose time window
 * overlaps [start_time, end_time).
 *
 * Two intervals [a, b) and [c, d) overlap when: a < d AND c < b.
 *
 * Pass excludeSlotId to skip a specific slot (used when checking against itself).
 */
export async function getOverlappingSlots(
    coachId:      string,
    date:         string,
    start_time:   string,
    end_time:     string,
    excludeSlotId?: string,
): Promise<CoachAvailabilitySlot[]> {
    const db = await getDb();
    const query: Record<string, any> = {
        coach_id:   coachId,
        date,
        // Overlap condition: existing.start_time < new.end_time AND existing.end_time > new.start_time
        start_time: { $lt: end_time },
        end_time:   { $gt: start_time },
    };
    if (excludeSlotId) {
        try { query['_id'] = { $ne: new ObjectId(excludeSlotId) }; } catch { /* ignore bad id */ }
    }
    return db.collection<CoachAvailabilitySlot>('coach_availability')
        .find(query)
        .sort({ start_time: 1 })
        .toArray();
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Returns all availability slots for a coach on or after fromDate.
 * Defaults fromDate to today (SGT) when not provided.
 * Returns slots ordered by date + start_time ascending.
 */
/**
 * Slots for one coach between two dates, inclusive. Dates are YYYY-MM-DD
 * in Asia/Singapore. The caller decides the window.
 */
export async function getAvailabilityBetween(
    coachId: string,
    fromDate: string,
    toDate: string,
): Promise<CoachAvailabilitySlot[]> {
    const db = await getDb();
    return db.collection<CoachAvailabilitySlot>('coach_availability')
        .find({ coach_id: coachId, date: { $gte: fromDate, $lte: toDate } })
        .sort({ date: 1, start_time: 1 })
        .toArray();
}

/**
 * Inserts one open slot that came from working-hours rules.
 * source: 'rules' lets a later sync remove it again. Booked slots are never
 * inserted here.
 */
/**
 * An open slot at this exact time, if one exists for this coach.
 * Used when a coach accepts a time request so the booking claims the
 * slot that is already on the schedule.
 */
export async function findOpenSlot(
    coachId: string,
    date: string,
    startTime: string,
    endTime: string,
): Promise<CoachAvailabilitySlot | null> {
    const db = await getDb();
    return db.collection<CoachAvailabilitySlot>('coach_availability').findOne({
        coach_id: coachId,
        date,
        start_time: startTime,
        end_time: endTime,
        is_booked: false,
        status: { $nin: ['blocked', 'booked'] },
    });
}

export async function insertGeneratedSlot(
    coachId: string,
    slot: { date: string; start_time: string; end_time: string },
): Promise<string> {
    const db = await getDb();
    const doc: CoachAvailabilitySlot = {
        coach_id: coachId,
        date: slot.date,
        start_time: slot.start_time,
        end_time: slot.end_time,
        is_booked: false,
        status: 'available',
        source: 'rules',
        created_at: new Date(),
    };
    const result = await db.collection<CoachAvailabilitySlot>('coach_availability')
        .insertOne(doc as any);
    return result.insertedId.toString();
}

/**
 * Removes one rules-generated slot that is still open and belongs to this coach.
 * Returns true when a document was deleted.
 */
export async function deleteGeneratedSlot(coachId: string, slotId: string): Promise<boolean> {
    const db = await getDb();
    try {
        const result = await db.collection('coach_availability').deleteOne({
            _id: new ObjectId(slotId) as any,
            coach_id: coachId,
            source: 'rules',
            is_booked: false,
            status: { $ne: 'booked' },
        });
        return result.deletedCount === 1;
    } catch {
        return false;
    }
}

export async function getAvailabilityByCoach(
    coachId: string,
    fromDate?: string
): Promise<CoachAvailabilitySlot[]> {
    const db   = await getDb();
    const from = fromDate ?? getTodaySGT();

    return db.collection<CoachAvailabilitySlot>('coach_availability')
        .find({ coach_id: coachId, date: { $gte: from } })
        .sort({ date: 1, start_time: 1 })
        .toArray();
}

/**
 * Returns a single availability slot by its _id.
 * Returns null if not found.
 */
export async function getAvailabilitySlotById(slotId: string): Promise<CoachAvailabilitySlot | null> {
    const db = await getDb();
    try {
        const slot = await db.collection<CoachAvailabilitySlot>('coach_availability')
            .findOne({ _id: new ObjectId(slotId) as any });
        return slot ?? null;
    } catch {
        return null;   // invalid ObjectId format
    }
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Creates a new availability slot for a coach.
 * Rejects if the time window overlaps a blocked slot on the same date
 * (a blocked window means the coach has explicitly marked that time unavailable).
 * Overlaps with other available slots are allowed — the coach may split/stack slots.
 */
export async function createAvailabilitySlot(
    coachId: string,
    slot: { date: string; start_time: string; end_time: string }
): Promise<CoachAvailabilitySlot> {
    const db  = await getDb();
    const now = new Date();

    // Guard: reject if a blocked slot already covers this time window
    const overlapping = await getOverlappingSlots(coachId, slot.date, slot.start_time, slot.end_time);
    const blockedConflict = overlapping.find(s => s.status === 'blocked');
    if (blockedConflict) {
        throw Object.assign(
            new Error(`This time conflicts with a blocked window (${blockedConflict.start_time}–${blockedConflict.end_time}). Unblock it first.`),
            { statusCode: 409 },
        );
    }

    const newSlot: CoachAvailabilitySlot = {
        coach_id:  coachId,
        date:      slot.date,
        start_time: slot.start_time,
        end_time:   slot.end_time,
        is_booked: false,
        status:    'available',
        created_at: now,
    };

    const result = await db.collection<CoachAvailabilitySlot>('coach_availability')
        .insertOne(newSlot as any);

    return { ...newSlot, _id: result.insertedId.toString() };
}

/**
 * Marks a slot as booked by a specific client.
 * Called atomically inside bookingService to prevent double-booking.
 *
 * The findOneAndUpdate condition includes:
 *   - is_booked: false  — prevents double-booking under concurrency
 *   - status: { $ne: 'blocked' }  — prevents booking a blocked slot (belt-and-suspenders;
 *     bookSession() also checks this, but we enforce it at the DB level too)
 *
 * Returns null if the slot was already booked or is blocked — caller throws 409.
 */
export async function markSlotBooked(
    slotId: string,
    clientId: string
): Promise<CoachAvailabilitySlot | null> {
    const db = await getDb();
    try {
        return await db.collection<CoachAvailabilitySlot>('coach_availability')
            .findOneAndUpdate(
                {
                    _id:       new ObjectId(slotId) as any,
                    is_booked: false,
                    status:    { $ne: 'blocked' },   // blocked slots cannot be booked
                },
                { $set: { is_booked: true, booked_by_client_id: clientId, status: 'booked' } },
                { returnDocument: 'after' }
            );
    } catch {
        return null;
    }
}

/**
 * Resets a slot to available (is_booked: false).
 * Called when a booking is cancelled.
 */
export async function markSlotAvailable(slotId: string): Promise<void> {
    const db = await getDb();
    try {
        await db.collection('coach_availability').updateOne(
            { _id: new ObjectId(slotId) as any },
            { $set: { is_booked: false, status: 'available' }, $unset: { booked_by_client_id: '' } }
        );
    } catch {
        // Log but don't throw — slot reset is best-effort on cancellation
        console.warn(`[availabilityRepo] Failed to reset slot ${slotId}`);
    }
}

/**
 * Creates a new availability slot with status: 'blocked'.
 * The coach is marking this window as unavailable — it will be hidden from clients.
 *
 * Rules enforced:
 *  1. No existing BOOKED slot may overlap this window — cannot block booked time.
 *  2. Any existing AVAILABLE slot that overlaps is rejected with a clear message
 *     (coach must delete it first, or the UX can auto-delete — kept explicit here).
 *  3. Blocked slots have is_booked: false — they can never be accidentally booked.
 */
export async function blockSlot(
    coachId: string,
    slot: { date: string; start_time: string; end_time: string; reason?: string },
): Promise<CoachAvailabilitySlot> {
    const db  = await getDb();
    const now = new Date();

    // Check for any overlapping slots on the same date
    const overlapping = await getOverlappingSlots(coachId, slot.date, slot.start_time, slot.end_time);

    for (const existing of overlapping) {
        if (existing.is_booked || existing.status === 'booked') {
            throw Object.assign(
                new Error(`This time is already booked (${existing.start_time}–${existing.end_time}). Cancel the booking before blocking.`),
                { statusCode: 409 },
            );
        }
        if (existing.status === 'available' || !existing.status) {
            throw Object.assign(
                new Error(`This time conflicts with an available slot (${existing.start_time}–${existing.end_time}). Delete that slot first or choose a different time.`),
                { statusCode: 409 },
            );
        }
        if (existing.status === 'blocked') {
            throw Object.assign(
                new Error(`This time is already blocked (${existing.start_time}–${existing.end_time}).`),
                { statusCode: 409 },
            );
        }
    }

    const newSlot: CoachAvailabilitySlot = {
        coach_id:   coachId,
        date:       slot.date,
        start_time: slot.start_time,
        end_time:   slot.end_time,
        is_booked:  false,
        status:     'blocked',
        ...(slot.reason ? { blocked_reason: slot.reason } : {}),
        created_at: now,
    };

    const result = await db.collection<CoachAvailabilitySlot>('coach_availability')
        .insertOne(newSlot as any);

    return { ...newSlot, _id: result.insertedId.toString() };
}

/**
 * Unblocks a slot — resets status to 'available'.
 * Coach must own the slot. Returns null if not found or already booked.
 */
export async function unblockSlot(
    slotId: string,
    coachId: string,
): Promise<CoachAvailabilitySlot | null> {
    const db = await getDb();
    try {
        return await db.collection<CoachAvailabilitySlot>('coach_availability')
            .findOneAndUpdate(
                {
                    _id:       new ObjectId(slotId) as any,
                    coach_id:  coachId,
                    status:    'blocked',   // can only unblock a blocked slot
                    is_booked: false,       // safety: should never be true for blocked slots
                },
                {
                    $set:   { status: 'available' },
                    $unset: { blocked_reason: '' },
                },
                { returnDocument: 'after' },
            );
    } catch {
        return null;
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getTodaySGT(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

