import { getDb } from '../db/mongo';
import { CheckIn } from '../types';

/**
 * MongoDB repository for check-ins
 * Pure data access layer - no business logic
 */

export async function createCheckIn(checkin: CheckIn): Promise<CheckIn> {
    const db = await getDb();
    const now = new Date();
    const result = await db.collection<CheckIn>('checkins').insertOne({
        ...checkin,
        createdAt: now,
        flaggedForReview: checkin.flaggedForReview ?? false // Default to false
    });

    return {
        ...checkin,
        _id: result.insertedId.toString(),
        createdAt: now,
        flaggedForReview: checkin.flaggedForReview ?? false
    };
}

export async function getCheckInsByClient(
    clientId: string,
    limit: number = 100
): Promise<CheckIn[]> {
    const db = await getDb();
    return db.collection<CheckIn>('checkins')
        .find({ client_id: clientId })
        .sort({ date: -1 })
        .limit(limit)
        .toArray();
}

export async function getRecentCheckIns(
    clientId: string,
    days: number
): Promise<CheckIn[]> {
    const db = await getDb();

    // Calculate the date from N days ago
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0]; // YYYY-MM-DD

    return db.collection<CheckIn>('checkins')
        .find({
            client_id: clientId,
            date: { $gte: startDateStr }
        })
        .sort({ date: -1 })
        .toArray();
}

/**
 * Get a check-in for a specific client and date
 */
export async function getCheckInByClientAndDate(
    clientId: string,
    date: string
): Promise<CheckIn | null> {
    const db = await getDb();
    return db.collection<CheckIn>('checkins').findOne({
        client_id: clientId,
        date
    });
}

/**
 * Update an existing check-in (kept for direct update use-cases).
 */
export async function updateCheckIn(
    clientId: string,
    date: string,
    updateData: Partial<CheckIn>
): Promise<CheckIn | null> {
    const db = await getDb();

    const result = await db.collection<CheckIn>('checkins').findOneAndUpdate(
        { client_id: clientId, date },
        { $set: updateData },
        { returnDocument: 'after' }
    );

    return result || null;
}

/**
 * Atomic upsert for check-in submission.
 *
 * Replaces the non-atomic getCheckInByClientAndDate() + createCheckIn() / updateCheckIn()
 * pattern in routes.ts. A single findOneAndUpdate with upsert:true is safe under
 * concurrent requests because MongoDB guarantees one document wins the upsert race.
 * The unique index on { client_id, date } enforces at the DB level that only one
 * document per client per date can exist.
 *
 * @returns checkin — the resulting document (created or updated)
 * @returns isUpdate — true if document already existed before this call
 */
export async function upsertCheckIn(
    clientId: string,
    date: string,
    data: Omit<CheckIn, '_id' | 'client_id' | 'date' | 'createdAt'>
): Promise<{ checkin: CheckIn; isUpdate: boolean }> {
    const db = await getDb();
    const now = new Date();

    // $set   — always write the latest payload fields
    // $setOnInsert — only written when document is NEW (upsert creates it)
    // This lets us detect create vs. update via lastErrorObject.updatedExisting
    const result = await (db.collection<CheckIn>('checkins') as any).findOneAndUpdate(
        { client_id: clientId, date },
        {
            $set: { ...data, updatedAt: now },
            $setOnInsert: { client_id: clientId, date, createdAt: now },
        },
        { upsert: true, returnDocument: 'after', includeResultMetadata: true }
    );

    // result.lastErrorObject.updatedExisting is false on INSERT, true on UPDATE
    const isUpdate: boolean = result?.lastErrorObject?.updatedExisting ?? false;

    return { checkin: result?.value as CheckIn, isUpdate };
}

/**
 * Get check-in status for multiple clients in one round-trip.
 * Used by GET /api/clients/status to power the coach action queue.
 *
 * Query strategy (no N+1):
 *  Query 1 — Today's check-ins:
 *    { client_id: { $in: clientIds }, date: today }
 *    Uses compound index { client_id: 1, date: 1 } for index-only scan.
 *
 *  Query 2 — Latest check-in date per client:
 *    Aggregation: $match → $sort(date:-1) → $group($first)
 *    Uses the same compound index. Result is one row per client.
 *
 *  Total: exactly 2 DB round-trips regardless of number of clients.
 *
 * @param clientIds - array of client.id strings (not MongoDB _id)
 * @param today - date string YYYY-MM-DD
 * @returns todaySet: Set of clientIds who checked in today
 *          latestDateMap: Map<clientId, lastCheckInDate | null>
 */
export async function getCheckInStatusForClients(
    clientIds: string[],
    today: string
): Promise<{
    todaySet: Set<string>;
    yesterdaySet: Set<string>;
    latestDateMap: Map<string, string | null>;
}> {
    if (clientIds.length === 0) {
        return { todaySet: new Set(), yesterdaySet: new Set(), latestDateMap: new Map() };
    }

    const db = await getDb();

    // Derive yesterday's date string (YYYY-MM-DD) without moment/date-fns
    const todayDate = new Date(`${today}T00:00:00Z`);
    const yesterdayDate = new Date(todayDate);
    yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
    const yesterday = yesterdayDate.toISOString().split('T')[0];

    // Query 1: Check-ins for today OR yesterday — still a single index scan.
    // Partitioned in-memory into todaySet and yesterdaySet.
    const recentCheckins = await db.collection<CheckIn>('checkins')
        .find({ client_id: { $in: clientIds }, date: { $in: [today, yesterday] } })
        .project({ client_id: 1, date: 1 })
        .toArray();

    const todaySet = new Set<string>();
    const yesterdaySet = new Set<string>();
    for (const c of recentCheckins) {
        if (c.date === today) todaySet.add(c.client_id);
        if (c.date === yesterday) yesterdaySet.add(c.client_id);
    }

    // Query 2: Most recent check-in date per client (unchanged)
    const latestRaw = await db.collection('checkins').aggregate([
        { $match: { client_id: { $in: clientIds } } },
        { $sort: { date: -1 } },
        { $group: { _id: '$client_id', lastDate: { $first: '$date' } } }
    ]).toArray();

    const latestDateMap = new Map<string, string | null>(
        latestRaw.map(r => [r._id as string, r.lastDate as string])
    );

    // Ensure every requested client appears in the map (null = no check-ins ever)
    for (const id of clientIds) {
        if (!latestDateMap.has(id)) {
            latestDateMap.set(id, null);
        }
    }

    return { todaySet, yesterdaySet, latestDateMap };
}

/**
 * Compute consecutive check-in streaks for multiple clients in one DB round-trip.
 * Used by GET /api/clients/status to add `streak` without introducing N+1 queries.
 *
 * Strategy (single aggregation):
 *   $match all check-ins for the given clients → $group by client_id, collect
 *   all distinct date strings → in-memory sort + walk-back per client.
 *
 * Streak rule:
 *   - Client checked in today  → count consecutive days backward from today
 *   - Client did NOT check in today → streak = 0
 *
 * @param clientIds - array of client.id strings
 * @param today     - date string YYYY-MM-DD (the reference "today")
 * @returns Map<clientId, streakCount>
 */
export async function getStreaksForClients(
    clientIds: string[],
    today: string
): Promise<Map<string, number>> {
    const result = new Map<string, number>(clientIds.map(id => [id, 0]));

    if (clientIds.length === 0) return result;

    const db = await getDb();

    // Single aggregation: one document per client with their full set of check-in dates.
    const rows = await db.collection('checkins').aggregate([
        { $match: { client_id: { $in: clientIds } } },
        { $group: { _id: '$client_id', dates: { $addToSet: '$date' } } }
    ]).toArray();

    for (const row of rows) {
        const clientId = row._id as string;
        const dateSet = new Set<string>(row.dates as string[]);

        // If the client has no check-in today, streak is 0 — nothing to walk back.
        if (!dateSet.has(today)) {
            result.set(clientId, 0);
            continue;
        }

        // Walk backwards from today, counting consecutive days.
        let streak = 0;
        const cursor = new Date(`${today}T00:00:00Z`);
        while (dateSet.has(cursor.toISOString().split('T')[0])) {
            streak++;
            cursor.setUTCDate(cursor.getUTCDate() - 1);
        }

        result.set(clientId, streak);
    }

    return result;
}

/**
 * Compute consecutive MISSED check-in streaks for multiple clients.
 * Used by GET /api/clients/status to derive check_in_status automatically.
 *
 * Strategy:
 *   - If client checked in today → missedStreak = 0 (today not yet missed)
 *   - Otherwise walk backwards from yesterday, counting consecutive days
 *     with NO check-in.
 *   - Client with no history at all → 0 (treat as new, not urgent).
 *
 * Threshold applied by the caller in routes.ts:
 *   0–2 → active  |  3+ → treat response field check_in_status as 'paused'
 *
 * @param clientIds - array of client.id strings
 * @param today     - YYYY-MM-DD reference date
 * @returns Map<clientId, missedStreak>
 */
export async function getMissedStreakForClients(
    clientIds: string[],
    today: string
): Promise<Map<string, number>> {
    const result = new Map<string, number>(clientIds.map(id => [id, 0]));
    if (clientIds.length === 0) return result;

    const db = await getDb();

    // Single aggregation — same pattern as getStreaksForClients.
    const rows = await db.collection('checkins').aggregate([
        { $match: { client_id: { $in: clientIds } } },
        { $group: { _id: '$client_id', dates: { $addToSet: '$date' } } }
    ]).toArray();

    const dateSetsById = new Map<string, Set<string>>();
    for (const row of rows) {
        dateSetsById.set(row._id as string, new Set<string>(row.dates as string[]));
    }

    // Derive yesterday once.
    const todayDate = new Date(`${today}T00:00:00Z`);
    const ydDate = new Date(todayDate);
    ydDate.setUTCDate(ydDate.getUTCDate() - 1);
    const yesterday = ydDate.toISOString().split('T')[0];

    for (const clientId of clientIds) {
        const dateSet = dateSetsById.get(clientId);
        if (!dateSet) continue;             // no history → not missed
        if (dateSet.has(today)) continue;   // checked in today → streak = 0

        // Walk backwards from yesterday, max 30 days.
        let missed = 0;
        const cursor = new Date(`${yesterday}T00:00:00Z`);
        for (let i = 0; i < 30; i++) {
            const dayStr = cursor.toISOString().split('T')[0];
            if (!dateSet.has(dayStr)) {
                missed++;
                cursor.setUTCDate(cursor.getUTCDate() - 1);
            } else {
                break;
            }
        }
        result.set(clientId, missed);
    }

    return result;
}
