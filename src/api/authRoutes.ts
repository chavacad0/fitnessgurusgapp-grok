import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import {
    createCoach, findCoachByEmail, getCoachById, findCoachByGoogleId,
    linkGoogleToCoach,
    generateInviteCodeForCoach, findCoachByInviteCode,
} from '../repositories/mongoCoachRepo';
import {
    findClientByEmail,
    findClientByGoogleId,
    createClientAccount,
    createGoogleClientAccount,
    linkGoogleIdToClient,
    linkClientToCoach,
} from '../repositories/mongoClientAuthRepo';
import { Client } from '../types';
import { toPublicCoach } from '../models/coachModel';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/requireRole';
import { clientAuthMiddleware } from '../middleware/clientAuthMiddleware';
import { authLimiter } from '../middleware/rateLimiter';

const router = Router();

const BCRYPT_SALT_ROUNDS = 12;
const JWT_EXPIRY = '30d';  // Extended from 7d — no refresh-token flow yet. Review when adding refresh.

// One message per toggle. Unknown email, wrong password, and "wrong role"
// all return this exact body so the response cannot be used to probe accounts.
const COACH_SIGN_IN_ERROR =
    "We couldn't sign you in as a coach. If you're a client, switch to Client above.";
const CLIENT_SIGN_IN_ERROR =
    "We couldn't sign you in as a client. If you're a coach, switch to Coach above.";

// Same cost as real password hashes (12) so a miss takes about as long as a real check.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('sign-in-timing-pad', BCRYPT_SALT_ROUNDS);

function rejectSignIn(res: Response, error: string): void {
    res.status(401).json({ success: false, error });
}

/** 'coach' | 'client' from the Login toggle. Anything else is ignored (never grants a role). */
function readSignInAs(value: unknown): 'coach' | 'client' | undefined {
    return value === 'coach' || value === 'client' ? value : undefined;
}

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
        // A real coach has a coaches document whose role is not 'client'
        // (legacy Google clients live in this collection with role 'client').
        const coach = await findCoachByEmail(email);
        const coachRole = coach ? ((coach as any).role ?? 'coach') : null;
        const isRealCoach = !!coach && coachRole !== 'client' && !!coach.password_hash;

        // Always run bcrypt. A missing account uses a dummy hash so it is not
        // obviously faster than a wrong password.
        const passwordMatch = await bcrypt.compare(
            password,
            isRealCoach ? coach!.password_hash! : DUMMY_PASSWORD_HASH,
        );

        if (!coach || !isRealCoach || !passwordMatch) {
            log('POST /auth/login', 'Coach sign-in rejected');
            rejectSignIn(res, COACH_SIGN_IN_ERROR);
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
 *   the token's signature against Google's public certificates, its expiry
 *   and its audience. We additionally assert the issuer and that Google has
 *   verified the email address BEFORE any account lookup or linking.
 *   We NEVER trust any user data from the frontend — all profile info
 *   (email, name, picture) comes exclusively from the verified Google payload.
 *
 * Identity resolution (coaches and clients live in separate collections):
 *   1. Coach path — a 'coaches' document matched by googleId, then by verified email,
 *      whose role is not 'client' → coach JWT (sub = coaches._id). Unchanged behaviour.
 *   2. Client path — everyone else resolves to a record in the 'clients' collection:
 *        clients.google_id match → existing client
 *        else clients.email match (verified email) → link google_id (never overwrite)
 *        else → create a new client with NO coach_id (connect via invitation code later)
 *      Client JWT: sub = clients.id (UUID) — identical to POST /auth/client-login.
 *      A coaches document ID is NEVER used as a client identity.
 *
 *   Legacy: pre-fix Google sign-ups were stored in 'coaches' with role 'client'.
 *   Those documents are left untouched (no delete / no migration) and are only
 *   referenced via clients.legacy_user_id for traceability.
 */
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

/** Mask an email for logs: "jane.doe@gmail.com" → "j***@g***" */
function maskEmail(email: string): string {
    const [local = '', domain = ''] = email.split('@');
    return `${local.charAt(0)}***@${domain.charAt(0)}***`;
}

/** Error carrying an HTTP status, thrown by resolveGoogleClient for identity conflicts. */
class GoogleIdentityError extends Error {
    constructor(public statusCode: number, message: string) { super(message); }
}

/**
 * Resolve (find / link / create) the 'clients' record for a verified Google identity.
 * Never overwrites an existing google_id or coach_id.
 */
async function resolveGoogleClient(args: {
    googleId:      string;
    email:         string;
    name:          string;
    legacyUserId?: string;
}): Promise<{ client: Client; outcome: 'existing' | 'linked' | 'created' }> {
    const { googleId, email, name, legacyUserId } = args;

    // a) Already linked to this Google account
    const byGoogle = await findClientByGoogleId(googleId);
    if (byGoogle) return { client: byGoogle, outcome: 'existing' };

    // b) Existing client with the same (Google-verified) email
    const byEmail = await findClientByEmail(email);
    if (byEmail) {
        if (byEmail.google_id && byEmail.google_id !== googleId) {
            throw new GoogleIdentityError(409,
                'This email is already linked to a different Google account. Please contact support.');
        }
        if (!byEmail.google_id) {
            const linked = await linkGoogleIdToClient(byEmail.id, googleId);
            if (!linked) {
                // Lost a race — re-read and make sure it was linked to THIS Google account
                const reread = await findClientByGoogleId(googleId);
                if (!reread || reread.id !== byEmail.id) {
                    throw new GoogleIdentityError(409,
                        'This email is already linked to a different Google account. Please contact support.');
                }
                return { client: reread, outcome: 'existing' };
            }
        }
        return { client: { ...byEmail, google_id: googleId }, outcome: 'linked' };
    }

    // c) Brand-new client — no coach until a verified invitation code is used
    try {
        const created = await createGoogleClientAccount({
            name, email, google_id: googleId, legacy_user_id: legacyUserId,
        });
        return { client: created, outcome: 'created' };
    } catch (err: any) {
        if (err?.code === 11000) {
            // Concurrent first sign-in created it already (clients.google_id unique index)
            const existing = await findClientByGoogleId(googleId);
            if (existing) return { client: existing, outcome: 'existing' };
        }
        throw err;
    }
}

router.post('/google', async (req: Request, res: Response) => {
    log('POST /auth/google', 'Google login attempt received');

    // signInAs is the Login screen toggle. It can only REJECT a mismatch.
    // It is never copied into the JWT. Omitted → previous automatic behaviour,
    // so older app builds keep working.
    const { idToken, signInAs: rawSignInAs } = req.body as { idToken?: string; signInAs?: unknown };
    const signInAs = readSignInAs(rawSignInAs);

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
        // ── Step 1: Verify Google ID token (signature, expiry, audience) ──────
        const oauthClient = new OAuth2Client(googleClientId);
        const ticket = await oauthClient.verifyIdToken({
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

        // ── Step 1b: Explicit issuer / audience / verified-email assertions ───
        // (defence in depth — performed BEFORE any account lookup or linking)
        if (!GOOGLE_ISSUERS.includes(payload.iss)) {
            log('POST /auth/google', '⚠️ Rejected: unexpected token issuer');
            res.status(401).json({ success: false, error: 'Invalid Google token' });
            return;
        }
        if (payload.aud !== googleClientId) {
            log('POST /auth/google', '⚠️ Rejected: audience mismatch');
            res.status(401).json({ success: false, error: 'Invalid Google token' });
            return;
        }
        if (payload.email_verified !== true) {
            log('POST /auth/google', '⚠️ Rejected: Google email not verified');
            res.status(401).json({
                success: false,
                error: 'Your Google email address is not verified. Please verify it with Google and try again.',
            });
            return;
        }

        const { sub: googleId, email, name = email, picture } = payload;
        const normalizedEmail = email.toLowerCase().trim();
        const masked = maskEmail(normalizedEmail);

        log('POST /auth/google', `Google token verified — email: ${masked}`);

        const secret = process.env.JWT_SECRET!;

        // ── Step 2: Coach resolution (googleId first, then verified email) ────
        let coachDoc: any = await findCoachByGoogleId(googleId);
        let matchedBy: 'googleId' | 'email' | null = coachDoc ? 'googleId' : null;
        if (!coachDoc) {
            coachDoc = await findCoachByEmail(normalizedEmail);
            if (coachDoc) matchedBy = 'email';
        }

        const coachRole = coachDoc ? (coachDoc.role ?? 'coach') : null; // no role field → legacy coach
        const isRealCoach = !!(coachDoc && coachRole !== 'client');

        // Client toggle + a real coach: do not issue a client token, do not
        // create a clients row, and do not link Google onto the coach.
        if (signInAs === 'client' && isRealCoach) {
            log('POST /auth/google', `Client toggle rejected for coach ${masked}`);
            rejectSignIn(res, CLIENT_SIGN_IN_ERROR);
            return;
        }

        // Coach toggle + not a coach: do not create a coach or a client.
        if (signInAs === 'coach' && !isRealCoach) {
            log('POST /auth/google', `Coach toggle rejected for ${masked}`);
            rejectSignIn(res, COACH_SIGN_IN_ERROR);
            return;
        }

        if (isRealCoach) {
            // ── Coach path (behaviour unchanged) ──────────────────────────────
            if (matchedBy === 'email') {
                if (coachDoc.googleId && coachDoc.googleId !== googleId) {
                    log('POST /auth/google', `⛔ Coach ${masked} already linked to a different Google account`);
                    res.status(409).json({
                        success: false,
                        error: 'This email is already linked to a different Google account. Please contact support.',
                    });
                    return;
                }
                // Account linking: same verified email registered with email/password.
                const coachId = coachDoc._id?.toString();
                await linkGoogleToCoach(coachId, googleId, picture);
                coachDoc = { ...coachDoc, googleId, picture, provider: 'google' as const };
                log('POST /auth/google', `✅ Linked Google ID to existing coach: ${masked}`);
            } else {
                log('POST /auth/google', `✅ Existing coach found via Google: ${masked}`);
            }

            const token = jwt.sign(
                {
                    sub:   coachDoc._id?.toString() || '',
                    email: coachDoc.email,
                    role:  coachRole,   // mobile reads role from JWT — NOT from frontend
                },
                secret,
                { expiresIn: JWT_EXPIRY }
            );

            log('POST /auth/google', `✅ JWT issued for ${masked} (role: ${coachRole})`);
            res.json({
                success: true,
                token,
                role:  coachRole,
                coach: toPublicCoach(coachDoc),
            });
            return;
        }

        // ── Step 3: Client path — canonical identity lives in 'clients' ───────
        // A legacy coaches document with role 'client' is NOT used for auth;
        // its _id is only recorded on a newly created client for traceability.
        const legacyUserId = coachDoc ? coachDoc._id?.toString() : undefined;

        const { client, outcome } = await resolveGoogleClient({
            googleId,
            email: normalizedEmail,
            name:  name || normalizedEmail,
            legacyUserId,
        });

        log('POST /auth/google', `✅ Client resolved (${outcome}) for ${masked} — has coach: ${!!client.coach_id}`);

        // sub = clients.id (UUID) — same contract as POST /auth/client-login
        const token = jwt.sign(
            {
                sub:   client.id,
                email: client.email,
                role:  'client',
            },
            secret,
            { expiresIn: JWT_EXPIRY }
        );

        log('POST /auth/google', `✅ JWT issued for ${masked} (role: client)`);

        res.json({
            success: true,
            token,
            role: 'client',
            client: {
                _id:       (client as any)._id?.toString() ?? '',
                id:        client.id,
                email:     client.email,
                name:      client.name,
                coach_id:  client.coach_id ?? null,
                has_coach: !!client.coach_id,
            },
        });

    } catch (error: any) {
        if (error instanceof GoogleIdentityError) {
            log('POST /auth/google', `⛔ Identity conflict (${error.statusCode})`);
            res.status(error.statusCode).json({ success: false, error: error.message });
            return;
        }
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
 * COACH LINKING (invitation-code only — no automatic assignment):
 *  - If an optional `inviteCode` is supplied, it is verified server-side and the
 *    new client is linked to that coach. An invalid code returns 400 and NO
 *    account is created.
 *  - If no code is supplied, the client is created WITHOUT a coach_id and is
 *    directed to the Connect-to-Coach flow (POST /api/auth/connect-coach).
 *  - A coach is never assigned arbitrarily (findSingleCoach is no longer used here).
 *
 * Flow:
 *  1. Validate name, email, password
 *  2. (optional) verify inviteCode → coachId
 *  3. Check for duplicate email
 *  4. bcrypt.hash(password)
 *  5. createClientAccount({ name, email, password_hash, coach_id? })
 *  6. Issue JWT with role: 'client'
 *  7. Return { success, token, client }
 *
 * Security:
 *  - Role is ALWAYS forced to 'client' — cannot be overridden
 *  - Duplicate email returns 409
 *  - A coach ID is never accepted from the request body
 */
router.post('/client-register', authLimiter, async (req: Request, res: Response) => {
    log('POST /auth/client-register', 'Self-registration attempt received');

    // Destructure only the fields we need. Any coach id sent by the client is ignored.
    const { name, email, password, inviteCode } = req.body as {
        name?:       string;
        email?:      string;
        password?:   string;
        inviteCode?: string;
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
        // ── Optional: verify invitation code server-side ──────────────────────
        let coachId: string | undefined;
        if (typeof inviteCode === 'string' && inviteCode.trim() !== '') {
            const sanitized = inviteCode.trim().toUpperCase();
            const coach = sanitized.length >= 4 && sanitized.length <= 16
                ? await findCoachByInviteCode(sanitized)
                : null;
            if (!coach) {
                res.status(400).json({
                    success: false,
                    error:   "That invite code doesn't match. Please check with your coach.",
                });
                return;
            }
            coachId = (coach as any)._id?.toString();
        }

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
            coach_id:      coachId,   // undefined → created without a coach
        });

        const clientDocId = (client as any)._id?.toString() ?? '';

        // ── Issue JWT ─────────────────────────────────────────────────────────────
        // sub = clients.id (UUID) — the same identifier used by client-login and
        // Google client sign-in. Client endpoints look the client up by this id.
        //
        // Older self-registration tokens put the Mongo _id in `sub` and the UUID
        // in a `clientId` claim. Those sessions keep working: clientAuthMiddleware
        // still prefers the `clientId` claim when it is present. New tokens do
        // not put a Mongo id in `sub`, so every login path agrees.
        const secret = process.env.JWT_SECRET!;
        const token = jwt.sign(
            {
                sub:   client.id,
                email: client.email,
                role:  'client',
            },
            secret,
            { expiresIn: JWT_EXPIRY },
        );

        log('POST /auth/client-register', `✅ Client registered: ${maskEmail(client.email)} — has coach: ${!!coachId}`);

        res.status(201).json({
            success: true,
            token,
            client: {
                _id:       clientDocId,
                id:        client.id,
                email:     client.email,
                name:      client.name,
                coach_id:  client.coach_id ?? null,
                has_coach: !!client.coach_id,
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
router.get('/invite-code', authMiddleware, requireRole('coach'), async (req: AuthenticatedRequest, res: Response) => {
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
 * Body: { email, password }
 * A real coach email is rejected with the same message as an unknown email
 * or a wrong password. This route never creates a client record.
 * Passwordless client accounts still get a specific setup message.
 * Rate-limited.
 */
router.post('/client-login', authLimiter, async (req: Request, res: Response) => {
    log('POST /auth/client-login', 'Client login attempt received');

    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
        res.status(400).json({ success: false, error: 'email and password are required' });
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
        const coachAccount = await findCoachByEmail(normalizedEmail);
        const coachRole = coachAccount ? ((coachAccount as any).role ?? 'coach') : null;
        const isRealCoach = !!coachAccount && coachRole !== 'client';

        // A coach email must not receive a client session, and we never create
        // a clients row here. Same message as an unknown email or a bad password.
        if (isRealCoach) {
            await bcrypt.compare(
                password,
                client?.password_hash || DUMMY_PASSWORD_HASH,
            );
            log('POST /auth/client-login', 'Client sign-in rejected');
            rejectSignIn(res, CLIENT_SIGN_IN_ERROR);
            return;
        }

        if (!client) {
            await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
            log('POST /auth/client-login', 'Client sign-in rejected');
            rejectSignIn(res, CLIENT_SIGN_IN_ERROR);
            return;
        }

        // SECURITY (2026-05-23): email-only login is disabled. Accounts with no
        // password still get a specific setup message so those people know what
        // to do. Unknown emails never reach this branch.
        if (!client.password_hash) {
            await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
            log('POST /auth/client-login', 'Passwordless client account blocked');
            res.status(401).json({
                success: false,
                error:   'This account requires password setup. Please re-register or contact your coach.',
            });
            return;
        }

        const valid = await bcrypt.compare(password, client.password_hash);
        if (!valid) {
            log('POST /auth/client-login', 'Client sign-in rejected');
            rejectSignIn(res, CLIENT_SIGN_IN_ERROR);
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
                _id:       mongoId,          // MongoDB ObjectId — kept for AuthUser.id in mobile
                id:        client.id,        // UUID — the canonical identifier
                email:     client.email,
                name:      client.name,
                coach_id:  client.coach_id ?? null,
                has_coach: !!client.coach_id,
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
    // Identity comes ONLY from the verified client JWT — never from the request body.
    const clientId = req.clientAuth!.clientId;
    log('POST /auth/connect-coach', `Client ${clientId} attempting to connect to coach`);

    // Only the invite code is read from the body. Any coachId/clientId field is ignored.
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
        // ── Look up the coach by invite code (server-side verification) ───────
        const coach = await findCoachByInviteCode(sanitizedCode);

        if (!coach) {
            // Return 400, not 404 — avoids confirming whether a code exists at all.
            // The code itself is not logged.
            log('POST /auth/connect-coach', `⚠️ Invalid invite code submitted by client ${clientId}`);
            res.status(400).json({
                success: false,
                error:   "That invite code doesn't match. Please check with your coach.",
            });
            return;
        }

        const coachId = (coach as any)._id?.toString() as string;

        // ── Link client to coach (atomic; never overwrites another coach) ─────
        const outcome = await linkClientToCoach(clientId, coachId);

        if (outcome === 'not_found') {
            log('POST /auth/connect-coach', `❌ Client ${clientId} not found during linkage`);
            res.status(404).json({
                success: false,
                error:   'Client account not found. Please sign out and sign in again.',
            });
            return;
        }

        if (outcome === 'conflict') {
            log('POST /auth/connect-coach', `⛔ Client ${clientId} is already linked to a different coach — not overwritten`);
            res.status(409).json({
                success: false,
                error:   'You are already connected to another coach. Please contact your coach if you need to switch programmes.',
            });
            return;
        }

        log('POST /auth/connect-coach', `✅ Client ${clientId} ${outcome === 'linked' ? 'linked to' : 'already linked to'} coach ${coachId}`);

        res.json({
            success:         true,
            alreadyConnected: outcome === 'already_linked',
            message:         outcome === 'already_linked'
                ? `You are already connected to ${coach.name}.`
                : `You are now connected to ${coach.name}. Welcome to the program!`,
            coachName:       coach.name,
        });
    } catch (error: any) {
        logError('POST /auth/connect-coach', error);
        res.status(500).json({ success: false, error: 'Failed to connect to coach. Please try again.' });
    }
});

export default router;
