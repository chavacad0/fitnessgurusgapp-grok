import db from '../../local-db/init';
import { clientRepo } from './clientRepo';
import { notificationRepo } from './notificationRepo';

export class RedFlagDetectorService {
    /**
     * Detect red flags for all active clients
     */
    async detectRedFlags(): Promise<{ success: boolean; flagsDetected: number }> {
        const activeClients = clientRepo.findActiveClients();

        const notifications = [];
        let totalFlags = 0;

        for (const client of activeClients) {
            const flags = this.detectClientRedFlags(client.id);
            if (flags.length === 0) continue;

            totalFlags += flags.length;
            const userName = client.name || client.email;

            for (const flag of flags) {
                notifications.push({
                    user_id: client.coach_id,
                    title: `⚠️ Red Flag: ${userName}`,
                    body: flag.message,
                    notification_type: 'red_flag',
                    reference_id: client.id
                });
            }
        }

        // Batch insert notifications
        if (notifications.length > 0) {
            notificationRepo.createBatch(notifications);
        }

        return {
            success: true,
            flagsDetected: totalFlags
        };
    }

    /**
     * Detect red flags for a specific client
     */
    private detectClientRedFlags(clientId: string): Array<{ type: string; severity: string; message: string }> {
        const flags = [];

        // Check for missed check-ins
        const lastCheckIn = db.prepare(`
      SELECT MAX(date) as last_date
      FROM check_ins
      WHERE client_id = ?
    `).get(clientId) as { last_date: string | null };

        if (lastCheckIn?.last_date) {
            const daysSince = Math.floor(
                (Date.now() - new Date(lastCheckIn.last_date).getTime()) / (1000 * 60 * 60 * 24)
            );

            if (daysSince >= 2) {
                flags.push({
                    type: 'MISSED_CHECKIN',
                    severity: daysSince >= 5 ? 'high' : 'medium',
                    message: `No check-in for ${daysSince} days`
                });
            }
        }

        // Check for low energy trend (last 7 days)
        const lowEnergyCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM check_ins
      WHERE client_id = ?
      AND date >= date('now', '-7 days')
      AND energy < 4
    `).get(clientId) as { count: number };

        if (lowEnergyCount.count >= 3) {
            flags.push({
                type: 'LOW_ENERGY',
                severity: 'high',
                message: `${lowEnergyCount.count} low energy days this week`
            });
        }

        // Check for high hunger trend (last 7 days)
        const highHungerCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM check_ins
      WHERE client_id = ?
      AND date >= date('now', '-7 days')
      AND hunger > 7
    `).get(clientId) as { count: number };

        if (highHungerCount.count >= 3) {
            flags.push({
                type: 'HIGH_HUNGER',
                severity: 'medium',
                message: `${highHungerCount.count} high hunger days this week`
            });
        }

        return flags;
    }
}

export const redFlagDetectorService = new RedFlagDetectorService();
