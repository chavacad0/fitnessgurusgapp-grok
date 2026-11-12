import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { isLegacyCoachDocClientToken } from './clientAuthMiddleware';

/**
 * Auth middleware — validates Bearer JWT tokens.
 * Attaches decoded payload to req.coach on success.
 * Returns 401 on missing or invalid token.
 *
 * req.coach fields:
 *   sub      — coaches._id for coach tokens.
 *              clients.id (UUID) for client tokens issued by current login,
 *              Google sign-in, and self-registration.
 *              Older self-registration tokens still carry the Mongo _id here.
 *   email    — user email
 *   role     — 'coach' | 'client'
 *   clientId — UUID from the clients collection, copied from the clientId JWT
 *              claim. Present on older client self-registration tokens.
 *              Undefined for coach tokens and for current client tokens
 *              (those put the UUID in `sub` instead).
 *
 * WHY clientId is forwarded separately from sub:
 *   Older client JWTs have sub = MongoDB _id AND clientId = UUID (clients.id).
 *   Routes that validate ownership must accept either, or those sessions 403
 *   on their own data. Current tokens put the UUID in sub and omit the claim.
 */

export interface AuthenticatedRequest extends Request {
    coach?: {
        sub:       string;   // coach: coaches._id. client: clients.id UUID (older client tokens: Mongo _id)
        email:     string;
        role:      string;   // 'coach' | 'client'
        clientId?: string;   // UUID from clients.id — older client tokens only, undefined for coaches
    };
}

export function authMiddleware(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): void {
    const authHeader = req.headers.authorization;

    // Expect: "Authorization: Bearer <token>"
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({
            success: false,
            error: 'No token provided. Include Authorization: Bearer <token> header.'
        });
        return;
    }

    const token  = authHeader.split(' ')[1];
    const secret = process.env.JWT_SECRET;

    if (!secret) {
        console.error('❌ JWT_SECRET is not set in environment variables');
        res.status(500).json({
            success: false,
            error: 'Server configuration error'
        });
        return;
    }

    try {
        const decoded = jwt.verify(token, secret) as {
            sub:       string;
            email:     string;
            role?:     string;
            clientId?: string;   // present on client tokens — UUID from clients.id
        };

        // Never treat a coaches-collection _id as a client identity (pre-fix Google
        // client tokens). See isLegacyCoachDocClientToken for details.
        if (isLegacyCoachDocClientToken(decoded)) {
            res.status(401).json({
                success: false,
                error: 'Your session has expired. Please log in again.'
            });
            return;
        }

        req.coach = {
            sub:      decoded.sub,
            email:    decoded.email,
            role:     decoded.role ?? 'coach',  // default 'coach' for pre-role tokens
            clientId: decoded.clientId,         // undefined for coaches, UUID for clients
        };
        next();
    } catch (err: any) {
        const message = err.name === 'TokenExpiredError'
            ? 'Token expired. Please log in again.'
            : 'Invalid token.';

        res.status(401).json({
            success: false,
            error: message
        });
    }
}
