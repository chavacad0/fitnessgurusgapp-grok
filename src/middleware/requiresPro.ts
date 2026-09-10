/**
 * requiresPro — DEPRECATED / NO-OP
 *
 * This middleware is no longer used. The app is not a subscription SaaS.
 * All routes are accessible to any authenticated coach.
 *
 * Kept as an empty export to avoid breaking any import that may still
 * reference it during cleanup, but it is not mounted on any route.
 *
 * TODO: Remove this file after verifying no imports remain.
 */

import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './authMiddleware';

/** @deprecated No-op. Do not use. */
export async function requiresPro(
    _req: AuthenticatedRequest,
    _res: Response,
    next: NextFunction
): Promise<void> {
    next();
}
