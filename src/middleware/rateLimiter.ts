import rateLimit from 'express-rate-limit';

/**
 * Auth route rate limiter — brute force protection for /api/auth/login.
 *
 * Limits: 10 attempts per IP per 15-minute window.
 * Rationale: A legitimate coach will never hit 10 login attempts in 15 min.
 * After lockout the error message tells them to wait — they can always call support.
 *
 * No Redis needed: express-rate-limit uses in-memory store by default,
 * which is correct for a single-instance MVP server.
 *
 * Usage in authRoutes.ts:
 *   import { authLimiter } from '../middleware/rateLimiter';
 *   router.post('/login', authLimiter, handler);
 */
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 10,                     // max 10 requests per window per IP
    standardHeaders: true,       // Return rate limit info in RateLimit-* headers
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test', // Never rate-limit in test runs
    message: {
        success: false,
        error: 'Too many login attempts from this IP. Please try again in 15 minutes.',
    },
});
