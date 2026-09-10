import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { getDb } from './db/mongo';
import routes from './api/routes';
import authRoutes from './api/authRoutes';
import uploadRoutes from './api/uploadRoutes';
import whatsappRoutes from './api/whatsappRoutes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

/**
 * CORS Configuration
 *
 * Why open CORS is dangerous in production:
 *  - `cors()` with no options allows ANY origin to make credentialed requests.
 *  - A malicious website could call your API on behalf of a logged-in coach
 *    (CSRF-style attack using the coach's stored JWT if sent via cookies,
 *    or via XSS-harvested Bearer tokens).
 *  - Explicit origin allowlisting is a defence-in-depth measure. The mobile
 *    app uses Expo DevTools on localhost:8081 in development. In production,
 *    set CORS_ORIGIN env var to the deployed frontend URL.
 *
 * CORS_ORIGIN env var: comma-separated list of allowed origins.
 * Default: localhost:8081 (Expo dev server) only.
 */
const allowedOrigins: string[] = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
    : ['http://localhost:8081'];

app.use(cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

// Serve uploaded photos as public static files
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Routes
app.use('/api', routes);
app.use('/api/auth', authRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// Global error handling middleware (catches unhandled errors from routes)
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('❌ Unhandled error:', err);
    res.status(500).json({
        success: false,
        error: err.message || 'Internal server error'
    });
});

// Start server
async function startServer() {
    // ── Fail-fast: environment validation ─────────────────────────────────────
    const JWT_SECRET      = process.env.JWT_SECRET;
    const MONGO_URI       = process.env.MONGO_URI;
    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

    if (!JWT_SECRET) {
        console.error('❌ FATAL: JWT_SECRET is not set. Add it to .env before starting.');
        process.exit(1);
    }
    if (JWT_SECRET.length < 32) {
        console.error(
            `❌ FATAL: JWT_SECRET too short (${JWT_SECRET.length} chars). ` +
            'Min 32 chars required. Generate: openssl rand -hex 32'
        );
        process.exit(1);
    }
    if (!MONGO_URI) {
        console.error('❌ FATAL: MONGO_URI is not set. Add it to .env before starting.');
        process.exit(1);
    }

    // Non-fatal: warn at startup so you know immediately if Google login will fail
    if (!GOOGLE_CLIENT_ID) {
        console.warn('⚠️  GOOGLE_CLIENT_ID is not set — POST /api/auth/google will return 500.');
        console.warn('   Add GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com to .env and restart.');
    } else {
        console.log(`✅ GOOGLE_CLIENT_ID loaded (${GOOGLE_CLIENT_ID.slice(0, 20)}...)`);
    }

    // Non-fatal: warn if ADMIN_SECRET is missing — coach registration will return 503
    if (!process.env.ADMIN_SECRET) {
        console.warn('⚠️  ADMIN_SECRET not set — POST /api/auth/register is disabled (503).');
        console.warn('   Add ADMIN_SECRET=<value> to .env to enable coach account creation.');
    } else {
        console.log('✅ ADMIN_SECRET loaded');
    }

    // Non-fatal: warn if WhatsApp is not configured
    const WA_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
    const WA_PID   = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!WA_TOKEN || !WA_PID) {
        console.warn('⚠️  WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID not set — POST /api/whatsapp/send-message will return 500.');
        console.warn('   Add both to .env to enable WhatsApp messaging.');
    } else {
        console.log('✅ WhatsApp Cloud API configured');
    }

    console.log('✅ Environment validated');
    // ──────────────────────────────────────────────────────────────────────────

    try {
        await getDb(); // Connects and creates indexes
        console.log('');
        console.log('📋 Available endpoints:');
        console.log(`   GET  http://localhost:${PORT}/api/health`);
        console.log(`   GET  http://localhost:${PORT}/api/clients                                  [AUTH]`);
        console.log(`   GET  http://localhost:${PORT}/api/clients/status                           [AUTH]`);
        console.log(`   POST http://localhost:${PORT}/api/clients/:clientId/plan                   [AUTH]`);
        console.log(`   GET  http://localhost:${PORT}/api/clients/:clientId/plan                   [AUTH]`);
        console.log(`   GET  http://localhost:${PORT}/api/clients/:clientId/session-status         [AUTH]`);
        console.log(`   POST http://localhost:${PORT}/api/clients/:clientId/complete-session       [AUTH]`);
        console.log(`   POST http://localhost:${PORT}/api/clients/:clientId/checkins               [AUTH]`);
        console.log(`   GET  http://localhost:${PORT}/api/clients/:clientId/checkins               [AUTH]`);
        console.log(`   GET  http://localhost:${PORT}/api/clients/:clientId/redflags               [AUTH]`);
        console.log(`   POST http://localhost:${PORT}/api/clients/:clientId/redflags/detect        [AUTH]`);
        console.log(`   GET  http://localhost:${PORT}/api/coach/dashboard                          [AUTH]`);
        console.log(`   GET  http://localhost:${PORT}/api/coach/availability                       [AUTH]`);
        console.log(`   POST http://localhost:${PORT}/api/coach/availability                       [AUTH]`);
        console.log(`   POST http://localhost:${PORT}/api/bookings                                 [AUTH]`);
        console.log(`   PATCH http://localhost:${PORT}/api/bookings/:bookingId/complete             [AUTH]`);
        console.log(`   PATCH http://localhost:${PORT}/api/bookings/:bookingId/cancel               [AUTH]`);
        console.log(`   POST http://localhost:${PORT}/api/auth/register`);
        console.log(`   POST http://localhost:${PORT}/api/auth/login`);
        console.log(`   POST http://localhost:${PORT}/api/auth/client-login`);          // ← NEW
        console.log(`   POST http://localhost:${PORT}/api/auth/connect-coach              [CLIENT AUTH]`); // ← connects client to coach via invite code
        console.log(`   POST http://localhost:${PORT}/api/whatsapp/send-message          [AUTH]`);
        console.log(`   POST http://localhost:${PORT}/api/auth/google`);
        console.log(`   GET  http://localhost:${PORT}/api/auth/me                                  [AUTH]`);
        console.log('');

        app.listen(PORT, () => {
            console.log(`✅ Server running on http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
