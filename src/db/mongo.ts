import { MongoClient, Db } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const client = new MongoClient(process.env.MONGO_URI!);
let db: Db | null = null;

export async function getDb() {
    if (db) return db;

    await client.connect();
    db = client.db(process.env.DB_NAME);
    console.log('✅ Connected to MongoDB');
    return db;
}

export async function closeDb() {
    if (client) {
        await client.close();
        db = null;
        console.log('👋 MongoDB connection closed');
    }
}
