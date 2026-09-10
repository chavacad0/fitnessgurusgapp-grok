import { getDb } from '../db/mongo';
import { getClientsWithoutCheckIn } from '../repositories/mongoClientRepo';

/**
 * DailyReminderService — scans all active clients and queues reminder notifications
 * for those who haven't submitted a check-in today.
 *
 * Status: STUB — notification delivery is logged only.
 * No actual push/WhatsApp/in-app message is sent yet.
 * Full implementation planned for Phase 10 (WhatsApp integration).
 *
 * The service iterates per-coach to satisfy getClientsWithoutCheckIn(today, coachId)
 * which is scoped by coach for data isolation.
 */
export class DailyReminderService {

    async sendReminders(): Promise<{ success: boolean; count: number }> {
        const today = new Date().toLocaleDateString('en-CA', {
            timeZone: 'Asia/Singapore',
        });

        const db = await getDb();

        // Fetch all distinct coach IDs from the coaches collection
        // so we can iterate per-coach (required by getClientsWithoutCheckIn signature)
        const coaches = await db.collection('coaches')
            .find({}, { projection: { _id: 1 } })
            .toArray();

        let totalNotifications = 0;

        for (const coach of coaches) {
            try {
                const coachId = coach._id.toString();

                // getClientsWithoutCheckIn requires (today, coachId) — both args provided
                const clients = await getClientsWithoutCheckIn(today, coachId);

                for (const client of clients) {
                    // Get coach's automated message rules for this client
                    const rules = await db.collection('automated_message_rules')
                        .find({
                            coach_id: client.coach_id,
                            trigger_type: 'daily_reminder',
                            is_active: true,
                        })
                        .toArray();

                    if (rules.length === 0) continue;

                    const rule = rules[0] as any;
                    const userName = client.name || client.email;
                    const message = rule.message_template.replace('{name}', userName);

                    // TODO (Phase 10): Send via WhatsApp using notificationQueue
                    if (rule.send_via === 'whatsapp' || rule.send_via === 'both') {
                        console.log(`📱 WhatsApp reminder queued for ${client.email}`);
                    }

                    // Stub: log in-app notifications (system not yet implemented)
                    if (rule.send_via === 'in_app' || rule.send_via === 'both') {
                        console.log(`📩 [STUB] In-app reminder for ${userName}: ${message}`);
                        totalNotifications++;
                    }
                }
            } catch (err: any) {
                // Log per-coach errors without stopping other coaches' reminders
                console.error(`❌ DailyReminderService: failed for coach ${coach._id}:`, err.message);
            }
        }

        if (totalNotifications > 0) {
            console.log(`📩 Would deliver ${totalNotifications} reminder(s) (notification system not yet implemented)`);
        }

        return { success: true, count: totalNotifications };
    }
}

export const dailyReminderService = new DailyReminderService();


