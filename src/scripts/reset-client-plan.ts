/**
 * reset-client-plan.ts
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * DEVELOPMENT-ONLY TOOL — DO NOT RUN IN PRODUCTION
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Safely resets ONE client's plan state so they can re-enter the full
 * plan-selection → payment → activation flow from scratch.
 *
 * WHAT THIS SCRIPT TOUCHES:
 *   ✅ client_plans  — marks all active/expired plans for this client → 'cancelled'
 *   ✅ payments      — marks all pending simulated payments → 'cancelled'
 *   ✅ clients       — resets plan_status → 'none', clears selected_plan_id
 *
 * WHAT THIS SCRIPT NEVER TOUCHES:
 *   ❌ coaches       — UNTOUCHED
 *   ❌ checkins      — UNTOUCHED
 *   ❌ red_flags     — UNTOUCHED
 *   ❌ bookings      — UNTOUCHED (pass --include-bookings to also cancel them)
 *   ❌ Any other client — only the target email is affected
 *
 * ── USAGE ─────────────────────────────────────────────────────────────────────
 *
 *  DRY RUN (safe preview — no changes made, default):
 *    CLIENT_EMAIL=client@example.com npx tsx src/scripts/reset-client-plan.ts
 *
 *  LIVE RESET (irreversible for this client's plan data):
 *    CLIENT_EMAIL=client@example.com CONFIRM_RESET=true npx tsx src/scripts/reset-client-plan.ts
 *
 *  LIVE RESET + cancel pending bookings:
 *    CLIENT_EMAIL=client@example.com CONFIRM_RESET=true npx tsx src/scripts/reset-client-plan.ts --include-bookings
 *
 * ── SAFETY SUMMARY ────────────────────────────────────────────────────────────
 *
 *  • Requires CLIENT_EMAIL env var — no default, no wildcards.
 *  • Dry-run by default — data is only changed when CONFIRM_RESET=true is set.
 *  • Every record found is printed before any change is made.
 *  • Plans are CANCELLED (soft), not deleted — history is preserved in MongoDB.
 *  • Only payments with payment_intent_id starting with 'sim_' are cancelled
 *    (simulated payments). Real payments (future) are reported but not touched.
 *  • Exits with code 1 on any error so CI pipelines catch failures.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { getDb, closeDb } from '../db/mongo';

// ─── Config ───────────────────────────────────────────────────────────────────

const CLIENT_EMAIL    = process.env['CLIENT_EMAIL']?.toLowerCase().trim();
const CONFIRM_RESET   = process.env['CONFIRM_RESET'] === 'true';
const INCLUDE_BOOKINGS = process.argv.includes('--include-bookings');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function line(char = '─', width = 70) {
    console.log(char.repeat(width));
}

function banner(title: string) {
    line();
    console.log(`  ${title}`);
    line();
}

function pad(label: string, value: string, width = 22) {
    console.log(`  ${label.padEnd(width)}: ${value}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function resetClientPlan() {

    // ── 0. Guard: require CLIENT_EMAIL ────────────────────────────────────────

    if (!CLIENT_EMAIL) {
        console.error('');
        console.error('❌  CLIENT_EMAIL is required.');
        console.error('');
        console.error('    Usage:');
        console.error('      CLIENT_EMAIL=client@example.com npx tsx src/scripts/reset-client-plan.ts');
        console.error('');
        console.error('    To actually reset (not just preview):');
        console.error('      CLIENT_EMAIL=client@example.com CONFIRM_RESET=true npx tsx src/scripts/reset-client-plan.ts');
        console.error('');
        process.exit(1);
    }

    banner('FitnessGuruSG — Client Plan Reset Script');

    if (!CONFIRM_RESET) {
        console.log('  🔍  DRY RUN MODE — nothing will be changed.');
        console.log('      Set CONFIRM_RESET=true to apply the reset.');
    } else {
        console.log('  ⚠️   LIVE MODE — changes WILL be written to MongoDB.');
    }
    if (INCLUDE_BOOKINGS) {
        console.log('  📅  --include-bookings flag detected — pending bookings will also be cancelled.');
    }
    console.log('');

    const db = await getDb();

    // ── 1. Find the client ────────────────────────────────────────────────────

    banner('Step 1 — Locate Client');

    const clientDoc = await db.collection('clients').findOne(
        { email: CLIENT_EMAIL },
        { projection: { _id: 1, id: 1, name: 1, email: 1, coach_id: 1, plan_status: 1, selected_plan_id: 1 } }
    );

    if (!clientDoc) {
        console.error(`❌  No client found with email: ${CLIENT_EMAIL}`);
        console.error('    Check the email address and try again.');
        process.exit(1);
    }

    const clientId   = clientDoc.id as string;   // app-level UUID
    const mongoId    = clientDoc._id.toString();  // MongoDB _id

    pad('Name',              clientDoc.name ?? '(no name)');
    pad('Email',             clientDoc.email);
    pad('App UUID (id)',     clientId   ?? '(none — coach-provisioned)');
    pad('MongoDB _id',       mongoId);
    pad('Coach linked',      clientDoc.coach_id ? `✅ ${clientDoc.coach_id}` : '⚠️  No coach linked');
    pad('Current plan_status', clientDoc.plan_status ?? 'none');
    pad('selected_plan_id', clientDoc.selected_plan_id ?? '(none)');
    console.log('');

    // Build the ID set — a client may be identified by UUID 'id' (self-registered)
    // or by MongoDB _id string (coach-provisioned legacy clients).
    const idFilter: string[] = [mongoId];
    if (clientId) idFilter.push(clientId);

    // ── 2. Find active/expired client plans ───────────────────────────────────

    banner('Step 2 — Active / Expired Plans');

    const plans = await db.collection('client_plans').find({
        client_id: { $in: idFilter },
        status:    { $in: ['active', 'selected', 'expired'] },
    }).toArray();

    if (plans.length === 0) {
        console.log('  ✅  No active/expired plans found — nothing to reset for client_plans.');
    } else {
        console.log(`  Found ${plans.length} plan record(s) to cancel:\n`);
        for (const p of plans) {
            console.log(`  • Plan    : ${p.plan_name}`);
            console.log(`    Status  : ${p.status}`);
            console.log(`    Sessions: ${p.sessions_used ?? 0} / ${p.sessions_total ?? 0} used`);
            console.log(`    Started : ${p.start_date ?? '—'}`);
            console.log(`    Expires : ${p.expiry_date ?? '—'}`);
            console.log(`    _id     : ${p._id}`);
            console.log('');
        }
    }

    // ── 3. Find simulated pending payments ────────────────────────────────────

    banner('Step 3 — Pending Payments');

    const allPayments = await db.collection('payments').find({
        client_id: { $in: idFilter },
        status:    'pending',
    }).toArray();

    // Split into simulated (safe to cancel) vs real (do NOT touch)
    const simPayments  = allPayments.filter(p => String(p.payment_intent_id ?? '').startsWith('sim_'));
    const realPayments = allPayments.filter(p => !String(p.payment_intent_id ?? '').startsWith('sim_'));

    if (allPayments.length === 0) {
        console.log('  ✅  No pending payments found.');
    } else {
        if (simPayments.length > 0) {
            console.log(`  Found ${simPayments.length} simulated pending payment(s) to cancel:\n`);
            for (const p of simPayments) {
                console.log(`  • Payment  : $${p.amount_sgd} SGD — ${p.plan_name}`);
                console.log(`    Intent ID: ${p.payment_intent_id}`);
                console.log(`    _id      : ${p._id}`);
                console.log('');
            }
        }
        if (realPayments.length > 0) {
            console.log(`  ⚠️   Found ${realPayments.length} NON-SIMULATED pending payment(s) — these will NOT be touched:\n`);
            for (const p of realPayments) {
                console.log(`  • Payment  : $${p.amount_sgd} SGD — ${p.plan_name}`);
                console.log(`    Intent ID: ${p.payment_intent_id ?? '(no intent)'}`);
                console.log(`    _id      : ${p._id}`);
                console.log('');
            }
        }
    }

    // ── 4. Find pending bookings (optional) ───────────────────────────────────

    let pendingBookings: any[] = [];
    if (INCLUDE_BOOKINGS) {
        banner('Step 4 — Pending Bookings (--include-bookings)');

        pendingBookings = await db.collection('bookings').find({
            client_id: { $in: idFilter },
            status:    'booked',
        }).toArray();

        if (pendingBookings.length === 0) {
            console.log('  ✅  No pending bookings found.');
        } else {
            console.log(`  Found ${pendingBookings.length} pending booking(s) to cancel:\n`);
            for (const b of pendingBookings) {
                console.log(`  • Booking : ${b.date} ${b.start_time}–${b.end_time}`);
                console.log(`    Status  : ${b.status}`);
                console.log(`    _id     : ${b._id}`);
                console.log('');
            }
        }
    }

    // ── 5. Summary before action ──────────────────────────────────────────────

    banner('Step 5 — Reset Plan');
    console.log('  Planned changes:');
    console.log(`    client_plans  → ${plans.length} record(s) status: 'cancelled'`);
    console.log(`    payments      → ${simPayments.length} simulated pending record(s) status: 'cancelled'`);
    console.log(`    clients       → plan_status: 'none', selected_plan_id: null`);
    if (INCLUDE_BOOKINGS) {
        console.log(`    bookings      → ${pendingBookings.length} booking(s) status: 'cancelled'`);
    }
    console.log('');
    console.log('  Untouched:');
    console.log('    coaches       ✅  never touched');
    console.log('    checkins      ✅  never touched');
    console.log('    red_flags     ✅  never touched');
    if (!INCLUDE_BOOKINGS) {
        console.log('    bookings      ✅  never touched (pass --include-bookings to cancel pending bookings)');
    }
    if (realPayments.length > 0) {
        console.log(`    ${realPayments.length} real payment(s) ✅  never touched (not simulated)`);
    }
    console.log('');

    if (!CONFIRM_RESET) {
        line('═');
        console.log('  🔍  DRY RUN complete — no changes were made.');
        console.log('');
        console.log('  To apply the reset, run:');
        console.log(`    CLIENT_EMAIL=${CLIENT_EMAIL} CONFIRM_RESET=true npx tsx src/scripts/reset-client-plan.ts`);
        line('═');
        console.log('');
        await closeDb();
        process.exit(0);
    }

    // ── 6. LIVE RESET ─────────────────────────────────────────────────────────
    // Only reached when CONFIRM_RESET=true

    const now = new Date();

    // 6a. Cancel all active/expired plans for this client
    let plansCancelled = 0;
    if (plans.length > 0) {
        const planIds = plans.map(p => p._id);
        const pr = await db.collection('client_plans').updateMany(
            { _id: { $in: planIds } },
            { $set: { status: 'cancelled', updated_at: now } }
        );
        plansCancelled = pr.modifiedCount;
    }

    // 6b. Cancel simulated pending payments only
    let paymentsCancelled = 0;
    if (simPayments.length > 0) {
        const simIds = simPayments.map(p => p._id);
        const pr = await db.collection('payments').updateMany(
            { _id: { $in: simIds } },
            { $set: { status: 'cancelled', updated_at: now } }
        );
        paymentsCancelled = pr.modifiedCount;
    }

    // 6c. Reset client plan_status and clear selected_plan_id
    await db.collection('clients').updateOne(
        { email: CLIENT_EMAIL },
        {
            $set:   { plan_status: 'none', updated_at: now },
            $unset: { selected_plan_id: '', payment_intent_id: '' },
        }
    );

    // 6d. Cancel pending bookings (optional)
    let bookingsCancelled = 0;
    if (INCLUDE_BOOKINGS && pendingBookings.length > 0) {
        const bookingIds = pendingBookings.map(b => b._id);
        const br = await db.collection('bookings').updateMany(
            { _id: { $in: bookingIds } },
            { $set: { status: 'cancelled', updated_at: now } }
        );
        bookingsCancelled = br.modifiedCount;
    }

    // ── 7. Confirm ────────────────────────────────────────────────────────────

    line('═');
    console.log('  ✅  RESET COMPLETE\n');
    console.log(`  • client_plans  : ${plansCancelled} plan(s) → cancelled`);
    console.log(`  • payments      : ${paymentsCancelled} simulated payment(s) → cancelled`);
    console.log(`  • clients       : plan_status → 'none', selected_plan_id cleared`);
    if (INCLUDE_BOOKINGS) {
        console.log(`  • bookings      : ${bookingsCancelled} booking(s) → cancelled`);
    }
    console.log('');
    console.log('  Next steps:');
    console.log('  1. Restart the backend  →  npm run server');
    console.log('  2. Log out and log back in as the client');
    console.log('  3. Open My Plan — should show available packages');
    console.log('  4. Select a plan and complete the simulated payment');
    line('═');
    console.log('');

    await closeDb();
    process.exit(0);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

resetClientPlan().catch(err => {
    console.error('');
    console.error('❌  Script failed with an unexpected error:');
    console.error('   ', err?.message ?? err);
    console.error('');
    process.exit(1);
});
