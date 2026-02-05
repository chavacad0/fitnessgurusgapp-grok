import { MongoClient, Db } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.DB_NAME || 'fitnessprac';

let db: Db;
let client: MongoClient;

export async function connectDB() {
    if (db) return db;

    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);

    console.log('✅ Connected to MongoDB');

    // Create indexes for performance
    await db.collection('clients').createIndex({ email: 1 }, { unique: true });
    await db.collection('clients').createIndex({ subscription_status: 1 });
    await db.collection('check_ins').createIndex({ client_id: 1, date: -1 });

    return db;
}

export async function closeDB() {
    if (client) {
        await client.close();
        console.log('👋 MongoDB connection closed');
    }
}

export function getDB() {
    if (!db) {
        throw new Error('Database not initialized. Call connectDB() first.');
    }
    return db;
}
