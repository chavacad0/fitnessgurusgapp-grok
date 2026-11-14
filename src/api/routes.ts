import { Router, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { createCheckIn, getCheckInsByClient, getCheckInStatusForClients, getStreaksForClients, getMissedStreakForClients, upsertCheckIn, getRecentMoodForClients } from '../repositories/mongoCheckinRepo';
import { worthACheckIn } from '../domain/checkInScale';
import { getRedFlagsByClient } from '../repositories/mongoRedFlagRepo';
import { detectRedFlagsForClient } from '../services/mongoRedFlagDetectorService';
import { getAllClients, validateClientOwnership } from '../repositories/mongoClientRepo';
import { assignPlanToClient, getActivePlanForClient, computePlanStatus } from '../repositories/mongoClientPlanRepo';
import { getAvailabilityByCoach, createAvailabilitySlot, blockSlot, unblockSlot, getAvailabilitySlotById } from '../repositories/mongoAvailabilityRepo';
import { getSessionStatus, completeSession, enrichWithSessionStatus } from '../services/sessionService';
import { bookSession, completeBookingById, cancelBookingById, rescheduleBookingById, getDashboardSummary, quickBookSession } from '../services/bookingService';
import { getBookingsByClient, cancelBookingByClient } from '../repositories/mongoBookingRepo';
import { initiatePayment, confirmPaymentAndAssignPlan, getPendingPayments, getClientPaymentHistory } from '../services/paymentService';
import { createClientPaymentIntent, confirmClientPayment } from '../services/clientPaymentService';
import { getMonthlyRevenueForCoach } from '../repositories/mongoPaymentRepo';
import { getActivePlansForCoach } from '../repositories/mongoClientPlanRepo';
import { SESSION_PLANS, getPlanById } from '../config/plans';
import { getDb } from '../db/mongo';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/requireRole';
import { clientAuthMiddleware } from '../middleware/clientAuthMiddleware';
import { updateClientPlanStatus, findClientById, updateClientBodyProfile } from '../repositories/mongoClientAuthRepo';
import { canEditCheckIn } from '../utils/checkInEditWindow';
import { photoUrlsForCheckIn, PhotoInputError } from '../repositories/mongoPhotoRepo';
import {
    createWorkoutAssignment,
    getWorkoutAssignmentForClient,
    getWorkoutAssignmentsByCoach,
    upsertWorkoutLog,
    getWorkoutLogForAssignment,
    getWorkoutHistoryForClient,
} from '../repositories/mongoWorkoutRepo';

const router = Router();

// ─── Logging helpers ──────────────────────────────────────────────────────────

function log(route: string, message: string, data?: any) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${route}] ${message}`, data || '');
}

function logError(route: string, error: any) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [${route}] ❌ ERROR:`, error.message || error);
}

function logOwnershipViolation(route: string, coachId: string, clientId: string) {
    const timestamp = new Date().toISOString();
    console.warn(`[${timestamp}] [${route}] 🚨 OWNERSHIP VIOLATION: coach ${coachId} attempted access to client ${clientId}`);
}

// ─── Utils ────────────────────────────────────────────────────────────────────

/** Sends the error response from a service-layer Error with optional statusCode. */
function handleServiceError(res: Response, route: string, error: any) {
    const status = error.statusCode ?? 500;
    if (status < 500) {
        res.status(status).json({ success: false, error: error.message });
    } else {
        logError(route, error);
        res.status(500).json({ success: false, error: error.message });
    }
}

// ─── Health Check — PUBLIC ────────────────────────────────────────────────────

/**
 * GET /api/health — public, no auth required
 */
router.get('/health', async (_req: Request, res: Response) => {
    log('GET /health', 'Health check requested');
    try {
        const db = await getDb();
        await db.admin().ping();
        log('GET /health', '✅ MongoDB connection healthy');
        res.json({ status: 'ok', mongodb: 'connected', timestamp: new Date().toISOString() });
    } catch (error: any) {
        logError('GET /health', error);
        res.status(500).json({ status: 'error', mongodb: 'disconnected', error: error.message });
    }
});

// ─── Apply auth to all protected route groups ─────────────────────────────────

router.use('/clients', authMiddleware);
router.use('/coach', authMiddleware);
router.use('/bookings', authMiddleware);
router.use('/payments', authMiddleware);
// Coach doors. Client /me routes live under /clients and are not included here.
// Payment routes that a client calls (/payments/client-*) stay open to clients
// and get requireRole only on the coach handlers below.
router.use('/coach', requireRole('coach'));
router.use('/bookings', requireRole('coach'));
// /plans is intentionally PUBLIC — no auth required (plan catalogue)

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/clients
 * Returns all clients scoped to the authenticated coach.
 */
router.get('/clients', requireRole('coach'), async (req: AuthenticatedRequest, res: Response) => {
    const coachId = req.coach!.sub;
    log('GET /clients', `Fetching clients for coach ${coachId}`);
    try {
        const clients = await getAllClients(coachId);
        log('GET /clients', `✅ Retrieved ${clients.length} clients`);
        res.json({ success: true, clients, count: clients.length });
    } catch (error: any) {
        logError('GET /clients', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/clients/status?date=YYYY-MM-DD
 * Coach action queue — check-in status + session plan badges for all clients.
 *
 * Returns streak, lastCheckInDate, hasCheckedInToday + session plan fields
 * (plan_name, sessions_remaining, expiry_date, plan_status) per client.
 * Session fields are only present when the client has an active plan.
 *
 * worth_check_in is true when that client's last 3 check-ins are low energy
 * and Always hungry. Coach-only. A client token cannot call this route.
 */
router.get('/clients/status', requireRole('coach'), async (req: AuthenticatedRequest, res: Response) => {
    const coachId = req.coach!.sub;
    const date = (req.query['date'] as string) || new Date().toISOString().split('T')[0];

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ success: false, error: 'Invalid date format. Expected YYYY-MM-DD.' });
    }

    log('GET /clients/status', `Fetching status for coach ${coachId} on date ${date}`);

    try {
        const clients = await getAllClients(coachId);
        if (clients.length === 0) return res.json({ success: true, date, clients: [] });

        const clientIds = clients.map(c => c.id);

        // 5 parallel queries: check-in status, streaks, missed-streaks, session plans, recent mood
        const [{ todaySet, latestDateMap }, streakMap, missedStreakMap, sessionMap, moodMap] = await Promise.all([
            getCheckInStatusForClients(clientIds, date),
            getStreaksForClients(clientIds, date),
            getMissedStreakForClients(clientIds, date),
            enrichWithSessionStatus(clientIds),
            getRecentMoodForClients(clientIds, 3),
        ]);

        const PAUSE_THRESHOLD = 3;
        const statusList = clients.map(client => {
            const sessionStatus    = sessionMap.get(client.id);
            const missedStreak     = missedStreakMap.get(client.id) ?? 0;
            // check_in_status: stored value wins; auto-derive 'paused' when streak >= threshold.
            const storedStatus     = (client as any).check_in_status as 'active' | 'paused' | undefined;
            const derivedStatus: 'active' | 'paused' =
                storedStatus === 'paused' ? 'paused' :
                missedStreak >= PAUSE_THRESHOLD ? 'paused' : 'active';
            return {
                clientId: client.id,
                clientName: client.name,
                hasCheckedInToday: todaySet.has(client.id),
                lastCheckInDate: latestDateMap.get(client.id) ?? null,
                streak: streakMap.get(client.id) ?? 0,
                missed_checkin_streak: missedStreak,
                check_in_status: derivedStatus,
                check_in_reminders_enabled: (client as any).check_in_reminders_enabled as boolean | undefined,
                worth_check_in: worthACheckIn(moodMap.get(client.id) ?? []),
                // Session plan fields — only present when has_plan = true
                ...(sessionStatus?.has_plan && {
                    plan_name: sessionStatus.plan_name,
                    plan_status: sessionStatus.plan_status,
                    sessions_total: sessionStatus.sessions_total,
                    sessions_used: sessionStatus.sessions_used,
                    sessions_remaining: sessionStatus.sessions_remaining,
                    expiry_date: sessionStatus.expiry_date,
                }),
            };
        });

        log('GET /clients/status', `✅ Status fetched for ${clients.length} clients (date: ${date})`);
        res.json({ success: true, date, clients: statusList });
    } catch (error: any) {
        logError('GET /clients/status', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT-SCOPED ROUTES — require clientAuthMiddleware (role: 'client' JWT)
//
// IMPORTANT: These literal-path routes (/clients/me/*, /clients/select-plan)
// MUST be registered BEFORE the parameterized /clients/:clientId/* routes.
// If registered after, Express matches ':clientId = "me"' on the param route
// and calls requireClientOwnership("me", coachId) → "Access denied".
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/clients/select-plan
 * Client selects a session plan. Does NOT activate it — payment is required next.
 *
 * Body: { plan_id: 'starter' | 'performance' | 'elite' }
 *
 * State transition: plan_status: 'none' | any → 'selected'
 * Idempotent: calling again with a different plan updates the selection.
 */
router.post('/clients/select-plan', clientAuthMiddleware, async (req: Request, res: Response) => {
    const { clientId } = req.clientAuth!;
    const { plan_id } = req.body as { plan_id?: string };

    if (!plan_id) {
        res.status(400).json({ success: false, error: 'plan_id is required' });
        return;
    }

    const plan = getPlanById(plan_id);
    if (!plan) {
        res.status(400).json({
            success: false,
            error: `Invalid plan_id '${plan_id}'. Valid options: starter, performance, elite.`,
        });
        return;
    }

    log('POST /clients/select-plan', `Client ${clientId} selecting plan: ${plan_id}`);

    try {
        await updateClientPlanStatus(clientId, {
            plan_status: 'selected',
            selected_plan_id: plan.id,
        });

        log('POST /clients/select-plan', `✅ Client ${clientId} selected plan ${plan.name}`);

        res.json({
            success: true,
            plan_status: 'selected',
            selected_plan: {
                id: plan.id,
                name: plan.name,
                sessions: plan.sessions,
                price_sgd: plan.price_sgd,
                description: plan.description,
            },
        });
    } catch (error: any) {
        logError('POST /clients/select-plan', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/clients/me/plan
 * Returns the authenticated client's current plan state.
 *
 * Response combines:
 *  - Client doc fields: plan_status, selected_plan_id
 *  - Active ClientPlan from client_plans collection (if exists)
 *  - Sessions remaining (derived: sessions_total - sessions_used)
 */
router.get('/clients/me/plan', clientAuthMiddleware, async (req: Request, res: Response) => {
    const { clientId } = req.clientAuth!;
    log('GET /clients/me/plan', `Client ${clientId} fetching plan status`);

    try {
        const db = await getDb();

        // Fetch client doc (plan_status, selected_plan_id)
        const clientDoc = await db.collection('clients').findOne({ id: clientId });
        if (!clientDoc) {
            res.status(404).json({ success: false, error: 'Client not found' });
            return;
        }

        // Fetch active plan record from client_plans
        const activePlan = await getActivePlanForClient(clientId);

        const response: Record<string, any> = {
            plan_status: clientDoc.plan_status ?? 'none',
            selected_plan_id: clientDoc.selected_plan_id ?? null,
            // has_coach: lets the mobile show ConnectToCoach CTA when false
            has_coach: !!(clientDoc.coach_id),
        };

        if (activePlan) {
            const sessionsRemaining = activePlan.sessions_total - activePlan.sessions_used;
            response['active_plan'] = {
                plan_name: activePlan.plan_name,
                sessions_total: activePlan.sessions_total,
                sessions_used: activePlan.sessions_used,
                sessions_remaining: sessionsRemaining,
                start_date: activePlan.start_date,
                expiry_date: activePlan.expiry_date,
                status: computePlanStatus(activePlan),
            };
        }

        // Attach catalogue details if a plan is selected
        if (clientDoc.selected_plan_id) {
            const plan = getPlanById(clientDoc.selected_plan_id);
            if (plan) {
                response['selected_plan_details'] = {
                    id: plan.id,
                    name: plan.name,
                    sessions: plan.sessions,
                    price_sgd: plan.price_sgd,
                    description: plan.description,
                };
            }
        }

        res.json({ success: true, ...response });
    } catch (error: any) {
        logError('GET /clients/me/plan', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/clients/me/availability
 * Returns open availability slots for the coach (visible to authenticated clients).
 *
 * Protected: client JWT required.
 * Returns: all coach slots from today where is_booked = false AND date+time is in the future.
 *
 * coachId is resolved from the client document (not the JWT) — single-coach architecture.
 * The client JWT only carries clientId; coach linkage lives on the client document in MongoDB.
 */
router.get('/clients/me/availability', clientAuthMiddleware, async (req: Request, res: Response) => {
    const { clientId } = req.clientAuth!;
    log('GET /clients/me/availability', `Client ${clientId} fetching open slots`);

    try {
        // Resolve the coach from the client document
        const db = await getDb();
        const clientDoc = await db.collection('clients').findOne({ id: clientId });
        if (!clientDoc) {
            res.status(404).json({ success: false, error: 'Client account not found. Please sign out and sign in again.' });
            return;
        }
        if (!clientDoc.coach_id) {
            // Valid client, not yet connected to a coach — onboarding state, not an error.
            log('GET /clients/me/availability', `Client ${clientId} has no coach yet — returning onboarding state`);
            res.json({
                success:   true,
                has_coach: false,
                slots:     [],
                message:   'Connect to your coach using an invitation code to view available sessions.',
            });
            return;
        }

        const allSlots = await getAvailabilityByCoach(clientDoc.coach_id);

        // Filter to open slots that haven't started yet (SGT)
        const nowSGT = new Date().toLocaleString('en-CA', { timeZone: 'Asia/Singapore', hour12: false });
        const todaySGT = nowSGT.split(',')[0].trim();   // 'YYYY-MM-DD'
        const timeSGT = nowSGT.split(',')[1].trim().substring(0, 5); // 'HH:MM'

        // Rule: clients may only book from tomorrow onward (1-day advance booking)
        // getTomorrowSGT() returns 'YYYY-MM-DD' for tomorrow in SGT.
        const tomorrowSGT = getTomorrowSGT();

        const openSlots = allSlots
            .filter(slot => {
                // Never show blocked slots or already-booked slots to clients
                if (slot.is_booked) return false;
                if (slot.status === 'blocked') return false;
                // Enforce 1-day advance: only slots from tomorrow onward are visible
                return slot.date >= tomorrowSGT;
            })
            .map(slot => {
                // Strip private coach fields before sending to client
                const { blocked_reason: _r, ...safe } = slot as any;
                return safe;
            });

        log('GET /clients/me/availability', `✅ Returning ${openSlots.length} open slots`);
        res.json({ success: true, has_coach: true, slots: openSlots });
    } catch (error: any) {
        logError('GET /clients/me/availability', error);
        res.status(500).json({ success: false, error: 'Failed to load available slots.' });
    }
});

/**
 * POST /api/clients/me/bookings
 * Client self-books an open availability slot.
 *
 * Protected: client JWT required.
 * Body: { slot_id: string, notes?: string }
 * Returns: { success, booking }
 *
 * Rules enforced by bookSession():
 *  - Slot must exist and be open (is_booked: false)
 *  - Client must have an active plan with sessions remaining
 *  - Atomic slot claim prevents double-booking under concurrency
 */
router.post('/clients/me/bookings', clientAuthMiddleware, async (req: Request, res: Response) => {
    const { clientId } = req.clientAuth!;
    const { slot_id, notes } = req.body as { slot_id?: string; notes?: string };

    if (!slot_id) {
        res.status(400).json({ success: false, error: 'slot_id is required.' });
        return;
    }

    log('POST /clients/me/bookings', `Client ${clientId} booking slot ${slot_id}`);

    try {
        const db = await getDb();
        const clientDoc = await db.collection('clients').findOne({ id: clientId });
        if (!clientDoc) {
            res.status(404).json({ success: false, error: 'Client account not found.' });
            return;
        }
        if (!clientDoc.coach_id) {
            res.status(400).json({
                success:   false,
                has_coach: false,
                error:     'Please connect to your coach with an invitation code before booking a session.',
            });
            return;
        }

        // Rule: clients cannot book same-day sessions — must be at least 1 day in advance
        const slotToBook = await getAvailabilitySlotById(slot_id);
        if (slotToBook) {
            const todaySGT = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
            if (slotToBook.date <= todaySGT) {
                log('POST /clients/me/bookings', `⚠️ Same-day booking blocked for client ${clientId} — slot date: ${slotToBook.date}`);
                res.status(400).json({ success: false, error: 'Bookings must be made at least 1 day in advance. Please choose a future date.' });
                return;
            }
        }

        const booking = await bookSession({
            coach_id: clientDoc.coach_id,
            client_id: clientId,
            availability_slot_id: slot_id,
            notes,
        });

        log('POST /clients/me/bookings', `✅ Booking created: ${booking._id}`);
        res.status(201).json({ success: true, booking });
    } catch (error: any) {
        handleServiceError(res, 'POST /clients/me/bookings', error);
    }
});

/**
 * GET /api/clients/me/bookings
 * Returns all bookings for the authenticated client, newest first.
 *
 * Protected: client JWT required.
 * Returns: { success, bookings }
 */
router.get('/clients/me/bookings', clientAuthMiddleware, async (req: Request, res: Response) => {
    const { clientId } = req.clientAuth!;
    log('GET /clients/me/bookings', `Client ${clientId} fetching bookings`);

    try {
        const bookings = await getBookingsByClient(clientId);
        res.json({ success: true, bookings });
    } catch (error: any) {
        logError('GET /clients/me/bookings', error);
        res.status(500).json({ success: false, error: 'Failed to load bookings.' });
    }
});

/**
 * PATCH /api/clients/me/bookings/:bookingId/cancel
 * Client cancels their own upcoming booking.
 *
 * Protected: client JWT required.
 * A client can only cancel bookings they own (client_id match enforced in repo).
 * Cancellation reopens the slot (markSlotAvailable).
 * Sessions are NOT deducted on cancellation.
 */
router.patch('/clients/me/bookings/:bookingId/cancel', clientAuthMiddleware, async (req: Request, res: Response) => {
    const { clientId } = req.clientAuth!;
    const { bookingId } = req.params as { bookingId: string };
    log('PATCH /clients/me/bookings/cancel', `Client ${clientId} cancelling booking ${bookingId}`);

    try {
        const db = await getDb();

        // Verify booking belongs to this client before cancelling
        const existing = await db.collection('bookings').findOne({ _id: new ObjectId(bookingId) as any });
        if (!existing || existing.client_id !== clientId) {
            res.status(404).json({ success: false, error: 'Booking not found.' });
            return;
        }
        if (existing.status !== 'booked') {
            res.status(400).json({ success: false, error: `Cannot cancel a booking with status '${existing.status}'.` });
            return;
        }

        const cancelled = await cancelBookingByClient(bookingId, clientId);
        if (!cancelled) {
            res.status(500).json({ success: false, error: 'Failed to cancel booking.' });
            return;
        }

        // Reopen the slot
        const { markSlotAvailable } = await import('../repositories/mongoAvailabilityRepo');
        await markSlotAvailable(existing.availability_slot_id);

        log('PATCH /clients/me/bookings/cancel', `✅ Booking ${bookingId} cancelled, slot reopened`);
        res.json({ success: true, booking: cancelled });
    } catch (error: any) {
        logError('PATCH /clients/me/bookings/cancel', error);
        res.status(500).json({ success: false, error: 'Failed to cancel booking.' });
    }
});

/**
 * GET /api/clients/me/profile
 * Returns the authenticated client's current body profile fields.
 *
 * Protected: client JWT required.
 *
 * Response shape:
 *   { success, profile: { height_cm, weight_kg, fitness_goal, injuries_notes, training_experience,
 *                         neck_cm, chest_cm, waist_cm, hips_cm } }
 *
 * All profile fields are optional — they will be null/undefined if never set.
 */
router.get('/clients/me/profile', clientAuthMiddleware, async (req: Request, res: Response) => {
    const { clientId } = req.clientAuth!;
    log('GET /clients/me/profile', `Client ${clientId} fetching body profile`);

    try {
        const client = await findClientById(clientId);
        if (!client) {
            res.status(404).json({ success: false, error: 'Client not found.' });
            return;
        }

        res.json({
            success: true,
            profile: {
                height_cm:           client.height_cm           ?? null,
                weight_kg:           client.weight_kg           ?? null,
                fitness_goal:        client.fitness_goal        ?? null,
                injuries_notes:      client.injuries_notes      ?? null,
                training_experience: client.training_experience ?? null,
                neck_cm:             client.neck_cm             ?? null,
                chest_cm:            client.chest_cm            ?? null,
                waist_cm:            client.waist_cm            ?? null,
                hips_cm:             client.hips_cm             ?? null,
            },
        });
    } catch (error: any) {
        logError('GET /clients/me/profile', error);
        res.status(500).json({ success: false, error: 'Failed to load profile.' });
    }
});

/**
 * PATCH /api/clients/me/profile
 * Update the authenticated client's name and/or body profile fields.
 *
 * Protected: client JWT required.
 *
 * Body (all optional — only provided fields are written):
 *   name?:                string   — display name (cannot update email via this route)
 *   height_cm?:           number
 *   weight_kg?:           number
 *   fitness_goal?:        string
 *   injuries_notes?:      string
 *   training_experience?: string
 *   neck_cm?:             number   — neck circumference in cm
 *   chest_cm?:            number   — chest/bust circumference in cm
 *   waist_cm?:            number   — waist circumference in cm
 *   hips_cm?:             number   — hips circumference in cm
 *
 * Safety:
 *  - email is NOT accepted — it is an auth identity field, not updatable here.
 *  - Auth, plan, coach linkage fields are never touched by this route.
 *  - Empty strings are accepted for body profile fields (to allow clearing).
 *  - name must be non-empty if provided.
 *  - Numbers are validated: must be positive and within reasonable bounds.
 */
router.patch('/clients/me/profile', clientAuthMiddleware, async (req: Request, res: Response) => {
    const { clientId } = req.clientAuth!;
    log('PATCH /clients/me/profile', `Client ${clientId} updating body profile`);

    const {
        name,
        height_cm,
        weight_kg,
        fitness_goal,
        injuries_notes,
        training_experience,
        neck_cm,
        chest_cm,
        waist_cm,
        hips_cm,
    } = req.body as {
        name?:                string;
        height_cm?:           number;
        weight_kg?:           number;
        fitness_goal?:        string;
        injuries_notes?:      string;
        training_experience?: string;
        neck_cm?:             number;
        chest_cm?:            number;
        waist_cm?:            number;
        hips_cm?:             number;
    };

    // ── Guard: email is an auth identity field — never updatable here ─────────
    if ((req.body as any).email !== undefined) {
        res.status(400).json({ success: false, error: 'Email cannot be changed via this endpoint.' });
        return;
    }

    // ── Input validation ───────────────────────────────────────────────────────
    if (name !== undefined) {
        if (typeof name !== 'string' || name.trim().length === 0) {
            res.status(400).json({ success: false, error: 'name must be a non-empty string.' });
            return;
        }
        if (name.trim().length > 100) {
            res.status(400).json({ success: false, error: 'name is too long (max 100 characters).' });
            return;
        }
    }
    if (height_cm !== undefined) {
        const n = Number(height_cm);
        if (isNaN(n) || n <= 0 || n > 300) {
            res.status(400).json({ success: false, error: 'height_cm must be a positive number ≤ 300.' });
            return;
        }
    }
    if (weight_kg !== undefined) {
        const n = Number(weight_kg);
        if (isNaN(n) || n <= 0 || n > 500) {
            res.status(400).json({ success: false, error: 'weight_kg must be a positive number ≤ 500.' });
            return;
        }
    }
    if (training_experience !== undefined) {
        const allowed = ['beginner', 'intermediate', 'advanced'];
        if (typeof training_experience !== 'string') {
            res.status(400).json({ success: false, error: 'training_experience must be a string.' });
            return;
        }
        // Accept canonical values OR any custom free-form string (max 80 chars)
        if (training_experience.length > 80) {
            res.status(400).json({ success: false, error: 'training_experience is too long (max 80 chars).' });
            return;
        }
    }

    // ── Measurement field validation ────────────────────────────────────────
    for (const [field, val] of [
        ['neck_cm',  neck_cm],
        ['chest_cm', chest_cm],
        ['waist_cm', waist_cm],
        ['hips_cm',  hips_cm],
    ] as const) {
        if (val !== undefined) {
            const n = Number(val);
            if (isNaN(n) || !isFinite(n) || n <= 0 || n > 300) {
                res.status(400).json({ success: false, error: `${field} must be a positive number ≤ 300.` });
                return;
            }
        }
    }

    try {
        const found = await updateClientBodyProfile(clientId, {
            name:                name,
            height_cm:           height_cm           !== undefined ? Number(height_cm) : undefined,
            weight_kg:           weight_kg           !== undefined ? Number(weight_kg) : undefined,
            fitness_goal:        fitness_goal,
            injuries_notes:      injuries_notes,
            training_experience: training_experience,
            neck_cm:             neck_cm              !== undefined ? Number(neck_cm)  : undefined,
            chest_cm:            chest_cm             !== undefined ? Number(chest_cm) : undefined,
            waist_cm:            waist_cm             !== undefined ? Number(waist_cm) : undefined,
            hips_cm:             hips_cm              !== undefined ? Number(hips_cm)  : undefined,
        });

        if (!found) {
            res.status(404).json({ success: false, error: 'Client not found.' });
            return;
        }

        log('PATCH /clients/me/profile', `✅ Profile updated for client ${clientId}`);
        // Return the saved name so the mobile app can update AuthContext without
        // a separate GET call (avoids a round-trip and keeps the avatar initials fresh).
        res.json({
            success: true,
            message: 'Profile saved.',
            ...(name !== undefined ? { name: name.trim() } : {}),
        });
    } catch (error: any) {
        logError('PATCH /clients/me/profile', error);
        res.status(500).json({ success: false, error: 'Failed to save profile.' });
    }
});

/**
 * PATCH /api/clients/me/checkin-prefs
 * Update the authenticated client's check-in reminder preference and/or pause state.
 *
 * Protected: client JWT required.
 *
 * Body (all optional):
 *   check_in_reminders_enabled?: boolean   — true = opted in, false = "not now"
 *   check_in_status?: 'active' | 'paused'  — explicit resume/pause from client UI
 *
 * Safety:
 *   - Only the two preference fields are accepted. Profile/body/auth fields ignored.
 *   - When resuming (check_in_status: 'active'), clears check_in_paused_at.
 */
router.patch('/clients/me/checkin-prefs', clientAuthMiddleware, async (req: Request, res: Response) => {
    const { clientId } = req.clientAuth!;
    log('PATCH /clients/me/checkin-prefs', `Client ${clientId} updating check-in prefs`);

    const { check_in_reminders_enabled, check_in_status } = req.body as {
        check_in_reminders_enabled?: boolean;
        check_in_status?: 'active' | 'paused';
    };

    // Validate check_in_status if provided
    if (check_in_status !== undefined && !['active', 'paused'].includes(check_in_status)) {
        res.status(400).json({ success: false, error: "check_in_status must be 'active' or 'paused'." });
        return;
    }
    if (check_in_reminders_enabled !== undefined && typeof check_in_reminders_enabled !== 'boolean') {
        res.status(400).json({ success: false, error: 'check_in_reminders_enabled must be a boolean.' });
        return;
    }

    try {
        const found = await updateClientBodyProfile(clientId, {
            ...(check_in_reminders_enabled !== undefined ? { check_in_reminders_enabled } : {}),
            ...(check_in_status !== undefined ? { check_in_status } : {}),
            // When resuming, clear the paused_at timestamp
            ...(check_in_status === 'active' ? { check_in_paused_at: null } : {}),
        });

        if (!found) {
            res.status(404).json({ success: false, error: 'Client not found.' });
            return;
        }

        log('PATCH /clients/me/checkin-prefs', `✅ Prefs updated for client ${clientId}`);
        res.json({ success: true, message: 'Check-in preferences saved.' });
    } catch (error: any) {
        logError('PATCH /clients/me/checkin-prefs', error);
        res.status(500).json({ success: false, error: 'Failed to save preferences.' });
    }
});

/**
 * POST /api/payments/client-create
 * Client initiates payment for their selected plan.
 *
 * Requires: client JWT + existing plan_status: 'selected'
 *
 * Flow:
 *  1. Validate client has a selected plan
 *  2. createClientPaymentIntent() — creates record + calls provider
 *  3. Returns: { payment_id, intent_id, amount_sgd, [clientSecret], [redirectUrl] }
 */
router.post('/payments/client-create', clientAuthMiddleware, async (req: Request, res: Response) => {
    const { clientId } = req.clientAuth!;
    log('POST /payments/client-create', `Client ${clientId} initiating payment`);

    try {
        const db = await getDb();
        const clientDoc = await db.collection('clients').findOne({ id: clientId });

        if (!clientDoc) {
            res.status(404).json({ success: false, error: 'Client not found' });
            return;
        }
        if (!clientDoc.selected_plan_id) {
            res.status(400).json({ success: false, error: 'Please select a plan before paying.' });
            return;
        }
        if (!clientDoc.coach_id) {
            // A payment must be attributable to a coach — never create an orphaned payment.
            res.status(400).json({
                success:   false,
                has_coach: false,
                error:     'Please connect to your coach with an invitation code before purchasing a plan.',
            });
            return;
        }

        const result = await createClientPaymentIntent({
            client_id: clientId,
            coach_id: clientDoc.coach_id,
            plan_id: clientDoc.selected_plan_id,
        });

        log('POST /payments/client-create', `✅ Payment intent created: ${result.intent_id}`);

        res.status(201).json({ success: true, ...result });
    } catch (error: any) {
        if (error.statusCode) {
            res.status(error.statusCode).json({ success: false, error: error.message });
        } else {
            logError('POST /payments/client-create', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
});

/**
 * POST /api/payments/client-confirm
 * Client confirms payment completion — verifies with provider + activates plan.
 *
 * Body: { payment_id, intent_id }
 *
 * State transition: plan_status: 'payment_pending' → 'active' (on success)
 */
router.post('/payments/client-confirm', clientAuthMiddleware, async (req: Request, res: Response) => {
    const { clientId } = req.clientAuth!;
    const { payment_id, intent_id } = req.body as { payment_id?: string; intent_id?: string };

    if (!payment_id || !intent_id) {
        res.status(400).json({ success: false, error: 'payment_id and intent_id are required' });
        return;
    }

    log('POST /payments/client-confirm', `Client ${clientId} confirming payment ${payment_id}`);

    try {
        const db = await getDb();
        const clientDoc = await db.collection('clients').findOne({ id: clientId });

        if (!clientDoc) {
            res.status(404).json({ success: false, error: 'Client not found' });
            return;
        }

        const result = await confirmClientPayment({
            payment_id,
            intent_id,
            client_id: clientId,
            coach_id: clientDoc.coach_id,
        });

        if (!result.success) {
            log('POST /payments/client-confirm', `⚠️ Payment verification failed: ${result.error}`);
            res.status(402).json({ success: false, error: result.error });
            return;
        }

        log('POST /payments/client-confirm', `✅ Plan activated for client ${clientId}`);
        res.json(result);
    } catch (error: any) {
        if (error.statusCode) {
            res.status(error.statusCode).json({ success: false, error: error.message });
        } else {
            logError('POST /payments/client-confirm', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
});

// ─── Per-client ownership middleware helper ────────────────────────────────────

async function requireClientOwnership(
    req: AuthenticatedRequest,
    res: Response,
    clientId: string,
    route: string
): Promise<boolean> {
    const coachId = req.coach!.sub;
    const client = await validateClientOwnership(clientId, coachId);
    if (!client) {
        logOwnershipViolation(route, coachId, clientId);
        res.status(403).json({ success: false, error: 'Access denied. This client does not belong to your account.' });
        return false;
    }
    return true;
}

// ─── Coach — Client Body Profile (read-only) ─────────────────────────────────

/**
 * GET /api/clients/:clientId/profile
 * Returns the body profile fields for a client, accessible by the owning coach.
 *
 * This is the coach-facing equivalent of GET /api/clients/me/profile (client-only).
 * Read-only — no write operation, no schema change.
 *
 * Returns:
 *   { success, profile: { height_cm, weight_kg, fitness_goal, injuries_notes, training_experience,
 *                         neck_cm, chest_cm, waist_cm, hips_cm } }
 *
 * Any unset field is returned as null.
 */
router.get('/clients/:clientId/profile', requireRole('coach'), async (req: AuthenticatedRequest, res: Response) => {
    const clientId = req.params['clientId'] as string;

    const owned = await requireClientOwnership(req, res, clientId, 'GET /clients/:clientId/profile');
    if (!owned) return;

    try {
        const db     = await getDb();
        const client = await db.collection('clients').findOne({ id: clientId });

        if (!client) {
            res.status(404).json({ success: false, error: 'Client not found' });
            return;
        }

        res.json({
            success: true,
            profile: {
                height_cm:           client['height_cm']           ?? null,
                weight_kg:           client['weight_kg']           ?? null,
                fitness_goal:        client['fitness_goal']        ?? null,
                injuries_notes:      client['injuries_notes']      ?? null,
                training_experience: client['training_experience'] ?? null,
                neck_cm:             client['neck_cm']             ?? null,
                chest_cm:            client['chest_cm']            ?? null,
                waist_cm:            client['waist_cm']            ?? null,
                hips_cm:             client['hips_cm']             ?? null,
            },
        });
    } catch (error: any) {
        logError('GET /clients/:clientId/profile', error);
        res.status(500).json({ success: false, error: 'Failed to load client profile.' });
    }
});

// ─── Session Plan Routes ──────────────────────────────────────────────────────

/**
 * POST /api/clients/:clientId/plan
 * Assign a session plan to a client.
 * Body: { plan_name, sessions_total, start_date, expiry_date }
 */
router.post('/clients/:clientId/plan', requireRole('coach'), async (req: AuthenticatedRequest, res: Response) => {
    const clientId = req.params['clientId'] as string;
    const coachId = req.coach!.sub;

    const owned = await requireClientOwnership(req, res, clientId, 'POST /clients/plan');
    if (!owned) return;

    const { plan_name, sessions_total, start_date, expiry_date } = req.body;

    if (!plan_name || !sessions_total || !start_date || !expiry_date) {
        return res.status(400).json({
            success: false,
            error: 'Required fields: plan_name, sessions_total, start_date, expiry_date',
        });
    }
    if (typeof sessions_total !== 'number' || sessions_total < 1) {
        return res.status(400).json({ success: false, error: 'sessions_total must be a positive number' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(expiry_date)) {
        return res.status(400).json({ success: false, error: 'start_date and expiry_date must be YYYY-MM-DD' });
    }
    if (expiry_date <= start_date) {
        return res.status(400).json({ success: false, error: 'expiry_date must be after start_date' });
    }

    try {
        const plan = await assignPlanToClient(clientId, coachId, { plan_name, sessions_total, start_date, expiry_date });
        const plan_status = computePlanStatus(plan);
        log('POST /clients/plan', `✅ Plan '${plan_name}' assigned to client ${clientId}`);
        res.status(201).json({ success: true, plan: { ...plan, plan_status, sessions_remaining: plan.sessions_total - plan.sessions_used } });
    } catch (error: any) {
        logError('POST /clients/plan', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/clients/:clientId/plan
 * Get the current active plan + session status for a client.
 */
router.get('/clients/:clientId/plan', async (req: AuthenticatedRequest, res: Response) => {
    const clientId = req.params['clientId'] as string;
    const coachId = req.coach!.sub;

    const owned = await requireClientOwnership(req, res, clientId, 'GET /clients/plan');
    if (!owned) return;

    try {
        const plan = await getActivePlanForClient(clientId);
        if (!plan) return res.json({ success: true, has_plan: false });

        const plan_status = computePlanStatus(plan);
        const sessions_remaining = plan.sessions_total - plan.sessions_used;
        res.json({ success: true, has_plan: true, plan: { ...plan, plan_status, sessions_remaining } });
    } catch (error: any) {
        logError('GET /clients/plan', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
/**
 * GET /api/clients/:clientId/session-status
 * Lightweight session status for mobile session badge.
 * Accessible by coach (ownership check) OR by the client themselves.
 */
router.get('/clients/:clientId/session-status', async (req: AuthenticatedRequest, res: Response) => {
    const clientId = req.params['clientId'] as string;
    const requesterId = req.coach!.sub;          // UUID on new client tokens; Mongo _id on older ones
    const jwtClientId = req.coach!.clientId;     // UUID claim on pre-fix self-registration tokens
    const requesterRole = req.coach!.role;

    try {
        if (requesterRole === 'client') {
            // Own record only. Match either identifier the token may carry so
            // older sessions (sub = Mongo _id, clientId claim = UUID) still work,
            // and a client can never read another client's plan by guessing an id.
            const isOwner = requesterId === clientId || jwtClientId === clientId;
            if (!isOwner) {
                res.status(403).json({ success: false, error: 'Access denied.' });
                return;
            }
            // Skip ownership query — fetch plan directly by clientId
            const plan = await (await import('../repositories/mongoClientPlanRepo')).getActivePlanForClient(clientId);
            if (!plan) {
                res.json({ success: true, has_plan: false });
                return;
            }
            const { computePlanStatus } = await import('../repositories/mongoClientPlanRepo');
            const plan_status = computePlanStatus(plan);
            const sessions_remaining = plan.sessions_total - plan.sessions_used;
            res.json({
                success: true,
                has_plan: true,
                plan_name: plan.plan_name,
                plan_status,
                sessions_total: plan.sessions_total,
                sessions_used: plan.sessions_used,
                sessions_remaining,
                expiry_date: plan.expiry_date,
            });
        } else {
            // Coach flow — validates ownership
            const status = await getSessionStatus(clientId, requesterId);
            res.json({ success: true, ...status });
        }
    } catch (error: any) {
        handleServiceError(res, 'GET /session-status', error);
    }
});


/**
 * POST /api/clients/:clientId/complete-session
 * Deduct 1 session from a client's active plan.
 * Used when a session is completed outside of the booking system.
 */
router.post('/clients/:clientId/complete-session', requireRole('coach'), async (req: AuthenticatedRequest, res: Response) => {
    const clientId = req.params['clientId'] as string;
    const coachId = req.coach!.sub;
    try {
        const result = await completeSession(clientId, coachId);
        log('POST /complete-session', `✅ Session completed for ${clientId} — ${result.sessions_remaining} remaining`);
        res.json({ success: true, ...result });
    } catch (error: any) {
        handleServiceError(res, 'POST /complete-session', error);
    }
});

// ─── Check-In Routes ──────────────────────────────────────────────────────────

/**
 * POST /api/clients/:clientId/checkins
 * Submit a check-in + auto-detect red flags.
 */
router.post('/clients/:clientId/checkins', async (req: AuthenticatedRequest, res: Response) => {
    const clientId = req.params['clientId'] as string;
    const requesterId = req.coach!.sub;       // MongoDB _id
    const jwtClientId = req.coach!.clientId;  // UUID — only set for client tokens
    const requesterRole = req.coach!.role;

    log('POST /checkins', `Check-in for client: ${clientId} | requester: ${requesterId} (${requesterRole})`);

    // ── Authorisation: coach OR self-submitting client ────────────────────
    if (requesterRole === 'client') {
        // Accept match against either the MongoDB _id (sub) or the UUID (clientId claim)
        const isOwner = requesterId === clientId || jwtClientId === clientId;
        if (!isOwner) {
            log('POST /checkins', `⛔ Client ${requesterId} (jwt clientId: ${jwtClientId}) denied for ${clientId}`);
            res.status(403).json({ success: false, error: 'Clients may only submit their own check-in.' });
            return;
        }
        // No ownership query needed — identity check above is sufficient
    } else {
        // Coach flow: verify this client belongs to the coach
        const owned = await requireClientOwnership(req, res, clientId, 'POST /checkins');
        if (!owned) return;
    }

    try {
        const { date, type, metrics, notes, workoutDone, stepsToday, nutrition } = req.body;

        if (!date) return res.status(400).json({ success: false, error: 'Missing required field: date' });

        if (!canEditCheckIn(date)) {
            return res.status(403).json({
                success: false,
                error: "Check-ins can only be submitted or edited for today's date (Singapore time).",
            });
        }

        const validTypes = ['MANUAL', 'AUTO_BOT', 'RED_FLAG_RESPONSE'];
        if (type && !validTypes.includes(type)) {
            return res.status(400).json({ success: false, error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
        }

        if (metrics) {
            if (metrics.energy === undefined || metrics.hunger === undefined) {
                return res.status(400).json({ success: false, error: 'metrics.energy and metrics.hunger are required' });
            }
            if (metrics.energy < 1 || metrics.energy > 10 || metrics.hunger < 1 || metrics.hunger > 10) {
                return res.status(400).json({ success: false, error: 'Energy and hunger must be between 1 and 10' });
            }
        }

        if (metrics?.stepsToday !== undefined) {
            if (typeof metrics.stepsToday !== 'number' || isNaN(metrics.stepsToday) || metrics.stepsToday < 0) {
                return res.status(400).json({ success: false, error: 'Steps must be a valid positive number' });
            }
        }

        // ── Nutrition validation (Phase 1 — manual input) ─────────────────────
        // Phase 2 (screenshot/OCR) and Phase 3 (HealthKit) will use the same
        // field — only nutrition.source will differ.
        let validatedNutrition: import('../types').NutritionData | undefined;
        if (nutrition) {
            const validSources = ['manual', 'screenshot', 'healthkit'];
            if (!validSources.includes(nutrition.source)) {
                return res.status(400).json({
                    success: false,
                    error: `nutrition.source must be one of: ${validSources.join(', ')}`,
                });
            }
            const macroFields = ['calories', 'protein', 'carbs', 'fat'] as const;
            for (const field of macroFields) {
                const val = nutrition[field];
                if (val !== undefined && (typeof val !== 'number' || isNaN(val) || val < 0)) {
                    return res.status(400).json({
                        success: false,
                        error: `nutrition.${field} must be a non-negative number`,
                    });
                }
            }
            validatedNutrition = {
                source: nutrition.source,
                calories: nutrition.calories,
                protein: nutrition.protein,
                carbs: nutrition.carbs,
                fat: nutrition.fat,
            };
            log('POST /checkins', `📊 Nutrition logged (source: ${nutrition.source}) for ${clientId}`);
        }

        // AUD-008: the phone sends `photos`. Save those private links on the check-in.
        const photoUrls = await photoUrlsForCheckIn(clientId, req.body?.photos);

        const { checkin, isUpdate } = await upsertCheckIn(clientId, date, {
            type: type || 'MANUAL',
            metrics: metrics || undefined,
            nutrition: validatedNutrition,
            notes: notes || '',
            workout_completed: workoutDone,
            steps: stepsToday,
            flaggedForReview: false,
            photos: photoUrls,
        });

        log('POST /checkins', `✅ Check-in ${isUpdate ? 'updated' : 'created'} for ${clientId}`);

        // Auto-resume: if the client was paused, submitting a check-in resets them to active.
        // Fire-and-forget — a failure here must NOT break the check-in response.
        updateClientBodyProfile(clientId, { check_in_status: 'active', check_in_paused_at: null })
            .catch(err => log('POST /checkins', `⚠ check_in_status reset failed (non-fatal): ${err?.message}`));

        const detectionResult = await detectRedFlagsForClient(clientId);
        if (detectionResult.flagsDetected > 0) {
            log('POST /checkins', `🚩 ${detectionResult.flagsDetected} red flag(s) detected for ${clientId}`);
        }

        let updatedCheckin = checkin;
        if (detectionResult.flagsDetected > 0 && checkin?._id) {
            const db = await getDb();
            await db.collection('checkins').updateOne(
                { _id: new ObjectId(checkin._id) },
                { $set: { flaggedForReview: true } }
            );
            updatedCheckin = { ...checkin, flaggedForReview: true };
        }

        res.json({
            success: true,
            checkin: updatedCheckin,
            detectedFlags: detectionResult.flags,
            message: `Check-in saved${detectionResult.flagsDetected > 0 ? ', flagged for review' : ''}`,
        });
    } catch (error: any) {
        if (error instanceof PhotoInputError || error.statusCode === 400) {
            return res.status(400).json({ success: false, error: error.message });
        }
        if (error.code === 11000) {
            return res.status(409).json({ success: false, error: 'A check-in for this client and date already exists.' });
        }
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/clients/:clientId/checkins?limit=N
 *
 * Accessible by:
 *  - Coach: ownership check enforced (client must belong to this coach)
 *  - Client: identity check only (can only fetch their own check-ins)
 *
 * WHY the dual identity check for clients?
 *   The URL :clientId may be either:
 *     A. MongoDB _id  — used by ClientHomeScreen when user.clientId is not set (stale session)
 *     B. UUID (clients.id) — used when user.clientId is populated from a fresh login
 *   The JWT contains BOTH as sub (MongoDB _id) and clientId (UUID).
 *   A client must match either to be authorised.
 */
router.get('/clients/:clientId/checkins', async (req: AuthenticatedRequest, res: Response) => {
    const clientId = req.params['clientId'] as string;
    const requesterId = req.coach!.sub;               // MongoDB _id
    const jwtClientId = req.coach!.clientId;          // UUID — only set for client tokens
    const requesterRole = req.coach!.role;
    const limit = parseInt(req.query['limit'] as string, 10) || 30;

    if (requesterRole === 'client') {
        // Accept match against either the MongoDB _id (sub) or the UUID (clientId claim)
        const isOwner = requesterId === clientId || jwtClientId === clientId;
        if (!isOwner) {
            log('GET /checkins', `⛔ Client ${requesterId} (jwt clientId: ${jwtClientId}) denied for ${clientId}`);
            res.status(403).json({ success: false, error: 'Clients may only view their own check-ins.' });
            return;
        }
        // Skip ownership query — identity check above is sufficient
    } else {
        // Coach flow — verify this client belongs to the requesting coach
        const owned = await requireClientOwnership(req, res, clientId, 'GET /checkins');
        if (!owned) return;
    }

    log('GET /checkins', `Fetching check-ins for ${clientId} (limit: ${limit})`);

    try {
        const checkins = await getCheckInsByClient(clientId, limit);
        res.json({ success: true, checkins, count: checkins.length });
    } catch (error: any) {
        logError('GET /checkins', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/clients/:clientId/redflags?limit=20
 */
router.get('/clients/:clientId/redflags', requireRole('coach'), async (req: AuthenticatedRequest, res: Response) => {
    const clientId = req.params['clientId'] as string;
    const limit = parseInt(req.query['limit'] as string, 10) || 20;
    log('GET /redflags', `Fetching red flags for ${clientId} (limit: ${limit})`);

    const owned = await requireClientOwnership(req, res, clientId, 'GET /redflags');
    if (!owned) return;

    try {
        const redFlags = await getRedFlagsByClient(clientId, limit);
        res.json({ success: true, redFlags, count: redFlags.length });
    } catch (error: any) {
        logError('GET /redflags', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/clients/:clientId/redflags/detect
 */
router.post('/clients/:clientId/redflags/detect', requireRole('coach'), async (req: AuthenticatedRequest, res: Response) => {
    const clientId = req.params['clientId'] as string;
    log('POST /redflags/detect', `Manual red flag detection for ${clientId}`);

    const owned = await requireClientOwnership(req, res, clientId, 'POST /redflags/detect');
    if (!owned) return;

    try {
        const result = await detectRedFlagsForClient(clientId);
        res.json({ success: true, flagsDetected: result.flagsDetected, flags: result.flags });
    } catch (error: any) {
        logError('POST /redflags/detect', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// COACH ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/coach/dashboard
 * Coach summary: total clients, low-session alerts, today's bookings.
 */
router.get('/coach/dashboard', async (req: AuthenticatedRequest, res: Response) => {
    const coachId = req.coach!.sub;
    const date = req.query['date'] as string | undefined;
    log('GET /coach/dashboard', `Dashboard requested by coach ${coachId}${date ? ` for date ${date}` : ''}`);
    try {
        const summary = await getDashboardSummary(coachId, date);
        res.json({ success: true, ...summary });
    } catch (error: any) {
        logError('GET /coach/dashboard', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/coach/revenue-summary?month=YYYY-MM
 *
 * Returns a lightweight business summary for the authenticated coach:
 *   - actualRevenue:     sum of confirmed payments this month
 *   - projectedRevenue: renewal value of active plans expiring within 30 days
 *   - activePlans:      count of active client plans
 *   - expiringSoon:     plans expiring within 30 days (for follow-up list)
 *   - planBreakdown:    revenue grouped by plan name
 *   - expiringClients:  per-client detail for follow-up
 *
 * Protected: coach JWT required.
 * Read-only: no side effects.
 */
router.get('/coach/revenue-summary', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    const coachId = req.coach!.sub;

    // Default month to current SGT month
    const rawMonth = req.query['month'] as string | undefined;
    const month = rawMonth ?? new Date().toLocaleDateString('en-CA', {
        timeZone: 'Asia/Singapore',
    }).slice(0, 7);   // "YYYY-MM"

    if (rawMonth && !/^\d{4}-\d{2}$/.test(rawMonth)) {
        res.status(400).json({ success: false, error: 'month must be YYYY-MM' });
        return;
    }

    log('GET /coach/revenue-summary', `Coach ${coachId} month=${month}`);

    try {
        const db = await getDb();

        // ── 1. Actual revenue this month ──────────────────────────────────────
        const actualRevenue = await getMonthlyRevenueForCoach(coachId, month);

        // ── 2. Active plans + expiring-soon logic ─────────────────────────────
        const activePlans = await getActivePlansForCoach(coachId);

        const todaySGT = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
        const today    = new Date(`${todaySGT}T00:00:00+08:00`);
        const in30Days = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
        const in30Str  = in30Days.toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });

        const expiringPlans = activePlans.filter(p => p.expiry_date <= in30Str);

        // ── 3. Resolve client names for expiring plans ─────────────────────────
        const expiringClientIds = Array.from(new Set(expiringPlans.map(p => p.client_id)));
        const clientDocs = expiringClientIds.length > 0
            ? await db.collection('clients').find({ id: { $in: expiringClientIds } }).toArray()
            : [];
        const clientNameMap: Record<string, string> = {};
        for (const c of clientDocs) {
            clientNameMap[c.id] = c.name ?? c.email ?? 'Client';
        }

        // ── 4. Map plan_name → current official price from SESSION_PLANS ─────────
        //    This is the correct business rule: projected revenue = what the coach
        //    would charge at today's pricing, not what they charged historically.
        //    We normalise informal plan names (e.g. legacy seed data: 'Starter',
        //    'Progress', 'Elite') to match the catalogue name so the lookup is robust.
        const normalisePlanName = (raw: string): string => {
            const lower = raw.toLowerCase();
            if (lower.includes('starter'))                                  return 'Starter Pack';
            if (lower.includes('performance') || lower.includes('progress')) return 'Performance Pack';
            if (lower.includes('elite'))                                     return 'Elite Pack';
            return raw; // pass through unknown names unchanged
        };

        const officialPrice = (planName: string): number => {
            const normalised = normalisePlanName(planName);
            const found = SESSION_PLANS.find(p => p.name === normalised);
            return found?.price_sgd ?? 0;
        };

        // ── 5. Build expiringClients response list ────────────────────────────
        const expiringClients = expiringPlans.map(p => {
            const expiryDate = new Date(`${p.expiry_date}T00:00:00+08:00`);
            const expiresInDays = Math.round(
                (expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
            );
            const renewalValue = officialPrice(p.plan_name);
            return {
                clientId:     p.client_id,
                clientName:   clientNameMap[p.client_id] ?? 'Client',
                planName:     normalisePlanName(p.plan_name),  // normalise display name too
                expiresInDays,
                renewalValue,
            };
        }).sort((a, b) => a.expiresInDays - b.expiresInDays);

        // ── 6. Projected revenue = sum of current official plan prices ─────────
        const projectedRevenue = expiringClients.reduce((acc, c) => acc + c.renewalValue, 0);

        // ── 7. Plan breakdown: group active plans by normalised plan_name ───────
        const breakdownMap: Record<string, { count: number; revenue: number }> = {};
        for (const p of activePlans) {
            const displayName = normalisePlanName(p.plan_name);
            if (!breakdownMap[displayName]) breakdownMap[displayName] = { count: 0, revenue: 0 };
            breakdownMap[displayName].count += 1;
            breakdownMap[displayName].revenue += officialPrice(p.plan_name);
        }
        const planBreakdown = Object.entries(breakdownMap).map(([planName, stats]) => ({
            planName,
            count:   stats.count,
            revenue: stats.revenue,
        }));

        log('GET /coach/revenue-summary', `✅ actual=$${actualRevenue} projected=$${projectedRevenue} active=${activePlans.length} expiring=${expiringClients.length}`);

        res.json({
            success:          true,
            month,
            currency:         'SGD',
            actualRevenue,
            projectedRevenue,
            activePlans:      activePlans.length,
            expiringSoon:     expiringClients.length,
            planBreakdown,
            expiringClients,
        });
    } catch (error: any) {
        logError('GET /coach/revenue-summary', error);
        res.status(500).json({ success: false, error: error.message });
    }
});


/**
 * GET /api/coach/availability?from=YYYY-MM-DD
 * Returns coach's availability slots from a given date (default: today).
 */
router.get('/coach/availability', async (req: AuthenticatedRequest, res: Response) => {
    const coachId = req.coach!.sub;
    const fromDate = req.query['from'] as string | undefined;
    log('GET /coach/availability', `Fetching slots for coach ${coachId}`);
    try {
        const slots = await getAvailabilityByCoach(coachId, fromDate);
        res.json({ success: true, slots, count: slots.length });
    } catch (error: any) {
        logError('GET /coach/availability', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/coach/availability/block
 * Coach blocks a time window — creates a new slot with status: 'blocked'.
 * Blocked slots are hidden from clients.
 *
 * Body: { date, start_time, end_time, reason? }
 * Returns: { success, slot }
 */
router.post('/coach/availability/block', async (req: AuthenticatedRequest, res: Response) => {
    const coachId = req.coach!.sub;
    const { date, start_time, end_time, reason } = req.body;

    if (!date || !start_time || !end_time) {
        res.status(400).json({ success: false, error: 'Required fields: date, start_time, end_time' });
        return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD' });
        return;
    }
    if (!/^\d{2}:\d{2}$/.test(start_time) || !/^\d{2}:\d{2}$/.test(end_time)) {
        res.status(400).json({ success: false, error: 'start_time and end_time must be HH:MM' });
        return;
    }
    if (end_time <= start_time) {
        res.status(400).json({ success: false, error: 'end_time must be after start_time' });
        return;
    }

    log('POST /coach/availability/block', `Coach ${coachId} blocking ${date} ${start_time}–${end_time}`);
    try {
        const slot = await blockSlot(coachId, { date, start_time, end_time, reason });
        log('POST /coach/availability/block', `✅ Blocked slot created: ${slot._id}`);
        res.status(201).json({ success: true, slot });
    } catch (error: any) {
        logError('POST /coach/availability/block', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PATCH /api/coach/availability/:slotId/unblock
 * Coach removes a block — resets slot status to 'available'.
 * Returns 404 if slot not found, not blocked, or does not belong to this coach.
 */
router.patch('/coach/availability/:slotId/unblock', async (req: AuthenticatedRequest, res: Response) => {
    const coachId = req.coach!.sub;
    const slotId  = req.params['slotId'] as string;

    log('PATCH /coach/availability/unblock', `Coach ${coachId} unblocking slot ${slotId}`);
    try {
        const slot = await unblockSlot(slotId, coachId);
        if (!slot) {
            res.status(404).json({ success: false, error: 'Slot not found, not blocked, or does not belong to this coach.' });
            return;
        }
        log('PATCH /coach/availability/unblock', `✅ Slot ${slotId} unblocked`);
        res.json({ success: true, slot });
    } catch (error: any) {
        logError('PATCH /coach/availability/unblock', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/coach/availability
 * Create a new availability slot.
 * Body: { date, start_time, end_time }
 */
router.post('/coach/availability', async (req: AuthenticatedRequest, res: Response) => {
    const coachId = req.coach!.sub;
    const { date, start_time, end_time } = req.body;

    if (!date || !start_time || !end_time) {
        return res.status(400).json({ success: false, error: 'Required fields: date, start_time, end_time' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD' });
    }
    if (!/^\d{2}:\d{2}$/.test(start_time) || !/^\d{2}:\d{2}$/.test(end_time)) {
        return res.status(400).json({ success: false, error: 'start_time and end_time must be HH:MM' });
    }
    if (end_time <= start_time) {
        return res.status(400).json({ success: false, error: 'end_time must be after start_time' });
    }

    try {
        const slot = await createAvailabilitySlot(coachId, { date, start_time, end_time });
        log('POST /coach/availability', `✅ Slot created: ${date} ${start_time}–${end_time}`);
        res.status(201).json({ success: true, slot });
    } catch (error: any) {
        logError('POST /coach/availability', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// BOOKING ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/bookings
 * Book a client into an availability slot.
 *
 * BOOKING GATE: client must have an active paid plan.
 * A coach cannot book a client who hasn't paid — prevents phantom session deductions.
 *
 * Body: { client_id, availability_slot_id, notes? }
 */
router.post('/bookings', async (req: AuthenticatedRequest, res: Response) => {
    const coachId = req.coach!.sub;
    const { client_id, availability_slot_id, notes } = req.body ?? {};

    // A non-string id (for example {"$ne":null}) must not reach a database query.
    if (typeof client_id !== 'string' || client_id.trim() === '') {
        return res.status(400).json({ success: false, error: 'client_id must be a string.' });
    }
    if (typeof availability_slot_id !== 'string' || availability_slot_id.trim() === '') {
        return res.status(400).json({ success: false, error: 'Required fields: client_id, availability_slot_id' });
    }

    // Ownership first. A client who belongs to another coach gets the same
    // denial whether or not they have a plan, so the reply does not leak that.
    const owned = await requireClientOwnership(req, res, client_id, 'POST /bookings');
    if (!owned) return;

    // ── Active plan gate ─────────────────────────────────────────────────────────
    const activePlan = await getActivePlanForClient(client_id);
    if (!activePlan) {
        log('POST /bookings', `⚠️ Booking rejected — client ${client_id} has no active plan`);
        return res.status(402).json({
            success: false,
            error: 'This client does not have an active plan. They must purchase a plan before booking.',
        });
    }

    log('POST /bookings', `Coach ${coachId} booking client ${client_id} into slot ${availability_slot_id}`);
    try {
        const booking = await bookSession({ coach_id: coachId, client_id, availability_slot_id, notes });
        log('POST /bookings', `✅ Booking created: ${booking._id}`);
        res.status(201).json({ success: true, booking });
    } catch (error: any) {
        handleServiceError(res, 'POST /bookings', error);
    }
});

/**
 * PATCH /api/bookings/:bookingId/complete
 * Mark a booking as completed — auto-deducts 1 session from the client's plan.
 */
router.patch('/bookings/:bookingId/complete', async (req: AuthenticatedRequest, res: Response) => {
    const bookingId = req.params['bookingId'] as string;
    const coachId = req.coach!.sub;
    log('PATCH /bookings/complete', `Coach ${coachId} completing booking ${bookingId}`);
    try {
        const result = await completeBookingById(bookingId, coachId);
        log('PATCH /bookings/complete', `✅ Booking ${bookingId} completed — ${result.sessions_remaining} sessions remaining`);
        res.json({ success: true, ...result });
    } catch (error: any) {
        handleServiceError(res, 'PATCH /bookings/complete', error);
    }
});

/**
 * POST /api/bookings/quick
 * Coach-friendly one-step booking.
 * Creates an availability slot + booking in one call.
 *
 * BOOKING GATE: client must have an active paid plan.
 *
 * Body: { client_id, date, start_time, end_time, notes? }
 */
router.post('/bookings/quick', async (req: AuthenticatedRequest, res: Response) => {
    const coachId = req.coach!.sub;
    const { client_id, date, start_time, end_time, notes } = req.body ?? {};

    if (typeof client_id !== 'string' || client_id.trim() === '') {
        res.status(400).json({ success: false, error: 'client_id must be a string.' });
        return;
    }
    if (!date || !start_time || !end_time) {
        res.status(400).json({ success: false, error: 'client_id, date, start_time, and end_time are required.' });
        return;
    }
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD.' });
        return;
    }

    const owned = await requireClientOwnership(req, res, client_id, 'POST /bookings/quick');
    if (!owned) return;

    // ── Active plan gate ─────────────────────────────────────────────────────────
    const activePlan = await getActivePlanForClient(client_id);
    if (!activePlan) {
        log('POST /bookings/quick', `⚠️ Booking rejected — client ${client_id} has no active plan`);
        res.status(402).json({
            success: false,
            error: 'This client does not have an active plan. They must purchase a plan before booking.',
        });
        return;
    }

    log('POST /bookings/quick', `Coach ${coachId} quick-booking for client ${client_id} on ${date} ${start_time}-${end_time}`);
    try {
        const booking = await quickBookSession({ coach_id: coachId, client_id, date, start_time, end_time, notes });
        log('POST /bookings/quick', `✅ Quick booking created: ${booking._id}`);
        res.status(201).json({ success: true, booking });
    } catch (error: any) {
        handleServiceError(res, 'POST /bookings/quick', error);
    }
});

/**
 * PATCH /api/bookings/:bookingId/cancel
 * Cancel a booking — slot is released, no session deducted.
 */
router.patch('/bookings/:bookingId/cancel', async (req: AuthenticatedRequest, res: Response) => {

    const bookingId = req.params['bookingId'] as string;
    const coachId = req.coach!.sub;
    log('PATCH /bookings/cancel', `Coach ${coachId} cancelling booking ${bookingId}`);
    try {
        const booking = await cancelBookingById(bookingId, coachId);
        log('PATCH /bookings/cancel', `✅ Booking ${bookingId} cancelled`);
        res.json({ success: true, booking });
    } catch (error: any) {
        handleServiceError(res, 'PATCH /bookings/cancel', error);
    }
});

/**
 * PATCH /api/bookings/:bookingId/reschedule
 * Drag-to-reschedule: updates start_time and end_time of a 'booked' session.
 * Body: { start_time: "HH:MM", end_time: "HH:MM" }
 */
router.patch('/bookings/:bookingId/reschedule', async (req: AuthenticatedRequest, res: Response) => {
    const bookingId = req.params['bookingId'] as string;
    const coachId = req.coach!.sub;
    const { start_time, end_time } = req.body;

    if (!start_time || !end_time) {
        res.status(400).json({ success: false, error: 'start_time and end_time are required.' });
        return;
    }
    log('PATCH /bookings/reschedule', `Coach ${coachId} rescheduling ${bookingId} to ${start_time}–${end_time}`);
    try {
        const booking = await rescheduleBookingById(bookingId, coachId, start_time, end_time);
        log('PATCH /bookings/reschedule', `✅ Booking ${bookingId} rescheduled to ${start_time}–${end_time}`);
        res.json({ success: true, booking });
    } catch (error: any) {
        handleServiceError(res, 'PATCH /bookings/reschedule', error);
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN CATALOGUE — PUBLIC
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/plans
 * Returns the 3 fixed session plan definitions.
 * Public — no auth required. Used by plan selection screens.
 */
router.get('/plans', (_req: Request, res: Response) => {
    log('GET /plans', 'Plan catalogue requested');
    res.json({ success: true, plans: SESSION_PLANS });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PAYMENT ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/payments
 * Initiates a payment for a client.
 * Creates a Payment record with status: 'pending'.
 *
 * Body: { client_id, plan_id, payment_method, reference?, notes? }
 */
router.post('/payments', requireRole('coach'), async (req: AuthenticatedRequest, res: Response) => {
    const coachId = req.coach!.sub;
    const { client_id, plan_id, payment_method, reference, notes } = req.body;

    if (!client_id || !plan_id || !payment_method) {
        res.status(400).json({ success: false, error: 'client_id, plan_id, and payment_method are required.' });
        return;
    }

    log('POST /payments', `Coach ${coachId} initiating payment for client ${client_id}, plan: ${plan_id}`);

    try {
        // Verify coach owns this client
        const owned = await validateClientOwnership(client_id, coachId);
        if (!owned) {
            res.status(403).json({ success: false, error: 'Access denied — client does not belong to this coach.' });
            return;
        }

        const result = await initiatePayment({ coach_id: coachId, client_id, plan_id, payment_method, reference, notes });
        log('POST /payments', `✅ Payment ${result.payment._id} created (pending)`);
        res.status(201).json({ success: true, ...result });
    } catch (error: any) {
        if (error.message.startsWith('Invalid plan')) {
            res.status(400).json({ success: false, error: error.message });
        } else {
            logError('POST /payments', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
});

/**
 * PATCH /api/payments/:paymentId/confirm
 * Coach marks payment as received.
 * Atomically assigns sessions to the client.
 */
router.patch('/payments/:paymentId/confirm', requireRole('coach'), async (req: AuthenticatedRequest, res: Response) => {
    const coachId = req.coach!.sub;
    const paymentId = req.params['paymentId'] as string;
    log('PATCH /payments/confirm', `Coach ${coachId} confirming payment ${paymentId}`);

    try {
        const result = await confirmPaymentAndAssignPlan(paymentId, coachId);
        log('PATCH /payments/confirm', `✅ Payment ${paymentId} confirmed — sessions granted`);
        res.json({ success: true, ...result });
    } catch (error: any) {
        if (error.message === 'PAYMENT_NOT_FOUND') { res.status(404).json({ success: false, error: 'Payment not found.' }); return; }
        if (error.message === 'PAYMENT_FORBIDDEN') { res.status(403).json({ success: false, error: 'Access denied.' }); return; }
        if (error.message === 'PAYMENT_ALREADY_CONFIRMED') { res.status(409).json({ success: false, error: 'Payment is already confirmed.' }); return; }
        logError('PATCH /payments/confirm', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/payments/count
 * Returns the number of pending payments for the authenticated coach.
 * Lightweight endpoint — used for dashboard badge, avoids fetching full payment docs.
 */
router.get('/payments/count', requireRole('coach'), async (req: AuthenticatedRequest, res: Response) => {
    const coachId = req.coach!.sub;
    try {
        const payments = await getPendingPayments(coachId);
        res.json({ success: true, pending_count: payments.length });
    } catch (error: any) {
        logError('GET /payments/count', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/payments/pending
 * Returns all pending payments for the authenticated coach.
 */
router.get('/payments/pending', requireRole('coach'), async (req: AuthenticatedRequest, res: Response) => {
    const coachId = req.coach!.sub;
    log('GET /payments/pending', `Coach ${coachId} fetching pending payments`);
    try {
        const payments = await getPendingPayments(coachId);
        res.json({ success: true, payments, count: payments.length });
    } catch (error: any) {
        logError('GET /payments/pending', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/payments/client/:clientId
 * Returns payment history for a specific client (coach-scoped).
 */
router.get('/payments/client/:clientId', requireRole('coach'), async (req: AuthenticatedRequest, res: Response) => {
    const coachId = req.coach!.sub;
    const clientId = req.params['clientId'] as string;
    log('GET /payments/client', `Coach ${coachId} fetching payments for client ${clientId}`);
    try {
        const owned = await validateClientOwnership(clientId, coachId);
        if (!owned) {
            res.status(403).json({ success: false, error: 'Access denied.' });
            return;
        }
        const payments = await getClientPaymentHistory(coachId, clientId);
        res.json({ success: true, payments, count: payments.length });
    } catch (error: any) {
        logError('GET /payments/client', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ─── Booking Rule Helpers ─────────────────────────────────────────────────────

/**
 * Returns 'YYYY-MM-DD' for tomorrow in SGT (Asia/Singapore).
 * Used to enforce the 1-day advance booking rule for clients.
 */
function getTomorrowSGT(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

// ═══════════════════════════════════════════════════════════════════════════════
// WORKOUT ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ─── CLIENT workout routes ────────────────────────────────────────────────────
// IMPORTANT: These /clients/me/* routes must be registered BEFORE any
// parameterized /clients/:clientId/* routes so Express does not match
// 'me' as a clientId param.

/**
 * GET /api/clients/me/workout/today
 * Returns today's assigned workout for the authenticated client.
 * Also returns the existing workout log if the client already saved one.
 *
 * Response:
 *   { success, assignment: null }           — no workout assigned today
 *   { success, assignment, log: null }      — assigned but not yet logged
 *   { success, assignment, log }            — assigned + already logged
 */
router.get('/clients/me/workout/today', clientAuthMiddleware, async (req: Request, res: Response) => {
    const { clientId } = req.clientAuth!;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });

    log('GET /clients/me/workout/today', `Client ${clientId} fetching workout for ${today}`);

    try {
        const assignment = await getWorkoutAssignmentForClient(clientId, today);

        if (!assignment) {
            log('GET /clients/me/workout/today', `No assignment found for client ${clientId} on ${today}`);
            return res.json({ success: true, assignment: null, log: null });
        }

        // Fetch any existing log for this assignment
        const assignmentId = assignment._id!.toString();
        const existingLog  = await getWorkoutLogForAssignment(assignmentId, clientId);

        log('GET /clients/me/workout/today', `✅ Found assignment ${assignmentId} for client ${clientId}`);
        res.json({
            success:    true,
            assignment: { ...assignment, _id: assignmentId },
            log:        existingLog ? { ...existingLog, _id: existingLog._id?.toString(), assignment_id: assignmentId } : null,
        });
    } catch (error: any) {
        logError('GET /clients/me/workout/today', error);
        res.status(500).json({ success: false, error: 'Failed to load today\'s workout.' });
    }
});

/**
 * GET /api/clients/me/workout/history
 * Returns the client's past workout assignments + logs (most recent 30).
 * Used by the mobile app for:
 *  - Exercise history display ("Previous performance")
 *  - Personal best computation
 *
 * Response:
 *   { success, entries: [{ assignment, log }] }
 */
router.get('/clients/me/workout/history', clientAuthMiddleware, async (req: Request, res: Response) => {
    const { clientId } = req.clientAuth!;

    log('GET /clients/me/workout/history', `Client ${clientId} fetching workout history`);

    try {
        const entries = await getWorkoutHistoryForClient(clientId, 30);

        // Serialise ObjectIds to strings for JSON response
        const serialised = entries.map(({ assignment, log }) => ({
            assignment: { ...assignment, _id: assignment._id?.toString() },
            log: log ? {
                ...log,
                _id: log._id?.toString(),
                assignment_id: assignment._id?.toString(),
            } : null,
        }));

        log('GET /clients/me/workout/history', `✅ Returning ${entries.length} history entries for client ${clientId}`);
        res.json({ success: true, entries: serialised });
    } catch (error: any) {
        logError('GET /clients/me/workout/history', error);
        res.status(500).json({ success: false, error: 'Failed to load workout history.' });
    }
});

/**
 * POST /api/clients/me/workout-log
 * Client submits (or updates) their workout log for an assigned workout.
 *
 * Body: { assignment_id: string, exercise_logs: ExerciseLog[] }
 *
 * Security rules enforced here:
 *  1. assignment_id must correspond to a real assignment
 *  2. assignment.client_id must match the authenticated client
 *  3. Each exercise_id must exist in assignment.exercises (validated server-side)
 *  4. Client-submitted exercise names/targets are IGNORED — only actual fields stored
 */
router.post('/clients/me/workout-log', clientAuthMiddleware, async (req: Request, res: Response) => {
    const { clientId } = req.clientAuth!;
    const { assignment_id, exercise_logs } = req.body as {
        assignment_id?:  string;
        exercise_logs?:  Array<{
            exercise_id:    string;
            completed:      boolean;
            actual_sets?:   number;
            actual_reps?:   number;
            actual_weight?: number;
            difficulty?:    number;
            notes?:         string;
        }>;
    };

    if (!assignment_id) {
        return res.status(400).json({ success: false, error: 'assignment_id is required.' });
    }
    if (!Array.isArray(exercise_logs) || exercise_logs.length === 0) {
        return res.status(400).json({ success: false, error: 'exercise_logs must be a non-empty array.' });
    }

    log('POST /clients/me/workout-log', `Client ${clientId} submitting log for assignment ${assignment_id}`);

    try {
        const db = await getDb();
        const { ObjectId } = await import('mongodb');

        // Step 1: Fetch the assignment and verify client ownership
        let assignmentObjId: any;
        try { assignmentObjId = new ObjectId(assignment_id); } catch {
            return res.status(400).json({ success: false, error: 'Invalid assignment_id format.' });
        }

        const assignment = await db.collection('workout_assignments').findOne({ _id: assignmentObjId });
        if (!assignment) {
            return res.status(404).json({ success: false, error: 'Workout assignment not found.' });
        }
        if (assignment['client_id'] !== clientId) {
            logOwnershipViolation('POST /clients/me/workout-log', 'CLIENT', clientId);
            return res.status(403).json({ success: false, error: 'Access denied.' });
        }

        // Step 2: Validate all submitted exercise_ids exist in the assignment
        const validExerciseIds = new Set<string>(
            (assignment['exercises'] as Array<{ id: string }>).map(ex => ex.id)
        );
        const invalidIds = exercise_logs.filter(el => !validExerciseIds.has(el.exercise_id));
        if (invalidIds.length > 0) {
            return res.status(400).json({
                success: false,
                error: `Invalid exercise_id(s): ${invalidIds.map(i => i.exercise_id).join(', ')}`,
            });
        }

        // Step 3: Sanitise — only keep actual performance fields, discard any injected names/targets
        const sanitisedLogs = exercise_logs.map(el => ({
            exercise_id:    el.exercise_id,
            completed:      !!el.completed,
            actual_sets:    typeof el.actual_sets   === 'number' ? el.actual_sets   : undefined,
            actual_reps:    typeof el.actual_reps   === 'number' ? el.actual_reps   : undefined,
            actual_weight:  typeof el.actual_weight === 'number' ? el.actual_weight : undefined,
            difficulty:     typeof el.difficulty    === 'number' && el.difficulty >= 1 && el.difficulty <= 10
                                ? el.difficulty : undefined,
            notes:          typeof el.notes === 'string' ? el.notes.trim().substring(0, 500) : undefined,
        }));

        // Step 4: Upsert the log
        const savedLog = await upsertWorkoutLog({
            assignment_id,
            client_id:     clientId,
            date:          assignment['date'] as string,
            exercise_logs: sanitisedLogs as any,
        });

        log('POST /clients/me/workout-log', `✅ Log saved for client ${clientId}, assignment ${assignment_id}`);
        res.json({
            success: true,
            log: { ...savedLog, _id: savedLog._id?.toString() },
        });
    } catch (error: any) {
        logError('POST /clients/me/workout-log', error);
        res.status(500).json({ success: false, error: 'Failed to save workout log.' });
    }
});

// ─── COACH workout routes ─────────────────────────────────────────────────────

/**
 * POST /api/coach/clients/:clientId/workouts
 * Coach assigns a workout to a client for a specific date.
 *
 * Body: { date, title, exercises: [{ name, target_sets, target_reps, target_weight?, notes? }] }
 * Returns: { success, assignment }
 *
 * Security: validates that clientId belongs to the authenticated coach.
 */
router.post('/coach/clients/:clientId/workouts', async (req: AuthenticatedRequest, res: Response) => {
    const coachId  = req.coach!.sub;
    const clientId = req.params['clientId'] as string;

    log('POST /coach/clients/:clientId/workouts', `Coach ${coachId} assigning workout to client ${clientId}`);

    // Verify coach owns this client
    const clientDoc = await validateClientOwnership(clientId, coachId);
    if (!clientDoc) {
        logOwnershipViolation('POST /coach/clients/:clientId/workouts', coachId, clientId);
        return res.status(403).json({ success: false, error: 'Access denied.' });
    }

    const { date, title, exercises } = req.body as {
        date?:      string;
        title?:     string;
        exercises?: Array<{
            name:           string;
            target_sets:    number;
            target_reps:    number;
            target_weight?: number;
            notes?:         string;
        }>;
    };

    // ── Validate required fields ──────────────────────────────────────────────
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ success: false, error: 'date is required (YYYY-MM-DD).' });
    }
    if (!title || !title.trim()) {
        return res.status(400).json({ success: false, error: 'title is required.' });
    }
    if (!Array.isArray(exercises) || exercises.length === 0) {
        return res.status(400).json({ success: false, error: 'exercises must be a non-empty array.' });
    }
    for (const ex of exercises) {
        if (!ex.name || !ex.name.trim()) {
            return res.status(400).json({ success: false, error: 'Each exercise must have a name.' });
        }
        if (typeof ex.target_sets !== 'number' || ex.target_sets < 1) {
            return res.status(400).json({ success: false, error: `Exercise "${ex.name}": target_sets must be a positive number.` });
        }
        if (typeof ex.target_reps !== 'number' || ex.target_reps < 1) {
            return res.status(400).json({ success: false, error: `Exercise "${ex.name}": target_reps must be a positive number.` });
        }
    }

    try {
        const assignment = await createWorkoutAssignment({
            coach_id:  coachId,
            client_id: clientId,
            date,
            title,
            exercises,
        });

        log('POST /coach/clients/:clientId/workouts', `✅ Assignment created: ${assignment._id?.toString()}`);
        res.status(201).json({
            success:    true,
            assignment: { ...assignment, _id: assignment._id?.toString() },
        });
    } catch (error: any) {
        logError('POST /coach/clients/:clientId/workouts', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/coach/clients/:clientId/workouts
 * Returns all workout assignments the coach has created for a specific client.
 * Sorted by date descending.
 *
 * Security: validates that clientId belongs to the authenticated coach.
 */
router.get('/coach/clients/:clientId/workouts', async (req: AuthenticatedRequest, res: Response) => {
    const coachId  = req.coach!.sub;
    const clientId = req.params['clientId'] as string;

    log('GET /coach/clients/:clientId/workouts', `Coach ${coachId} listing workouts for client ${clientId}`);

    const clientDoc = await validateClientOwnership(clientId, coachId);
    if (!clientDoc) {
        logOwnershipViolation('GET /coach/clients/:clientId/workouts', coachId, clientId);
        return res.status(403).json({ success: false, error: 'Access denied.' });
    }

    try {
        const assignments = await getWorkoutAssignmentsByCoach(coachId, clientId);
        const serialised  = assignments.map(a => ({ ...a, _id: a._id?.toString() }));
        log('GET /coach/clients/:clientId/workouts', `✅ Returning ${assignments.length} assignments`);
        res.json({ success: true, assignments: serialised, count: assignments.length });
    } catch (error: any) {
        logError('GET /coach/clients/:clientId/workouts', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;

