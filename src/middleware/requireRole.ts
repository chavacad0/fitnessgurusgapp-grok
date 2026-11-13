import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './authMiddleware';

/**
 * Role door for a route that already passed authMiddleware.
 *
 * authMiddleware rejects a token with no role. This check is the sign on the
 * door: a client token cannot call a coach route, and the other way around.
 * It does not look up who owns a record. Ownership stays in the route.
 */
export function requireRole(role: 'coach' | 'client') {
    return function requireRoleMiddleware(
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): void {
        const actual = req.coach?.role;
        if (actual !== 'coach' && actual !== 'client') {
            res.status(401).json({
                success: false,
                error: 'Your session has expired. Please log in again.',
            });
            return;
        }
        if (actual !== role) {
            res.status(403).json({ success: false, error: 'Access denied.' });
            return;
        }
        next();
    };
}
