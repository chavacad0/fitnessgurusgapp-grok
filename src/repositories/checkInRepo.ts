import { getDb } from '../db/mongo';
import { CheckIn } from '../types';

export async function getCheckInsForDate(date: string): Promise<CheckIn[]> {
    const db = await getDb();
    return db.collection<CheckIn>('check_ins')
        .find({ date })
        .toArray();
}

export async function getCheckInsByClient(clientId: string): Promise<CheckIn[]> {
    const db = await getDb();
    return db.collection<CheckIn>('check_ins')
        .find({ client_id: clientId })
        .sort({ date: -1 })
        .toArray();
}

export async function getCheckInByClientAndDate(
    clientId: string,
    date: string
): Promise<CheckIn | null> {
    const db = await getDb();
    return db.collection<CheckIn>('check_ins').findOne({
        client_id: clientId,
        date
    });
}

export async function createCheckIn(checkIn: CheckIn): Promise<void> {
    const db = await getDb();
    await db.collection<CheckIn>('check_ins').insertOne(checkIn);
}

export async function getRecentCheckIns(
    clientId: string,
    days: number
): Promise<CheckIn[]> {
    const db = await getDb();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return db.collection<CheckIn>('check_ins')
        .find({
            client_id: clientId,
            date: { $gte: startDate.toISOString().slice(0, 10) }
        })
        .sort({ date: -1 })
        .toArray();
}
