import { getDb } from '../db/mongo';
import { Client } from '../types';

/**
 * Client Repository — all DB access for the 'clients' collection.
 *
 * IMPORTANT: All functions are scoped to the authenticated coach via coach_id.
 * Never return or operate on clients that don't belong to the requesting coach.
 */

/**
 * Fetch all clients belonging to a specific coach.
 * NEVER returns clients from other coaches.
 */
export async function getAllClients(coachId: string): Promise<Client[]> {
    const db = await getDb();
    const clients = await db.collection<Client>('clients')
        .find({ coach_id: coachId })
        .project({ _id: 1, id: 1, name: 1, email: 1, coach_id: 1 })
        .toArray();
    return clients as Client[];
}

/**
 * Verify that a client belongs to the given coach.
 * Returns the client document if ownership is confirmed.
 * Returns null if the client doesn't exist OR belongs to a different coach.
 *
 * Call this before ANY per-client read or write operation.
 */
export async function validateClientOwnership(
    clientId: string,
    coachId: string
): Promise<Client | null> {
    const db = await getDb();
    const client = await db.collection<Client>('clients').findOne({
        id: clientId,
        coach_id: coachId,
    });
    return client ?? null;
}

/**
 * Returns clients for a coach who haven't checked in today.
 * Used by the daily reminder service — scoped by coachId.
 */
export async function getClientsWithoutCheckIn(today: string, coachId: string): Promise<Client[]> {
    const db = await getDb();

    const clients = await db.collection<Client>('clients')
        .find({ coach_id: coachId })
        .toArray();

    const clientsWithoutCheckIn = [];

    for (const client of clients) {
        const checkIn = await db.collection('check_ins').findOne({
            client_id: client.id,
            date: today,
        });

        if (!checkIn) {
            clientsWithoutCheckIn.push(client);
        }
    }

    return clientsWithoutCheckIn;
}
