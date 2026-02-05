import { getDb } from '../db/mongo';
import { Client } from '../types';

export async function getActiveClients(): Promise<Client[]> {
  const db = await getDb();
  return db.collection<Client>('clients')
    .find({ subscription_status: 'Active' })
    .toArray();
}

export async function getClientById(id: string): Promise<Client | null> {
  const db = await getDb();
  return db.collection<Client>('clients').findOne({ _id: id });
}

export async function createClient(client: Client): Promise<void> {
  const db = await getDb();
  await db.collection<Client>('clients').insertOne(client);
}

export async function updateClient(id: string, updates: Partial<Client>): Promise<void> {
  const db = await getDb();
  await db.collection<Client>('clients').updateOne(
    { _id: id },
    { $set: updates }
  );
}
