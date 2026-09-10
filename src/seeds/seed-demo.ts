/**
 * seed-demo.ts — Full demo data seed for FitnessGuruSG
 *
 * Creates:
 *   - 4 clients linked to the demo coach
 *   - Active session plans for each client
 *   - Today's bookings (mix of done, upcoming, missed)
 *   - Availability slots for each booking
 *   - 7 days of check-ins
 *
 * Run with: npx tsx src/seeds/seed-demo.ts
 */

import { MongoClient, ObjectId } from 'mongodb';
import * as bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error('❌ MONGO_URI is not set. Add it to .env before running this seed.');
    process.exit(1);
}
const DB_NAME   = process.env.DB_NAME   ?? 'fitnessprac';

// ── The real coach account we just created ────────────────────────────────────
const COACH_ID    = '69e1e28fc48d7df8efb81eb7';
const COACH_EMAIL = 'demo@fitnessgurusg.com';

// ── Today in SGT ──────────────────────────────────────────────────────────────
function todaySGT(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}
function daysAgo(n: number): string {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

async function main() {
    const mongo = new MongoClient(MONGO_URI);
    await mongo.connect();
    const db = mongo.db(DB_NAME);
    console.log(`\n🌱  Seeding demo data into "${DB_NAME}" for coach ${COACH_EMAIL}\n`);

    // ── 1. Wipe old demo data for this coach ──────────────────────────────────
    await db.collection('clients').deleteMany({ coach_id: COACH_ID });
    await db.collection('bookings').deleteMany({ coach_id: COACH_ID });
    await db.collection('availability_slots').deleteMany({ coach_id: COACH_ID });
    await db.collection('client_plans').deleteMany({ coach_id: COACH_ID });
    await db.collection('check_ins').deleteMany({});  // safe — fresh DB
    console.log('🗑   Cleared old demo records');

    // ── 2. Clients ────────────────────────────────────────────────────────────
    const now = new Date();
    // NOTE: 'id' field must equal _id.toString() —
    // getAllClients() returns c.id (not c._id), and the dashboard
    // builds clientNameMap keyed by c.id. Without this field,
    // all booking client names show as 'Unknown'.
    const makeClient = (name: string, email: string, phone: string, notes: string) => {
        const _id = new ObjectId();
        return { _id, id: _id.toString(), coach_id: COACH_ID, name, email, phone, notes, created_at: now, updated_at: now };
    };
    const clientDocs = [
        makeClient('Mark Lee',   'mark.lee@demo.com',   '+65 9111 2222', 'Wants to lose 5kg before wedding in July.'),
        makeClient('Priya Nair', 'priya.nair@demo.com', '+65 9333 4444', 'Building muscle. Very consistent.'),
        makeClient('David Tan',  'david.tan@demo.com',  '+65 9555 6666', 'Busy exec. Sometimes cancels last minute.'),
        makeClient('Sarah Wong', 'sarah.wong@demo.com', '+65 9777 8888', 'Post-partum recovery. Gentle pacing.'),
    ];
    await db.collection('clients').insertMany(clientDocs);
    console.log(`✅  ${clientDocs.length} clients created`);

    const [mark, priya, david, sarah] = clientDocs;

    // ── 3. Session plans ──────────────────────────────────────────────────────
    const expiryFar    = '2026-12-31';
    const expirySoon   = '2026-06-12'; // expiring within 30 days from May 2026
    const planDocs = [
        {
            // Mark — Elite Pack, 7 sessions used of 30
            _id:            new ObjectId(),
            coach_id:       COACH_ID,
            client_id:      mark.id,
            plan_name:      'Elite Pack',
            sessions_total: 30,
            sessions_used:  7,
            start_date:     daysAgo(30),
            expiry_date:    expiryFar,
            status:         'active',
            created_at:     now,
            updated_at:     now,
        },
        {
            // Priya — Performance Pack, 8 of 20 used (expiring soon — coach should follow up)
            _id:            new ObjectId(),
            coach_id:       COACH_ID,
            client_id:      priya.id,
            plan_name:      'Performance Pack',
            sessions_total: 20,
            sessions_used:  8,
            start_date:     daysAgo(45),
            expiry_date:    expirySoon,
            status:         'active',
            created_at:     now,
            updated_at:     now,
        },
        {
            // David — Starter Pack, 2 of 10 used
            _id:            new ObjectId(),
            coach_id:       COACH_ID,
            client_id:      david.id,
            plan_name:      'Starter Pack',
            sessions_total: 10,
            sessions_used:  2,
            start_date:     daysAgo(14),
            expiry_date:    expiryFar,
            status:         'active',
            created_at:     now,
            updated_at:     now,
        },
        {
            // Sarah — Performance Pack, 1 of 20 used
            _id:            new ObjectId(),
            coach_id:       COACH_ID,
            client_id:      sarah.id,
            plan_name:      'Performance Pack',
            sessions_total: 20,
            sessions_used:  1,
            start_date:     daysAgo(7),
            expiry_date:    expiryFar,
            status:         'active',
            created_at:     now,
            updated_at:     now,
        },
    ];
    await db.collection('client_plans').insertMany(planDocs);
    console.log(`✅  ${planDocs.length} session plans created`);

    // ── 4. Today's availability slots + bookings ──────────────────────────────
    const today = todaySGT();

    // Helper — create slot + booking pair
    async function bookSession(
        client: typeof mark,
        startTime: string,
        endTime: string,
        status: 'booked' | 'completed' | 'cancelled',
        notes?: string,
    ) {
        const slotId = new ObjectId();
        await db.collection('availability_slots').insertOne({
            _id:        slotId,
            coach_id:   COACH_ID,
            date:       today,
            start_time: startTime,
            end_time:   endTime,
            is_booked:  status !== 'cancelled',
            booked_by:  status !== 'cancelled' ? client.id : null,
            created_at: now,
            updated_at: now,
        });
        await db.collection('bookings').insertOne({
            _id:                  new ObjectId(),
            coach_id:             COACH_ID,
            client_id:            client.id,   // must match c.id used by clientNameMap
            client_name:          client.name,
            availability_slot_id: slotId.toString(),
            date:                 today,
            start_time:           startTime,
            end_time:             endTime,
            status,
            notes:                notes ?? '',
            created_at:           now,
            updated_at:           now,
        });
    }

    // Today's schedule — a realistic mix for the timeline
    await bookSession(mark,   '07:00', '08:00', 'completed', 'Great session — hit new PR on squats');
    await bookSession(priya,  '09:00', '10:00', 'completed', 'Upper body focus');
    await bookSession(david,  '11:00', '12:00', 'cancelled', 'Client cancelled — work emergency');
    await bookSession(sarah,  '14:00', '15:00', 'booked',    'Recovery + mobility');
    await bookSession(mark,   '16:00', '17:00', 'booked',    'Cardio + stretching');
    console.log(`✅  5 today's bookings created (2 done, 1 cancelled, 2 upcoming)`);

    // ── 5. Historical bookings (past 7 days for streak tracking) ─────────────
    const historyClients = [mark, priya, david];
    const times = ['08:00', '09:00', '10:00'];
    let histCount = 0;
    for (let daysBack = 6; daysBack >= 1; daysBack--) {
        const pastDate = daysAgo(daysBack);
        for (let ci = 0; ci < historyClients.length; ci++) {
            const c = historyClients[ci];
            // David misses every other day (shows streak reset pattern)
            const skip = (c.name === 'David Tan' && daysBack % 2 === 0);
            if (skip) continue;
            const slotId = new ObjectId();
            await db.collection('availability_slots').insertOne({
                _id: slotId, coach_id: COACH_ID, date: pastDate,
                start_time: times[ci], end_time: `${String(Number(times[ci].split(':')[0]) + 1).padStart(2,'0')}:00`,
                is_booked: true, booked_by: c.id, created_at: now, updated_at: now,
            });
            await db.collection('bookings').insertOne({
                _id: new ObjectId(), coach_id: COACH_ID,
                client_id: c.id, client_name: c.name,
                availability_slot_id: slotId.toString(), date: pastDate,
                start_time: times[ci],
                end_time: `${String(Number(times[ci].split(':')[0]) + 1).padStart(2,'0')}:00`,
                status: 'completed', notes: '', created_at: now, updated_at: now,
            });
            histCount++;
        }
    }
    console.log(`✅  ${histCount} historical bookings created (for streak tracking)`);

    // ── 6. Check-ins (past 7 days — powers the Clients screen) ───────────────
    const checkInDocs: any[] = [];
    const checkInClients = [
        { doc: mark,  energyBase: 8, missToday: false },
        { doc: priya, energyBase: 7, missToday: false },
        { doc: david, energyBase: 5, missToday: true  }, // David missed today
        { doc: sarah, energyBase: 6, missToday: false },
    ];
    for (let daysBack = 6; daysBack >= 0; daysBack--) {
        const checkDate = daysAgo(daysBack);
        for (const { doc, energyBase, missToday } of checkInClients) {
            if (daysBack === 0 && missToday) continue; // David has no check-in today
            checkInDocs.push({
                _id:        new ObjectId(),
                client_id:  doc.id,   // matches getStreaksForClients query on 'checkins'
                coach_id:   COACH_ID,
                date:       checkDate,
                energy:     Math.max(1, Math.min(10, energyBase + Math.floor(Math.random() * 3) - 1)),
                mood:       Math.max(1, Math.min(10, energyBase + Math.floor(Math.random() * 3) - 1)),
                sleep:      Math.max(1, Math.min(10, 6 + Math.floor(Math.random() * 3))),
                notes:      daysBack === 0 ? 'Today check-in' : `Day -${daysBack}`,
                created_at: now,
                updated_at: now,
            });
        }
    }
    // IMPORTANT: Must be 'checkins' — getStreaksForClients and getCheckInStatusForClients
    // both query the 'checkins' collection. Writing to 'check_ins' would break streaks.
    await db.collection('checkins').insertMany(checkInDocs);
    console.log(`✅  ${checkInDocs.length} check-ins created`);

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log(`
╔═══════════════════════════════════════════════════════╗
║  ✅  SEED COMPLETE                                    ║
╠═══════════════════════════════════════════════════════╣
║  Login:    demo@fitnessgurusg.com                     ║
║  Password: Demo1234!                                  ║
║                                                       ║
║  Clients:  Mark Lee, Priya Nair, David Tan, Sarah Wong║
║  Plans:    All clients have active session plans      ║
║  Today:    5 bookings (2 done, 1 cancelled, 2 booked) ║
║  History:  6 days of past sessions for streak data    ║
║  Streaks:  Mark=6 🔥  Priya=6 🔥  David=3  Sarah=1   ║
╠═══════════════════════════════════════════════════════╣
║  ⚠️  Log IN with the demo account above              ║
║  The old coach@test.com password is unknown           ║
╚═══════════════════════════════════════════════════════╝
`);

    await mongo.close();
}

main().catch(err => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
});
