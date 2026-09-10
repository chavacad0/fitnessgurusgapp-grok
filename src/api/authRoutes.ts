import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import {
    createCoach, findCoachByEmail, getCoachById, findCoachByGoogleId,
    createGoogleCoach, linkGoogleToCoach,
    generateInviteCodeForCoach, findCoachByInviteCode, findSingleCoach,
} from '../repositories/mongoCoachRepo';
import {
    findClientByEmail,
    createClientAccount,
    linkClientToCoach,
} from '../repositories/mongoClientAuthRepo';
import { toPublicCoach } from '../models/coachModel';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware';
import { clientAuthMiddleware } from '../middleware/clientAuthMiddleware';
import { authLimiter } from '../middleware/rateLimiter';

const router = Router();

const BCRYPT_SALT_ROUNDS = 12;
const JWT_EXPIRY = '30d';  // Extended from 7d — no refresh-token flow yet. Review when adding refresh.

function log(route: string, message: string) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${route}] ${message}`);
}

function logError(route: string, error: any) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [${route}] ❌ ERROR:`, error.message || error);
}

/**
 * POST /api/auth/register
 * Create a new COACH account — ADMIN ONLY.
 *
 * 🔐 SECURITY CONTRACT:
 *   - This endpoint is NOT for mobile clients.
 *   - It requires a valid `x-admin-secret` header matching the ADMIN_SECRET env var.
 *   - Coach accounts are provisioned manually (Postman / seed scripts), never via the mobile app.
 *   - If ADMIN_SECRET is not configured, this endpoint is disabled entirely (503).
 *
 * The mobile app's RegisterScreen calls POST /api/auth/client-register instead.
 */
router.post('/register', async (req: Request, res: Response) => {
    // ── ADMIN GUARD ──────────────────────────────────────────────────────────
    const adminSecret = process.env.ADMIN_SECRET;
    if (!adminSecret) {
        log('POST /auth/register', '❌ ADMIN_SECRET not configured — endpoint disabled');
        res.status(503).json({
            success: false,
            error: 'Coach registration is not available. Contact the system administrator.',
        });
        return;
    }
    const provided = req.headers['x-admin-secret'];
    if (!provided || provided !== adminSecret) {
        log('POST /auth/register', '⛔ Rejected — missing or invalid x-admin-secret header');
        res.status(403).json({
            success: false,
            error: 'Access denied. This endpoint requires admin authorisation.',
        });
        return;
    }
    // ── END ADMIN GUARD ──────────────────────────────────────────────────────
    log('POST /auth/register', 'Register attempt received');

    // Destructure only allowed fields — role is intentionally excluded.
    // Even if someone sends { role: 'coach' } in the body, it is never read.
    const { email, password, name } = req.body;

    // Validate required fields
    if (!email || !password || !name) {
        log('POST /auth/register', '⚠️ Validation failed: missing fields');
        res.status(400).json({
            success: false,
            error: 'email, password, and name are required'
        });
        return;
    }

    // Validate email format (basic)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        res.status(400).json({
            success: false,
            error: 'Invalid email format'
        });
        return;
    }

    // Validate password strength (minimum 8 chars)
    if (password.length < 8) {
        res.status(400).json({
            success: false,
            error: 'Password must be at least 8 characters'
        });
        return;
    }

    try {
        // Hash password
        const password_hash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

        // createCoach() will throw E11000 if email already exists — caught below.
        // NOTE: The collection is named 'coaches' for legacy reasons; the role
        // embedded in the JWT at login time is what determines app access.
        const coach = await createCoach({ email, password_hash, name });

        log('POST /auth/register', `✅ Client account registered: ${email}`);

        res.status(201).json({
            success: true,
            message: 'Account created successfully',
            coach: toPublicCoach(coach as any)
        });
    } catch (error: any) {
        // E11000 = MongoDB duplicate key — email already registered
        if (error.code === 11000) {
            log('POST /auth/register', `⚠️ Duplicate email rejected: ${email}`);
            res.status(409).json({
                success: false,
                error: 'Email already registered'
            });
            return;
        }
        logError('POST /auth/register', error);
        res.status(500).json({
            success: false,
            error: 'Registration failed'
        });
    }
});


/**
 * POST /api/auth/login
 * Verify credentials and return JWT
 * Public — no auth required
 *
 * Rate limiter: authLimiter (10 requests / 15 min per IP)
 */
router.post('/login', authLimiter, async (req: Request, res: Response) => {
    log('POST /auth/login', 'Login attempt received');

    const { email, password } = req.body;

    if (!email || !password) {
        res.status(400).json({
            success: false,
            error: 'email and password are required'
        });
        return;
    }

    try {
        // Find coach by email
        const coach = await findCoachByEmail(email);

        if (!coach) {
            // Use generic message — do not reveal whether email exists
            log('POST /auth/login', `⚠️ Login failed: coach not found for ${email}`);
            res.status(401).json({
                success: false,
                error: 'Invalid credentials'
            });
            return;
        }

        // Verify password
        const passwordMatch = await bcrypt.compare(password, coach.password_hash);

        if (!passwordMatch) {
            log('POST /auth/login', `⚠️ Login failed: wrong password for ${email}`);
            res.status(401).json({
                success: false,
                error: 'Invalid credentials'
            });
            return;
        }

        // Sign JWT — embed role so mobile can route without DB lookup
        const secret = process.env.JWT_SECRET!; // Guaranteed by server.ts startup validation
        const token = jwt.sign(
            {
                sub:   (coach as any)._id?.toString() || '',
                email: coach.email,
                role:  (coach as any).role ?? 'coach',   // existing coaches without role field default to 'coach'
            },
            secret,
            { expiresIn: JWT_EXPIRY }
        );

        log('POST /auth/login', `✅ Login successful: ${email}`);

        res.json({
            success: true,
            token,
            coach: toPublicCoach(coach as any)
        });
    } catch (error: any) {
        logError('POST /auth/login', error);
        res.status(500).json({
            success: false,
            error: 'Login failed'
        });
    }
});

/**
 * GET /api/auth/me
 * Return current coach profile including subscriptionTier and isPro
 * PROTECTED — requires valid JWT
 *
 * Performance fix: was findCoachByEmail(req.coach.email) — string scan.
 * Now uses getCoachById(req.coach.sub) — ObjectId primary key lookup.
 * Also returns subscriptionTier and isPro for Phase 8 mobile gating.
 */
router.get('/me', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    log('GET /auth/me', `Profile requested by coach: ${req.coach?.sub}`);

    try {
        // ObjectId primary key lookup — faster than email scan, and req.coach.sub
        // is the coach._id embedded in the JWT as 'sub'.
        const coach = await getCoachById(req.coach!.sub);

        if (!coach) {
            res.status(404).json({
                success: false,
                error: 'Coach not found'
            });
            return;
        }

        log('GET /auth/me', `✅ Profile returned for coach: ${req.coach?.sub}`);

        res.json({
            success: true,
            coach: toPublicCoach(coach as any),
        });
    } catch (error: any) {
        logError('GET /auth/me', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve profile'
        });
    }
});

/**
 * POST /api/auth/google
 * Exchange a Google-issued ID token for a FitnessGuruSG JWT.
 * Public — no auth required.
 *
 * Security model:
 *   The frontend sends the raw idToken from Google's OAuth flow.
 *   We verify it server-side using google-auth-library, which validates
 *   the token's signature against Google's public certificates.
 *   We NEVER trust any user data from the frontend — all profile info
 *   (email, name, picture) comes exclusively from the verified Google payload.
 *
 * Flow:
 *   1. Verify idToken → extract { sub (googleId), email, name, picture }
 *   2. findCoachByGoogleId → found → return JWT immediately
 *   3. Not found → findCoachByEmail → found → link Google ID → return JWT
 *   4. Not found either → createGoogleCoach → return JWT
 */
router.post('/google', async (req: Request, res: Response) => {
    log('POST /auth/google', 'Google login attempt received');

    const { idToken } = req.body as { idToken?: string };

    if (!idToken) {
        res.status(400).json({
            success: false,
            error: 'idToken is required'
        });
        return;
    }

    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    if (!googleClientId) {
        log('POST /auth/google', '❌ GOOGLE_CLIENT_ID not configured');
        res.status(500).json({
            success: false,
            error: 'Google login is not configured on this server'
        });
        return;
    }

    try {
        // ── Step 1: Verify Google ID token ────────────────────────────────────
        const client = new OAuth2Client(googleClientId);
        const ticket = await client.verifyIdToken({
            idToken,
            audience: googleClientId,
        });

        const payload = ticket.getPayload();
        if (!payload || !payload.email || !payload.sub) {
            log('POST /auth/google', '⚠️ Token payload missing required fields');
            res.status(401).json({
                success: false,
                error: 'Invalid Google token'
            });
            return;
        }

        const { sub: googleId, email, name = email, picture } = payload;
        const normalizedEmail = email.toLowerCase().trim();

        log('POST /auth/google', `Google token verified — email: ${normalizedEmail}`);

        let coach;

        // ── Step 2: Check if this Google account is already linked ─────────────
        coach = await findCoachByGoogleId(googleId);

        if (!coach) {
                    // ── Step 3: Check if email exists as email/password account ───────
            const existingCoach = await findCoachByEmail(normalizedEmail);

            if (existingCoach) {
                // Account linking: same email registered with email/password.
                // Preserve existing role — do not downgrade a coach to client.
                const coachId = (existingCoach as any)._id?.toString();
                await linkGoogleToCoach(coachId, googleId, picture);
                coach = { ...existingCoach, googleId, picture, provider: 'google' as const };
                log('POST /auth/google', `✅ Linked Google ID to existing user (${(existingCoach as any).role ?? 'coach'}): ${normalizedEmail}`);
            } else {
                // ── Step 4: New user — create as client (Google default) ──────
                coach = await createGoogleCoach({
                    email:    normalizedEmail,
                    name:     name || normalizedEmail,
                    googleId,
                    picture,
                });
                log('POST /auth/google', `✅ Created new client via Google: ${normalizedEmail}`);
            }
        } else {
            log('POST /auth/google', `✅ Existing user found via Google (${(coach as any).role ?? 'coach'}): ${normalizedEmail}`);
        }

        // ── Step 5: Issue FitnessGuruSG JWT (role embedded) ──────────────────
        const secret = process.env.JWT_SECRET!;
        const userRole = (coach as any).role ?? 'coach';  // existing users without role default to 'coach'
        const token = jwt.sign(
            {
                sub:   (coach as any)._id?.toString() || '',
                email: coach.email,
                role:  userRole,   // mobile reads role from JWT — NOT from frontend
            },
            secret,
            { expiresIn: JWT_EXPIRY }
        );

        log('POST /auth/google', `✅ JWT issued for ${normalizedEmail} (role: ${userRole})`);

        res.json({
            success: true,
            token,
            coach: toPublicCoach(coach as any)
        });

    } catch (error: any) {
        // google-auth-library throws for invalid / expired / tampered tokens
        if (error.message?.includes('Token used too late') ||
            error.message?.includes('Invalid token signature') ||
            error.message?.includes('Wrong number of segments') ||
            error.message?.includes('audience')) {
            log('POST /auth/google', `⚠️ Invalid Google token: ${error.message}`);
            res.status(401).json({
                success: false,
                error: 'Invalid or expired Google token'
            });
            return;
        }

        logError('POST /auth/google', error);
        res.status(500).json({
            success: false,
            error: 'Google login failed'
        });
    }
});

/**
 * POST /api/auth/client-register
 * Self-registration for clients.
 *
 * SINGLE-COACH ARCHITECTURE:
 *  No invite code required. All new clients are automatically linked
 *  to the single coach in the system (found via findSingleCoach).
 *
 * Flow:
 *  1. Validate name, email, password
 *  2. findSingleCoach() — fetch the one coach; 503 if none exists yet
 *  3. Check for duplicate email
 *  4. bcrypt.hash(password)
 *  5. createClientAccount({ name, email, password_hash, coach_id })
 *  6. Issue JWT with role: 'client'
 *  7. Return { success, token, client }
 *
 * Security:
 *  - Role is ALWAYS forced to 'client' — cannot be overridden
 *  - Duplicate email returns 409
 *
 * Backward compat:
 *  - Any coachCode field sent by an old client version is silently ignored
 */
router.post('/client-register', authLimiter, async (req: Request, res: Response) => {
    log('POST /auth/client-register', 'Self-registration attempt received');

    // Destructure only the fields we need — coachCode is intentionally ignored.
    const { name, email, password } = req.body as {
        name?:     string;
        email?:    string;
        password?: string;
    };

    // ── Required field validation ────────────────────────────────────────────
    if (!name || !email || !password) {
        res.status(400).json({ success: false, error: 'name, email, and password are required' });
        return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
        res.status(400).json({ success: false, error: 'Invalid email format' });
        return;
    }
    if (password.length < 8) {
        res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
        return;
    }

    try {
        // ── Auto-assign single coach ───────────────────────────────────────────
        const coach = await findSingleCoach();
        if (!coach) {
            // No coach exists — system not yet set up
            log('POST /auth/client-register', '❌ No coach found in system — system not initialised');
            res.status(503).json({
                success: false,
                error:   'Registration is temporarily unavailable. Please try again later.',
            });
            return;
        }
        const coachId = (coach as any)._id?.toString();
        log('POST /auth/client-register', `✅ Auto-assigning coach ${coachId} to new client`);

        // ── Duplicate email check ─────────────────────────────────────────────────
        const existing = await findClientByEmail(email.trim().toLowerCase());
        if (existing) {
            res.status(409).json({
                success: false,
                error:   'An account with this email already exists. Please sign in.',
            });
            return;
        }

        // ── Create client account ─────────────────────────────────────────────────
        const password_hash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
        const client = await createClientAccount({
            name:          name.trim(),
            email:         email.trim().toLowerCase(),
            password_hash,
            coach_id:      coachId,
        });

        const clientDocId = (client as any)._id?.toString() ?? '';

        // ── Issue JWT ─────────────────────────────────────────────────────────────
        const secret = process.env.JWT_SECRET!;
        const token = jwt.sign(
            {
                sub:      clientDocId,
                email:    client.email,
                role:     'client',
                clientId: client.id,
            },
            secret,
            { expiresIn: JWT_EXPIRY },
        );

        log('POST /auth/client-register', `✅ Client registered: ${email} → coach ${coachId}`);

        res.status(201).json({
            success: true,
            token,
            client: {
                _id:      clientDocId,
                id:       client.id,
                email:    client.email,
                name:     client.name,
                coach_id: client.coach_id ?? null,
            },
        });
    } catch (error: any) {
        // E11000 catch — race condition guard (duplicate email written between our check and insert)
        if (error.code === 11000) {
            res.status(409).json({ success: false, error: 'Email already registered' });
            return;
        }
        logError('POST /auth/client-register', error);
        res.status(500).json({ success: false, error: 'Registration failed' });
    }
});

/**
 * GET /api/auth/invite-code
 * Returns (or generates) the coach's unique invite code.
 *
 * Protected: coach JWT required.
 * Lazy generation: code is created on first call, then reused.
 *
 * Coach shares this code with clients verbally / via WhatsApp.
 * Clients enter it in the registration screen to link themselves to this coach.
 */
router.get('/invite-code', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    const coachId = req.coach!.sub;
    log('GET /auth/invite-code', `Coach ${coachId} requesting invite code`);

    try {
        const coach = await getCoachById(coachId);
        if (!coach) {
            res.status(404).json({ success: false, error: 'Coach not found' });
            return;
        }

        // If the coach already has a code, return it (idempotent)
        // Otherwise generate a new one lazily
        let code: string;
        if (coach.inviteCode) {
            code = coach.inviteCode.toUpperCase(); // display in uppercase
        } else {
            code = await generateInviteCodeForCoach(coachId); // returns uppercase
        }

        log('GET /auth/invite-code', `✅ Returning invite code for coach ${coachId}: ${code}`);

        res.json({
            success:     true,
            inviteCode:  code,
            // Convenience: pre-formatted share message coaches can paste to WhatsApp
            shareMessage: `Hi! Use code *${code}* to register on FitnessGuruSG and join my coaching program.`,
        });
    } catch (error: any) {
        logError('GET /auth/invite-code', error);
        res.status(500).json({ success: false, error: 'Failed to get invite code' });
    }
});

/**
 * POST /api/auth/client-login
 * Authenticate a client account.
 *
 * Supports TWO authentication modes:
 *
 *  Mode A — Self-registered clients (new flow):
 *   Body: { email, password }
 *   The client has a password_hash in the DB (set during self-registration).
 *   bcrypt.compare(password, password_hash) must succeed.
 *
 *  Mode B — Coach-provisioned clients (old MVP, backward compat):
 *   Body: { email } (no password field)
 *   The client has NO password_hash (was created by coach with no set password).
 *   Email-only authentication. Login succeeds if email is found in clients collection.
 *
 * Both modes issue a JWT with role: 'client'.
 * Rate-limited.
 */
router.post('/client-login', authLimiter, async (req: Request, res: Response) => {
    log('POST /auth/client-login', 'Client login attempt received');

    const { email, password } = req.body as { email?: string; password?: string };

    if (!email) {
        res.status(400).json({ success: false, error: 'email is required' });
        return;
    }

    const normalizedEmail = email.toLowerCase().trim();
    const emailRegex      = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
        res.status(400).json({ success: false, error: 'Invalid email format' });
        return;
    }

    try {
        const client = await findClientByEmail(normalizedEmail);

        if (!client) {
            log('POST /auth/client-login', `⚠️ Client not found: ${normalizedEmail}`);
            res.status(401).json({
                success: false,
                error:   'Invalid email or password.',
            });
            return;
        }

        // ── Password verification ─────────────────────────────────────────────────
        //
        // SECURITY (2026-05-23): Mode B (email-only login for coach-provisioned clients
        // with no password_hash) has been DISABLED. It allowed anyone who knew a client's
        // email to log in without a password — a real account-takeover risk.
        //
        // All clients must now have a password_hash. Accounts created before this change
        // that have no password_hash will receive a clear re-registration message.
        if (!client.password_hash) {
            log('POST /auth/client-login', `⛔ Passwordless account blocked: ${normalizedEmail}`);
            res.status(401).json({
                success: false,
                error:   'This account requires password setup. Please re-register or contact your coach.',
            });
            return;
        }

        // Normal password login — bcrypt comparison
        if (!password) {
            res.status(400).json({ success: false, error: 'password is required' });
            return;
        }
        const valid = await bcrypt.compare(password, client.password_hash);
        if (!valid) {
            log('POST /auth/client-login', `⚠️ Invalid password for: ${normalizedEmail}`);
            res.status(401).json({ success: false, error: 'Invalid email or password.' });
            return;
        }

        // ── JWT issuance ──────────────────────────────────────────────────────────
        // sub = client.id (UUID) — the canonical application-level identifier.
        //
        // WHY UUID and not MongoDB _id?
        //   Every data collection (checkins, client_plans, bookings, payments) stores
        //   the client reference as client_id = UUID. Using UUID as sub means:
        //     sub === URL :clientId → always true for valid requests
        //   No dual-check workaround needed in routes.
        //
        //   MongoDB _id is an internal DB concept. The app doesn't need it in auth.
        const mongoId  = (client as any)._id?.toString() ?? '';  // kept only for response body
        const clientId = client.id;                               // UUID — the one true identifier

        const secret = process.env.JWT_SECRET!;
        const token = jwt.sign(
            {
                sub:   clientId,        // UUID — matches every API route query
                email: client.email,
                role:  'client',
                // clientId claim removed — sub IS the clientId now
            },
            secret,
            { expiresIn: JWT_EXPIRY },
        );

        log('POST /auth/client-login', `✅ JWT issued for client: ${normalizedEmail}`);

        res.json({
            success: true,
            token,
            client: {
                _id:      mongoId,          // MongoDB ObjectId — kept for AuthUser.id in mobile
                id:       client.id,        // UUID — the canonical identifier
                email:    client.email,
                name:     client.name,
                coach_id: client.coach_id,
            },
        });
    } catch (error: any) {
        logError('POST /auth/client-login', error);
        res.status(500).json({ success: false, error: 'Login failed' });
    }
});

/**
 * POST /api/auth/connect-coach
 * Link an authenticated client to a coach via invite code.
 *
 * Called from ConnectToCoachScreen when a client who registered without
 * an invite code later wants to join a coach's program.
 *
 * Flow:
 *  1. Validate the invite code format
 *  2. findCoachByInviteCode(code) — look up the coach
 *  3. linkClientToCoach(clientId, coachId) — set client.coach_id
 *  4. Return { success, message, coachName }
 *
 * Security:
 *  - Requires a valid CLIENT JWT (clientAuthMiddleware)
 *  - Invite code is sanitised (trimmed, uppercased) before lookup
 *  - Rate-limited (authLimiter) to prevent invite code brute-force
 *  - Returns 400 (not 404) on invalid code — avoids coach enumeration
 *
 * Protected: client JWT required.
 * Rate-limited.
 */
router.post('/connect-coach', authLimiter, clientAuthMiddleware, async (req: Request, res: Response) => {
    const clientId = (req as any).clientAuth!.clientId as string;
    log('POST /auth/connect-coach', `Client ${clientId} attempting to connect to coach`);

    const { inviteCode } = req.body as { inviteCode?: string };

    // ── Validate input ────────────────────────────────────────────────────────
    if (!inviteCode || typeof inviteCode !== 'string') {
        res.status(400).json({ success: false, error: 'inviteCode is required.' });
        return;
    }

    const sanitizedCode = inviteCode.trim().toUpperCase();

    if (sanitizedCode.length < 4 || sanitizedCode.length > 16) {
        res.status(400).json({ success: false, error: 'Invalid invite code format.' });
        return;
    }

    try {
        // ── Look up the coach by invite code ──────────────────────────────────
        const coach = await findCoachByInviteCode(sanitizedCode);

        if (!coach) {
            // Return 400, not 404 — avoids confirming whether a code exists at all
            log('POST /auth/connect-coach', `⚠️ No coach found for code: ${sanitizedCode}`);
            res.status(400).json({
                success: false,
                error:   "That invite code doesn't match. Please check with your coach.",
            });
            return;
        }

        const coachId = (coach as any)._id?.toString() as string;

        // ── Link client to coach ──────────────────────────────────────────────
        const linked = await linkClientToCoach(clientId, coachId);

        if (!linked) {
            log('POST /auth/connect-coach', `❌ Client ${clientId} not found during linkage`);
            res.status(404).json({ success: false, error: 'Client account not found.' });
            return;
        }

        log('POST /auth/connect-coach', `✅ Client ${clientId} linked to coach ${coachId} (${coach.name})`);

        res.json({
            success:    true,
            message:    `You are now connected to ${coach.name}. Welcome to the program!`,
            coachName:  coach.name,
        });
    } catch (error: any) {
        logError('POST /auth/connect-coach', error);
        res.status(500).json({ success: false, error: 'Failed to connect to coach. Please try again.' });
    }
});

export default router;
