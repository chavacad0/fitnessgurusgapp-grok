// Supabase Edge Function: Red Flag Detector
// Deploy: supabase functions deploy red-flag-detector
/// <reference lib="deno.ns" />

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?target=deno';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req: Request) => {
    try {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Get current date in Singapore timezone
        const today = new Date().toLocaleDateString('en-CA', {
            timeZone: 'Asia/Singapore'
        });

        // Get all active clients with access
        // Access logic: subscription_status = 'Active' AND (paid_until >= today OR access_override = true)
        const { data: clients, error: clientError } = await supabase
            .from('clients')
            .select(`
        id,
        name,
        email,
        coach_id,
        subscription_status,
        paid_until,
        access_override,
        coaches:coach_id (
          id,
          whatsapp_number
        )
      `)
            .eq('subscription_status', 'Active');

        if (clientError) throw clientError;

        const notifications = [];
        const redFlagsDetected = [];

        for (const client of clients) {
            // Additional access check: paid_until or access_override
            const hasAccess = client.access_override ||
                (client.paid_until && new Date(client.paid_until) >= new Date(today));

            if (!hasAccess) continue; // Skip if no access

            // Call red flag detection function
            const { data: flags, error: flagError } = await supabase
                .rpc('detect_red_flags', { client_uuid: client.id });

            if (flagError || !flags || flags.length === 0) continue;

            const userName = client.name || client.email;

            for (const flag of flags) {
                // Create notification for coach (coaches.id references auth.users(id))
                notifications.push({
                    user_id: client.coaches.id,
                    title: `⚠️ Red Flag: ${userName}`,
                    body: flag.message,
                    notification_type: 'red_flag',
                    reference_id: client.id
                });

                redFlagsDetected.push({
                    client_id: client.id,
                    client_name: userName,
                    flag_type: flag.type,
                    severity: flag.severity,
                    message: flag.message
                });
            }
        }

        // Insert notifications
        if (notifications.length > 0) {
            await supabase.from('notifications').insert(notifications);
        }

        return new Response(
            JSON.stringify({
                success: true,
                redFlagsDetected: redFlagsDetected.length,
                details: redFlagsDetected
            }),
            { headers: { 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
});
