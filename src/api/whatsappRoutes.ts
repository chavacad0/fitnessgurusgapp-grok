/**
 * whatsappRoutes.ts — WhatsApp messaging routes
 *
 * Mounted at: /api/whatsapp
 *
 * Routes:
 *   POST /api/whatsapp/send-message   [AUTH] — send a WhatsApp text message
 *
 * Authentication:
 *   All routes require a valid coach JWT (Authorization: Bearer <token>).
 *   This prevents anyone on the internet from using your server as a
 *   free WhatsApp spam relay.
 *
 * Rate limiting:
 *   Inherits the global express-rate-limit on the server if configured.
 *   Meta itself also enforces per-WABA rate limits.
 */

import { Router, Response, NextFunction } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/requireRole';
import { sendWhatsAppMessage }       from '../services/whatsappService';

const router = Router();

// Coach only, then switched off unless WHATSAPP_ENABLED is exactly true or 1.
// Unset, empty, and "false" all keep sending disabled. No client phone numbers
// are stored or required.
router.use(authMiddleware);
router.use(requireRole('coach'));
router.use((_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const flag = (process.env.WHATSAPP_ENABLED ?? '').trim().toLowerCase();
    if (flag !== 'true' && flag !== '1') {
        res.status(503).json({
            success: false,
            error: 'WhatsApp is not available yet.',
        });
        return;
    }
    next();
});

// ─── Logging helpers ──────────────────────────────────────────────────────────

function log(route: string, message: string, data?: any) {
    const ts = new Date().toISOString();
    console.log(`[${ts}] [${route}] ${message}`, data ?? '');
}

function logError(route: string, error: any) {
    const ts = new Date().toISOString();
    console.error(`[${ts}] [${route}] ❌ ERROR:`, error?.message ?? error);
}

// ─── POST /api/whatsapp/send-message ─────────────────────────────────────────

/**
 * Send a WhatsApp text message to any recipient.
 *
 * Body: { to: string, message: string }
 *   - to:      E.164 phone number, e.g. "+6591234567"
 *   - message: Text content (1–4096 chars)
 *
 * Returns:
 *   200 { success: true, messageId }         — sent successfully
 *   400 { success: false, error }            — invalid input
 *   500 { success: false, error }            — backend / Meta API failure
 *
 * Common use cases in FitnessGuruSG:
 *   - Renewal reminders   → remind a client their plan expires soon
 *   - Check-in prompts    → nudge a client who hasn't logged today
 *   - Session confirmations → confirm a booking or reschedule
 */
router.post('/send-message', async (req: AuthenticatedRequest, res: Response) => {
    const coachId = req.coach!.sub;

    // ── Input extraction ─────────────────────────────────────────────────────
    const { to, message } = req.body as { to?: string; message?: string };

    log('POST /whatsapp/send-message', `Coach ${coachId} sending WhatsApp to: ${to}`);

    if (!to || !message) {
        res.status(400).json({
            success: false,
            error:   'Both "to" (E.164 phone number) and "message" (text) are required.',
        });
        return;
    }

    // ── Delegate to service ──────────────────────────────────────────────────
    try {
        const result = await sendWhatsAppMessage({ to, message });

        if (!result.success) {
            // Service returned a clean error (validation or Meta API rejection)
            log('POST /whatsapp/send-message', `⚠️ Message not sent: ${result.error}`);
            res.status(400).json({ success: false, error: result.error });
            return;
        }

        log('POST /whatsapp/send-message', `✅ Message delivered — Meta ID: ${result.messageId}`);
        res.json({
            success:   true,
            messageId: result.messageId,
            to,
        });

    } catch (error: any) {
        // Unexpected errors (misconfigured env vars, network outage, etc.)
        logError('POST /whatsapp/send-message', error);
        res.status(500).json({
            success: false,
            error:   error.message ?? 'Failed to send WhatsApp message.',
        });
    }
});

export default router;
