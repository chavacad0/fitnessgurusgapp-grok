import { MongoClient, Db } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const client = new MongoClient(process.env.MONGO_URI!);
let db: Db | null = null;

/**
 * Connection promise singleton.
 * Prevents duplicate connect() calls when concurrent requests arrive
 * before the first connection resolves.
 */
let connectionPromise: Promise<Db> | null = null;

export async function getDb(): Promise<Db> {
    if (db) return db;

    // Serialize concurrent calls — only one connect() in flight at a time
    if (!connectionPromise) {
        connectionPromise = (async () => {
            await client.connect();
            db = client.db(process.env.DB_NAME);
            console.log('✅ Connected to MongoDB');
            await initIndexes(db);
            return db;
        })();
    }

    return connectionPromise;
}

/**
 * Create all required compound indexes on startup.
 * Uses createIndex with { background: true } — safe to call on every startup
 * (MongoDB ignores already-existing identical indexes).
 *
 * Index rationale:
 *
 *  coaches.email (unique)
 *    → Every login does findOne({ email }). Without this, full collection scan.
 *
 *  clients.coach_id
 *    → GET /api/clients fetches all clients for a coach. Core hot path.
 *
 *  clients.{ id, coach_id } (compound)
 *    → validateClientOwnership() does findOne({ id, coach_id }) before EVERY
 *      per-client operation (checkins, redflags). Without index: O(n) scan
 *      per API call per client.
 *
 *  checkins.{ client_id, date } (compound, unique)
 *    → getCheckInByClientAndDate() and getRecentCheckIns() both filter on
 *      this pair. The unique constraint also enforces the one-check-in-per-day
 *      business rule at the DB level, providing a safety net beyond app logic.
 *
 *  red_flags.{ client_id, type } (compound, unique)
 *    → getExistingRedFlag() does findOne({ client_id, type }) on every check-in
 *      submission (once per flag rule = up to 5 times). Without index: 5 full
 *      collection scans per check-in. The unique constraint enforces the
 *      one-flag-per-type-per-client rule at the DB level.
 */
async function initIndexes(db: Db): Promise<void> {
    try {
        // coaches
        await db.collection('coaches').createIndex(
            { email: 1 },
            { unique: true, name: 'coaches_email_unique' }
        );

        // clients
        await db.collection('clients').createIndex(
            { coach_id: 1 },
            { name: 'clients_by_coach' }
        );
        await db.collection('clients').createIndex(
            { id: 1, coach_id: 1 },
            { name: 'clients_ownership_lookup' }
        );

        // checkins
        await db.collection('checkins').createIndex(
            { client_id: 1, date: 1 },
            { unique: true, name: 'checkins_one_per_day' }
        );

        // photos
        //  → GET /api/photos/:id looks the file up by its UUID.
        //  → A check-in save confirms each id belongs to that client.
        await db.collection('photos').createIndex(
            { id: 1 },
            { unique: true, name: 'photos_id_unique' }
        );
        await db.collection('photos').createIndex(
            { client_id: 1, created_at: -1 },
            { name: 'photos_by_client' }
        );

        // red_flags
        await db.collection('red_flags').createIndex(
            { client_id: 1, type: 1 },
            { unique: true, name: 'redflags_one_per_type' }
        );

        // client_plans
        //  → getActivePlanForClient() filters { client_id, status: 'active' } — hot path
        //    on every session completion and status endpoint call.
        await db.collection('client_plans').createIndex(
            { client_id: 1 },
            { name: 'plans_by_client' }
        );
        await db.collection('client_plans').createIndex(
            { client_id: 1, status: 1 },
            { name: 'plans_active_lookup' }
        );
        await db.collection('client_plans').createIndex(
            { coach_id: 1 },
            { name: 'plans_by_coach' }
        );

        // coach_availability
        //  → GET /coach/availability filters { coach_id, date >= today } — per-request.
        await db.collection('coach_availability').createIndex(
            { coach_id: 1, date: 1 },
            { name: 'availability_by_coach_date' }
        );

        // bookings
        //  → Dashboard and bookings list filter by coach_id + date.
        //  → Client view filters by client_id + status.
        await db.collection('bookings').createIndex(
            { coach_id: 1, date: 1 },
            { name: 'bookings_by_coach_date' }
        );
        await db.collection('bookings').createIndex(
            { client_id: 1, status: 1 },
            { name: 'bookings_by_client_status' }
        );
        // Sparse so a cancelled booking can omit availability_slot_id and free the slot.
        // Cancel clears that field. Documents that still point at the slot keep it unique.
        await db.collection('bookings').createIndex(
            { availability_slot_id: 1 },
            { unique: true, sparse: true, name: 'bookings_slot_unique' }
        );

        // payments
        //  → getPendingPaymentsForCoach filters { coach_id, status: 'pending' }
        //  → getPaymentsByClient filters { client_id }
        //  → coach payment ledger sorts by paid_at DESC
        await db.collection('payments').createIndex(
            { client_id: 1 },
            { name: 'payments_by_client' }
        );
        await db.collection('payments').createIndex(
            { coach_id: 1, status: 1 },
            { name: 'payments_by_coach_status' }
        );
        await db.collection('payments').createIndex(
            { coach_id: 1, paid_at: -1 },
            { name: 'payments_by_coach_date' }
        );

        // clients.google_id (unique, partial)
        //  → POST /auth/google looks clients up by google_id; the unique constraint
        //    prevents two client records for one Google account (duplicate identity).
        //    Partial filter: only documents that HAVE a google_id string are indexed,
        //    so existing clients without the field are unaffected.
        await db.collection('clients').createIndex(
            { google_id: 1 },
            {
                unique: true,
                partialFilterExpression: { google_id: { $type: 'string' } },
                name: 'clients_google_id_unique',
            }
        );

        console.log('✅ MongoDB indexes verified');

    } catch (err: any) {
        // Log but do not crash — indexes are a performance and safety net,
        // not a boot-critical concern. If an index exists with a different
        // definition, MongoDB will error here and the log will show it.
        console.error('⚠️ Index creation warning:', err.message);
    }
}

export async function closeDb(): Promise<void> {
    if (client) {
        await client.close();
        db = null;
        connectionPromise = null;
        console.log('👋 MongoDB connection closed');
    }
}
