import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

/**
 * Auth middleware — validates Bearer JWT tokens.
 * Attaches decoded payload to req.coach on success.
 * Returns 401 on missing or invalid token.
 *
 * req.coach fields:
 *   sub      — MongoDB _id of the authenticated user (coaches and clients)
 *   email    — user email
 *   role     — 'coach' | 'client'
 *   clientId — UUID from the clients collection (clients only).
 *              Populated from the clientId JWT claim issued at client-login.
 *              Undefined for coach tokens.
 *
 * WHY clientId is separate from sub:
 *   Client JWTs have sub = MongoDB _id AND clientId = UUID (clients.id field).
 *   Routes that validate ownership query { id: clientId, coach_id: ... } — they
 *   use the UUID, not the ObjectId. Without forwarding clientId here, routes are
 *   forced to compare sub (ObjectId) against a UUID, which never matches.
 */

export interface AuthenticatedRequest extends Request {
    coach?: {
        sub:       string;   // MongoDB _id of the authenticated user
        email:     string;
        role:      string;   // 'coach' | 'client'
        clientId?: string;   // UUID from clients.id — clients only, undefined for coaches
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
