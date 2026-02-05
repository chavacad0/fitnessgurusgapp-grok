// Supabase Edge Function: Daily Check-In Reminders
// Deploy: supabase functions deploy daily-reminders
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

    // Find active clients without check-in today
    // Access logic: subscription_status = 'Active' AND (paid_until >= today OR access_override = true)
    const { data: clientsWithoutCheckIn, error: clientError } = await supabase
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
          whatsapp_number,
          automated_message_rules (
            trigger_type,
            message_template,
            send_via,
            is_active
          )
        )
      `)
      .eq('subscription_status', 'Active')
      .not('check_ins', 'cs', JSON.stringify([{ date: today }]));

    if (clientError) throw clientError;

    const notifications = [];
    const whatsappMessages = [];

    for (const client of clientsWithoutCheckIn) {
      // Additional access check: paid_until or access_override
      const hasAccess = client.access_override ||
        (client.paid_until && new Date(client.paid_until) >= new Date(today));

      if (!hasAccess) continue; // Skip if no access

      // Find daily reminder rule for this coach
      const rule = client.coaches.automated_message_rules?.find(
        (r: { trigger_type: string; is_active: boolean; message_template: string; send_via: string }) =>
          r.trigger_type === 'daily_reminder' && r.is_active
      );

      if (!rule) continue;

      const userName = client.name || client.email;
      const message = rule.message_template.replace('{name}', userName);

      // Send in-app notification
      if (rule.send_via === 'in_app' || rule.send_via === 'both') {
        notifications.push({
          user_id: client.id,
          title: 'Check-In Reminder',
          body: message,
          notification_type: 'check_in_reminder'
        });
      }

      // Queue WhatsApp message
      if (rule.send_via === 'whatsapp' || rule.send_via === 'both') {
        whatsappMessages.push({
          client_id: client.id,
          phone: client.coaches.whatsapp_number,
          message: message
        });
      }
    }

    // Batch insert notifications
    if (notifications.length > 0) {
      await supabase.from('notifications').insert(notifications);
    }

    // Send WhatsApp messages (implement via your provider)
    // for (const msg of whatsappMessages) {
    //   await sendWhatsAppMessage(msg.phone, msg.message);
    // }

    return new Response(
      JSON.stringify({
        success: true,
        notificationsSent: notifications.length,
        whatsappQueued: whatsappMessages.length
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
