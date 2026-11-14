import { ObjectId } from 'mongodb';
import { getDb } from '../db/mongo';

/**
 * Client best times and time requests.
 * best times: one document per client.
 * time requests: one document per ask. Accepting one creates a booking
 * through the existing booking service. The request itself is not a booking.
 */

export type BestWindow = 'weekday_mornings' | 'lunch' | 'after_work' | 'weekends';
export type RequestStatus = 'pending' | 'suggested' | 'accepted' | 'declined';

export interface ExactTime {
    id: string;
    day: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
    time: string;
    note?: string;
}

export interface AwayRange {
    id: string;
    start: string;
    end: string;
}

export interface ClientBestTimes {
    _id?: string;
    client_id: string;
    windows: BestWindow[];
    exact_times: ExactTime[];
    away: AwayRange[];
    updated_at: Date;
}

export interface TimeRequest {
    _id?: string;
    client_id: string;
    coach_id: string;
    date: string;
    start_time: string;
    end_time: string;
    note?: string;
    status: RequestStatus;
    suggested_date?: string;
    suggested_start?: string;
    suggested_end?: string;
    booking_id?: string;
    created_at: Date;
    updated_at: Date;
}

const BEST = 'client_best_times';
const REQUESTS = 'time_requests';

export async function getBestTimes(clientId: string): Promise<ClientBestTimes | null> {
    const db = await getDb();
    const doc = await db.collection<ClientBestTimes>(BEST).findOne({ client_id: clientId });
    return doc ?? null;
}

export async function getBestTimesForClients(clientIds: string[]): Promise<ClientBestTimes[]> {
    if (clientIds.length === 0) return [];
    const db = await getDb();
    return db.collection<ClientBestTimes>(BEST).find({ client_id: { $in: clientIds } }).toArray();
}

export async function saveBestTimes(
    clientId: string,
    windows: BestWindow[],
    exactTimes: ExactTime[],
    away: AwayRange[],
): Promise<ClientBestTimes> {
    const db = await getDb();
    const updated_at = new Date();
    await db.collection(BEST).updateOne(
        { client_id: clientId },
        { $set: { client_id: clientId, windows, exact_times: exactTimes, away, updated_at } },
        { upsert: true },
    );
    const saved = await getBestTimes(clientId);
    if (!saved) throw new Error('Best times could not be saved.');
    return saved;
}

export async function insertTimeRequest(request: Omit<TimeRequest, '_id'>): Promise<TimeRequest> {
    const db = await getDb();
    const result = await db.collection<TimeRequest>(REQUESTS).insertOne(request as TimeRequest);
    return { ...request, _id: result.insertedId.toString() };
}

export async function getTimeRequest(id: string): Promise<TimeRequest | null> {
    const db = await getDb();
    try {
        const doc = await db.collection<TimeRequest>(REQUESTS).findOne({ _id: new ObjectId(id) as any });
        return doc ?? null;
    } catch {
        return null;
    }
}

export async function listTimeRequestsForClient(clientId: string): Promise<TimeRequest[]> {
    const db = await getDb();
    return db.collection<TimeRequest>(REQUESTS)
        .find({ client_id: clientId })
        .sort({ created_at: -1 })
        .toArray();
}

export async function listOpenTimeRequestsForCoach(coachId: string): Promise<TimeRequest[]> {
    const db = await getDb();
    return db.collection<TimeRequest>(REQUESTS)
        .find({ coach_id: coachId, status: { $in: ['pending', 'suggested'] } })
        .sort({ created_at: 1 })
        .toArray();
}

export async function findOpenRequest(
    clientId: string,
    date: string,
    startTime: string,
): Promise<TimeRequest | null> {
    const db = await getDb();
    const doc = await db.collection<TimeRequest>(REQUESTS).findOne({
        client_id: clientId,
        date,
        start_time: startTime,
        status: { $in: ['pending', 'suggested'] },
    });
    return doc ?? null;
}

export async function updateTimeRequest(
    id: string,
    coachId: string,
    patch: Partial<TimeRequest>,
): Promise<TimeRequest | null> {
    const db = await getDb();
    try {
        return await db.collection<TimeRequest>(REQUESTS).findOneAndUpdate(
            { _id: new ObjectId(id) as any, coach_id: coachId },
            { $set: { ...patch, updated_at: new Date() } },
            { returnDocument: 'after' },
        );
    } catch {
        return null;
    }
}
