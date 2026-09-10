/**
 * whatsappService.ts — WhatsApp Cloud API integration
 *
 * Sends WhatsApp messages via Meta's Cloud API (v19.0).
 *
 * Environment variables required:
 *   WHATSAPP_ACCESS_TOKEN   — your permanent or temporary access token from Meta
 *   WHATSAPP_PHONE_NUMBER_ID — the Phone Number ID from your Meta App dashboard
 *
 * WHY backend only (never frontend):
 *   Your ACCESS_TOKEN is a long-lived credential. If it leaks, anyone can send
 *   WhatsApp messages from your number and exhaust your API quota or be used for
 *   spam. A React Native app bundle is trivially decompiled. Only the backend
 *   (which the user never sees the source of) should hold this token.
 *
 * API reference: https://developers.facebook.com/docs/whatsapp/cloud-api/messages
 */

const WHATSAPP_API_VERSION = 'v19.0';
const META_GRAPH_BASE      = 'https://graph.facebook.com';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SendMessagePayload {
    /** Recipient phone number in E.164 format, e.g. "+6591234567" */
    to: string;
    /** Plain text message body (max 4096 chars) */
    message: string;
}

export interface SendMessageResult {
    success: boolean;
    messageId?: string;   // WhatsApp message ID returned by Meta (for delivery tracking)
    error?: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Sends a free-form text message via WhatsApp Cloud API.
 *
 * The message is sent as a "text" type message object.
 * The recipient must have WhatsApp and have messaged your number first
 * (or be within a 24-hour window), OR you must use a pre-approved template
 * for out-of-window messages.
 *
 * @throws Error if required environment variables are missing
 */
export async function sendWhatsAppMessage(payload: SendMessagePayload): Promise<SendMessageResult> {
    const timestamp = new Date().toISOString();

    // ── Environment validation ─────────────────────────────────────────────────
    const ACCESS_TOKEN    = process.env.WHATSAPP_ACCESS_TOKEN;
    const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!ACCESS_TOKEN) {
        console.error(`[${timestamp}] [whatsappService] ❌ WHATSAPP_ACCESS_TOKEN is not set in .env`);
        throw new Error('WhatsApp integration is not configured on this server.');
    }
    if (!PHONE_NUMBER_ID) {
        console.error(`[${timestamp}] [whatsappService] ❌ WHATSAPP_PHONE_NUMBER_ID is not set in .env`);
        throw new Error('WhatsApp integration is not configured on this server.');
    }

    // ── Input validation ──────────────────────────────────────────────────────
    const { to, message } = payload;

    // Normalise number: remove spaces, dashes. E.164 format requires "+" prefix.
    const normalisedTo = to.replace(/[\s\-]/g, '');
    if (!/^\+\d{7,15}$/.test(normalisedTo)) {
        console.warn(`[${timestamp}] [whatsappService] ⚠️  Invalid phone number format: ${to}`);
        return { success: false, error: 'Invalid phone number. Use E.164 format, e.g. +6591234567' };
    }
    if (!message || message.trim().length === 0) {
        return { success: false, error: 'Message body cannot be empty.' };
    }
    if (message.length > 4096) {
        return { success: false, error: 'Message exceeds WhatsApp 4096 character limit.' };
    }

    // ── API request ───────────────────────────────────────────────────────────
    const url = `${META_GRAPH_BASE}/${WHATSAPP_API_VERSION}/${PHONE_NUMBER_ID}/messages`;

    const requestBody = {
        messaging_product: 'whatsapp',
        recipient_type:    'individual',
        to:                normalisedTo,
        type:              'text',
        text: {
            preview_url: false,
            body:        message.trim(),
        },
    };

    console.log(`[${timestamp}] [whatsappService] 📤 Sending message to ${normalisedTo} (${message.length} chars)`);

    try {
        const response = await fetch(url, {
            method:  'POST',
            headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type':  'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        const data = await response.json() as any;

        if (!response.ok) {
            // Meta error shape: { error: { message, type, code, fbtrace_id } }
            const metaError = data?.error?.message ?? `HTTP ${response.status}`;
            const metaCode  = data?.error?.code ?? response.status;
            console.error(`[${timestamp}] [whatsappService] ❌ Meta API error (code ${metaCode}):`, metaError);
            return { success: false, error: metaError };
        }

        // Success shape: { messaging_product: 'whatsapp', contacts: [...], messages: [{ id }] }
        const messageId = data?.messages?.[0]?.id ?? 'unknown';
        console.log(`[${timestamp}] [whatsappService] ✅ Message sent — Meta ID: ${messageId}`);

        return { success: true, messageId };

    } catch (err: any) {
        // Network failure (DNS, timeout, etc.)
        console.error(`[${timestamp}] [whatsappService] ❌ Network error:`, err.message);
        return { success: false, error: 'Network error reaching WhatsApp API. Check your server connectivity.' };
    }
}
