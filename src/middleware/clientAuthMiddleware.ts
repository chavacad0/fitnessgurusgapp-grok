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
