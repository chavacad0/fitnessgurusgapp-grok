import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

/**
 * Client Auth Middleware — protects routes that require a valid CLIENT JWT.
 *
 * Verifies:
 *  1. Authorization header present and Bearer format
 *  2. JWT is valid (correct secret, not expired)
 *  3. JWT payload has role: 'client'
 *
 * Attaches req.clientAuth = { sub, email, clientId } for downstream use.
 *
 * JWT structure (post-2026-04-24 fix):
 *   sub      = UUID (client.id) — this IS the clientId used in all API routes
 *   email    = client email
 *   role     = 'client'
 *   clientId claim was REMOVED — sub is now the single source of truth
 *
 * WHY a separate middleware from authMiddleware?
 *  - authMiddleware accepts any role (coach or client)
 *  - clientAuthMiddleware enforces role: 'client' strictly
 *  - A coach JWT cannot call client-only routes and vice versa.
 */

export interface ClientAuthPayload {
    sub:      string;   // UUID (client.id) — used in all /api/clients/:id/* calls
    email:    string;
    role:     'client';
    clientId: string;   // same as sub — populated from sub for backward compatibility
}

// Extend Express Request to carry the client auth payload
declare global {
    namespace Express {
        interface Request {
            clientAuth?: ClientAuthPayload;
        }
    }
}

/**
 * True for a client-role JWT whose only identity is a 24-hex MongoDB ObjectId in
 * `sub` with no `clientId` claim. Only pre-fix POST /auth/google issued these, with
 * sub = coaches._id. That is NOT a clients.id, so such tokens are rejected (401)
 * instead of being treated as a client identity.
 *
 * Unaffected tokens:
 *   client-login     → sub = clients.id (UUID, contains dashes)
 *   client-register  → sub = clients._id BUT clientId claim = clients.id
 *   coach tokens     → role !== 'client'
 */
export function isLegacyCoachDocClientToken(payload: {
    sub?: string; role?: string; clientId?: string;
}): boolean {
    return payload.role === 'client'
        && !payload.clientId
        && typeof payload.sub === 'string'
        && /^[a-f0-9]{24}$/i.test(payload.sub);
}

export function clientAuthMiddleware(
    req:  Request,
    res:  Response,
    next: NextFunction,
): void {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ success: false, error: 'Missing or invalid Authorization header' });
        return;
    }

    const token = authHeader.split(' ')[1];

    try {
        const secret  = process.env.JWT_SECRET!;
        const payload = jwt.verify(token, secret) as {
            sub:       string;
            email:     string;
            role?:     string;
            clientId?: string;   // present in old tokens (pre-2026-04-24), absent in new
        };

        if (payload.role !== 'client') {
            res.status(403).json({
                success: false,
                error:   'Access denied: client credentials required',
            });
            return;
        }

        // clientId resolution:
        //   New tokens (post-2026-04-24): sub = UUID, clientId claim absent → use sub
        //   Old tokens (pre-fix, still in circulation): sub = MongoDB _id, clientId = UUID → use clientId
        //
        // REJECTED: legacy Google client tokens (pre-2026-11 fix) carry sub = coaches._id
        // (a 24-hex ObjectId) and NO clientId claim. That ID is a coach-collection document,
        // not a client identity, so we never fall back to it — the user must sign in again,
        // which now issues sub = clients.id.
        if (isLegacyCoachDocClientToken(payload)) {
            res.status(401).json({
                success: false,
                error:   'Your session has expired. Please log in again.',
            });
            return;
        }
        const resolvedClientId = payload.clientId ?? payload.sub;

        req.clientAuth = {
            sub:      payload.sub,
            email:    payload.email,
            role:     'client',
            clientId: resolvedClientId,
        };
        next();
    } catch (error: any) {
        if (error.name === 'TokenExpiredError') {
            res.status(401).json({ success: false, error: 'Your session has expired. Please log in again.' });
        } else {
            res.status(401).json({ success: false, error: 'Invalid token' });
        }
    }
}
