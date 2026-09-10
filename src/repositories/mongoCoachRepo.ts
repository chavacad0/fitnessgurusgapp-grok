import { ObjectId } from 'mongodb';
import { getDb } from '../db/mongo';
import { Coach } from '../models/coachModel';

/**
 * MongoDB repository for coaches.
 * Pure data access — no business logic, no password operations here.
 */

/**
 * Find a coach by email address (case-insensitive).
 * Uses coaches_email_unique index — fast lookup.
 */
export async function findCoachByEmail(email: string): Promise<Coach | null> {
    const db = await getDb();
    return db.collection<Coach>('coaches').findOne({
        email: email.toLowerCase().trim()
    });
}

/**
 * Find a coach by Google's unique user ID (the 'sub' claim from the ID token).
 * Fast indexed lookup — used by POST /api/auth/google.
 * Returns null if no coach is linked to this Google account.
 */
export async function findCoachByGoogleId(googleId: string): Promise<Coach | null> {
    const db = await getDb();
    return db.collection<Coach>('coaches').findOne({ googleId });
}

/**
 * Find a coach by MongoDB _id.
 * Primary key lookup — used by authMiddleware-protected routes
 * instead of email scan (faster, and preferred when req.coach.sub is available).
 * Returns null for invalid ObjectId format to avoid throwing.
 */
export async function getCoachById(id: string): Promise<Coach | null> {
    const db = await getDb();
    try {
        return db.collection<Coach>('coaches').findOne({ _id: new ObjectId(id) as any });
    } catch {
        // Invalid ObjectId format (e.g., malformed JWT sub claim)
        return null;
    }
}

/**
 * Insert a new coach document.
 * password_hash must already be hashed by the caller (authRoutes).
 *
 * Throws an error with code 11000 if the email is already registered.
 * The unique index on coaches.email enforces this atomically — no
 * separate findCoachByEmail check needed before calling this.
 */
export async function createCoach(data: {
    email: string;
    password_hash: string;
    name: string;
}): Promise<Coach> {
    const db  = await getDb();
    const now = new Date();

    const coach: Coach = {
        email:     data.email.toLowerCase().trim(),
        password_hash: data.password_hash,
        name:      data.name.trim(),
        createdAt: now,
        role:      'coach',   // email/password registration always creates a coach
        provider:  'local',
    };

    const result = await db.collection<Coach>('coaches').insertOne(coach as any);

    return {
        ...coach,
        _id: result.insertedId.toString(),
    };
}

/**
 * Create a new user who authenticated via Google OAuth.
 * New Google users are role = 'client' by default.
 * Role can be upgraded to 'coach' via admin/backend logic.
 *
 * Throws MongoServerError code 11000 if the email is already registered
 * (race condition guard — caller must catch and return appropriate response).
 */
export async function createGoogleCoach(data: {
    email: string;
    name: string;
    googleId: string;
    picture?: string;
}): Promise<Coach> {
    const db  = await getDb();
    const now = new Date();

    const coach: Coach = {
        email:     data.email.toLowerCase().trim(),
        password_hash: '',        // Google users have no password
        name:      data.name.trim(),
        createdAt: now,
        role:      'client',    // new Google users are clients by default
        provider:  'google',
        googleId:  data.googleId,
        picture:   data.picture,
    };

    const result = await db.collection<Coach>('coaches').insertOne(coach as any);

    return {
        ...coach,
        _id: result.insertedId.toString(),
    };
}

/**
 * Link a Google ID to an existing email/password coach.
 * Used for account linking when a 'local' coach signs in with Google
 * using the same email address for the first time.
 */
export async function linkGoogleToCoach(
    coachId: string,
    googleId: string,
    picture?: string,
): Promise<void> {
    const db = await getDb();
    await db.collection<Coach>('coaches').updateOne(
        { _id: new ObjectId(coachId) as any },
        { $set: { provider: 'google', googleId, ...(picture ? { picture } : {}) } }
    );
}

// ─── Invite Code ──────────────────────────────────────────────────────────────

/**
 * Generate a unique 6-character alphanumeric invite code for a coach.
 * Called lazily on first GET /api/auth/invite-code request.
 *
 * Algorithm:
 *  1. Generate a random 6-char code (uppercase A-Z + digits)
 *  2. Check for collision in 'coaches' collection
 *  3. Retry up to 5 times on collision (astronomically unlikely: 36^6 = 2.18B)
 *  4. Save to coach document and return
 *
 * Stored as lowercase in DB; displayed uppercase to user.
 */
export async function generateInviteCodeForCoach(coachId: string): Promise<string> {
    const db = await getDb();

    const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1 (ambiguous chars removed)
    const MAX_RETRIES = 5;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        // Generate a 6-char random code
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += CHARS.charAt(Math.floor(Math.random() * CHARS.length));
        }
        const stored = code.toLowerCase();

        // Check for collision
        const existing = await db.collection('coaches').findOne({ inviteCode: stored });
        if (existing) continue; // collision — retry

        // Save to coach document
        await db.collection('coaches').updateOne(
            { _id: new ObjectId(coachId) as any },
            { $set: { inviteCode: stored } }
        );

        return code; // return uppercase for display
    }

    throw new Error('Failed to generate a unique invite code after 5 attempts.');
}

/**
 * Find a coach by their invite code.
 * Used during POST /api/auth/client-register to link the new client to the right coach.
 *
 * Code comparison is case-insensitive (stored lowercase, user may enter uppercase).
 * Returns null if no coach has this code — caller should return 400.
 */
export async function findCoachByInviteCode(code: string): Promise<Coach | null> {
    const db = await getDb();
    return db.collection<Coach>('coaches').findOne({
        inviteCode: code.toLowerCase().trim(),
    }) ?? null;
}

// ─── Single-coach helpers ─────────────────────────────────────────────────────

/**
 * Find the single coach in the system.
 *
 * Used by POST /api/auth/client-register in the single-coach architecture.
 * All new clients are automatically assigned to this coach — no invite code needed.
 *
 * Filter: role === 'coach' ensures we skip Google OAuth users who landed in
 * this collection with role: 'client' (legacy behaviour from createGoogleCoach).
 *
 * Returns null only if no coach account exists yet (should never happen in
 * production — caught by the caller which returns 503).
 */
export async function findSingleCoach(): Promise<Coach | null> {
    const db = await getDb();
    return db.collection<Coach>('coaches').findOne({ role: 'coach' }) ?? null;
}
