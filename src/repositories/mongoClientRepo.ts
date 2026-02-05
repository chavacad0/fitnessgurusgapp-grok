import { getDb } from '../db/mongo';

export interface Client {
    _id?: string;
    id: string;
    coach_id: string;
    name: string;
    email: string;
    subscription_status: 'Invited' | 'Active' | 'Paused' | 'Cancelled';
    paid_until: string | null;
    access_override: boolean;
}

export async function getClientsWithoutCheckIn(today: string): Promise<Client[]> {
    const db = await getDb();

    // Get all active clients
    const clients = await db.collection<Client>('clients')
        .find({ subscription_status: 'Active' })
        .toArray();

    // Filter out clients who have checked in today
    const clientsWithoutCheckIn = [];

    for (const client of clients) {
        const checkIn = await db.collection('check_ins').findOne({
            client_id: client.id,
            date: today
        });

        if (!checkIn) {
            clientsWithoutCheckIn.push(client);
        }
    }

    return clientsWithoutCheckIn;
}

export async function hasAccess(clientId: string, today: string): Promise<boolean> {
    const db = await getDb();
    const client = await db.collection<Client>('clients').findOne({ id: clientId });

    if (!client) return false;

    return client.access_override ||
        (client.paid_until !== null && new Date(client.paid_until) >= new Date(today));
}
