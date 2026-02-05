import { getDb } from '../db/mongo';
import { getClientsWithoutCheckIn } from '../repositories/mongoClientRepo';
import { notificationRepo } from '../repositories/notificationRepo';

export class DailyReminderService {
    /**
     * Send daily check-in reminders to clients who haven't checked in today
     */
    async sendReminders(): Promise<{ success: boolean; count: number }> {
        const today = new Date().toLocaleDateString('en-CA', {
            timeZone: 'Asia/Singapore'
        });

        // Get clients without check-in today
        const clients = await getClientsWithoutCheckIn(today);

        const notifications = [];
        const db = await getDb();

        for (const client of clients) {
            // Get coach's automated message rules
            const rules = await db.collection('automated_message_rules')
                .find({
                    coach_id: client.coach_id,
                    trigger_type: 'daily_reminder',
                    is_active: true
                })
                .toArray();

            if (rules.length === 0) continue;

            const rule = rules[0] as any;
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

            // TODO: Handle WhatsApp messages if needed
            if (rule.send_via === 'whatsapp' || rule.send_via === 'both') {
                console.log(`📱 WhatsApp reminder queued for ${client.email}`);
            }
        }

        // Batch insert notifications
        if (notifications.length > 0) {
            notificationRepo.createBatch(notifications);
        }

        return {
            success: true,
            count: notifications.length
        };
    }
}

export const dailyReminderService = new DailyReminderService();
