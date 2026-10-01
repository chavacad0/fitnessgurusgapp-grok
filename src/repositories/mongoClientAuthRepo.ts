import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/mongo';
import { Client } from '../types';

/**
 * Client Auth Repository — all DB access for client authentication.
 *
 * Two types of clients exist in the 'clients' collection:
 *  1. Coach-provisioned (old MVP): { id, name, email, coach_id } — no password.
 *     These use email-only login (POST /api/auth/client-login).
 *  2. Self-registered (new flow): same fields + password_hash + plan_status.
 *     These use email + password login.
 *
 * This repo handles both cases cleanly.
 */

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Find a client by email address (case-insensitive).
 * Returns the full document including password_hash if present.
 * Used by client-login for both old (no-password) and new (password) clients.
 */
export async function findClientByEmail(email: string): Promise<Client | null> {
    const db = await getDb();
    return db.collection<Client>('clients').findOne({
        email: email.toLowerCase().trim(),
    }) as Promise<Client | null>;
}

/**
 * Find a client by email, explicitly selecting password_hash.
 * Used by POST /api/auth/client-login when the client has self-registered.
 * Alias of findClientByEmail — password_hash is included in all findOne() results
 * unless projected out.  Kept as a distinct named function for clarity.
 */
export async function findClientByEmailWithPassword(email: string): Promise<Client | null> {
    return findClientByEmail(email);
}

/**
 * Find a client by their UUID 'id' field (not MongoDB _id).
 * The 'id' field is the canonical client identifier used in all API calls.
 *
 * Returns null if no client exists with that id.
 */
export async function findClientById(id: string): Promise<Client | null> {
    const db = await getDb();
    return db.collection<Client>('clients').findOne({ id }) as Promise<Client | null>;
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Create a new self-registered client account.
 *
 * Called by POST /api/auth/client-register.
 * coach_id is OPTIONAL — if no invite code was provided, the client
 * is created without a coach link. A coach can be linked later.
 *
 * Key differences from coach-provisioned clients:
 *  - password_hash is set (bcrypt)
 *  - id is a new UUID (not assigned by coach)
 *  - plan_status defaults to 'none'
 *
 * @throws MongoServerError code 11000 if email already exists in clients collection.
 */
export async function createClientAccount(data: {
    name:          string;
    email:         string;
    password_hash: string;
    coach_id?:     string;    // optional — undefined when no invite code given
}): Promise<Client> {
    const db  = await getDb();
    const now = new Date();

    const client: Client = {
        id:            uuidv4(),
        name:          data.name.trim(),
        email:         data.email.toLowerCase().trim(),
        password_hash: data.password_hash,
        // Only write coach_id if it has a non-empty value.
        // An absent field is cleaner than coach_id: '' for unlinked clients.
        ...(data.coach_id ? { coach_id: data.coach_id } : {}),
        plan_status:   'none',
    };

    const result = await db.collection<Client>('clients').insertOne(client as any);

    return {
        ...client,
        _id: result.insertedId.toString(),
    };
}

// ─── Plan state helpers ───────────────────────────────────────────────────────

/**
 * Update the plan_status and optionally selected_plan_id on a client document.
 * Called by select-plan, payment-create, and payment-confirm routes.
 */
export async function updateClientPlanStatus(
    clientId: string,
    update: {
        plan_status:        Client['plan_status'];
        selected_plan_id?:  string;
        payment_intent_id?: string;
    }
): Promise<void> {
    const db = await getDb();
    const $set: Record<string, any> = { plan_status: update.plan_status };
    if (update.selected_plan_id  !== undefined) $set['selected_plan_id']  = update.selected_plan_id;
    if (update.payment_intent_id !== undefined) $set['payment_intent_id'] = update.payment_intent_id;

    await db.collection('clients').updateOne({ id: clientId }, { $set });
}

// ─── Coach linkage ────────────────────────────────────────────────────────────

/**
 * Link an existing client to a coach by setting their coach_id.
 *
 * Called by POST /api/auth/connect-coach when a client who registered
 * without an invite code later provides one.
 *
 * Idempotent — if the client is already linked to this coach, it is a no-op.
 *
 * @returns true if the client document was found and updated, false if not found.
 */
export async function linkClientToCoach(
    clientId: string,
    coachId:  string,
): Promise<boolean> {
    const db = await getDb();
    const result = await db.collection('clients').updateOne(
        { id: clientId },
        { $set: { coach_id: coachId } },
    );
    return result.matchedCount > 0;
}

// ─── Body profile ─────────────────────────────────────────────────────────────

/**
 * Update the client profile fields: display name + body profile fields.
 *
 * Called by PATCH /api/clients/me/profile.
 *
 * Safety rules:
 *  - Only writes the six listed fields — cannot touch email, password_hash,
 *    coach_id, plan state, or any other auth/identity field.
 *  - Only updates keys that are explicitly present in the payload.
 *    Undefined keys are skipped so a partial update never wipes existing data.
 *  - name must be non-empty if provided (validated by the route before calling here).
 *  - clientId is the UUID (Client.id), not the MongoDB _id.
 *
 * @returns true if the document was found and updated, false if no client matched.
 */
export async function updateClientBodyProfile(
    clientId: string,
    data: {
        name?:                        string;
        height_cm?:                   number;
        weight_kg?:                   number;
        fitness_goal?:                string;
        injuries_notes?:              string;
        training_experience?:         string;
        // Body measurements (cm)
        neck_cm?:                     number;
        chest_cm?:                    number;
        waist_cm?:                    number;
        hips_cm?:                     number;
        // Check-in preference fields
        check_in_reminders_enabled?:  boolean;
        check_in_status?:             'active' | 'paused';
        check_in_paused_at?:          string | null;
    },
): Promise<boolean> {
    const db   = await getDb();
    const $set: Record<string, unknown> = {};

    // Only write keys that were explicitly provided by the caller
    if (data.name                !== undefined) $set['name']                = data.name.trim();
    if (data.height_cm           !== undefined) $set['height_cm']           = data.height_cm;
    if (data.weight_kg           !== undefined) $set['weight_kg']           = data.weight_kg;
    if (data.fitness_goal        !== undefined) $set['fitness_goal']        = data.fitness_goal.trim();
    if (data.injuries_notes      !== undefined) $set['injuries_notes']      = data.injuries_notes.trim();
    if (data.training_experience !== undefined) $set['training_experience'] = data.training_experience.trim();
    // Body measurements
    if (data.neck_cm             !== undefined) $set['neck_cm']             = data.neck_cm;
    if (data.chest_cm            !== undefined) $set['chest_cm']            = data.chest_cm;
    if (data.waist_cm            !== undefined) $set['waist_cm']            = data.waist_cm;
    if (data.hips_cm             !== undefined) $set['hips_cm']             = data.hips_cm;
    // Check-in preference fields
    if (data.check_in_reminders_enabled !== undefined) $set['check_in_reminders_enabled'] = data.check_in_reminders_enabled;
    if (data.check_in_status            !== undefined) $set['check_in_status']             = data.check_in_status;
    if (data.check_in_paused_at         !== undefined) $set['check_in_paused_at']          = data.check_in_paused_at;

    if (Object.keys($set).length === 0) return true; // nothing to write — no-op

    const result = await db.collection('clients').updateOne(
        { id: clientId },
        { $set },
    );
    return result.matchedCount > 0;
}
