import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';
dotenv.config({ path: '/Users/admin/Fitnessprac/.env' });

async function main() {
    const uri = process.env.MONGO_URI;
    if (!uri) { console.error('No MONGO_URI'); process.exit(1); }
    const dbName = process.env.DB_NAME || 'fitnessprac';

    const coachId = process.env.COACH_ID;
    if (!coachId) { console.error('No COACH_ID env var'); process.exit(1); }

    const client = await MongoClient.connect(uri);
    const db = client.db(dbName);


    const result = await db.collection('clients').updateMany(
        {},
        { $set: { coach_id: coachId } }
    );
    console.log(`✅ Updated ${result.modifiedCount} clients with coach_id: ${coachId}`);

    const clients = await db.collection('clients').find({}).project({ id: 1, name: 1, coach_id: 1 }).toArray();
    for (const c of clients) {
        console.log(`  - ${c.name} (id: ${c.id}) → coach_id: ${c.coach_id}`);
    }

    await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
