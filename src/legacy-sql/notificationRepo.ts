import db from '../../local-db/init';

export interface Notification {
    id?: string;
    user_id: string;
    title: string;
    body: string;
    notification_type: string;
    reference_id?: string;
}

export class NotificationRepository {
    /**
     * Create a single notification
     */
    create(notification: Notification): void {
        const stmt = db.prepare(`
      INSERT INTO notifications (id, user_id, title, body, notification_type, reference_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

        const id = notification.id || this.generateId();
        stmt.run(
            id,
            notification.user_id,
            notification.title,
            notification.body,
            notification.type,
            notification.reference_id || null
        );
    }

    /**
     * Create multiple notifications in a transaction
     */
    createBatch(notifications: Notification[]): void {
        if (notifications.length === 0) return;

        const insert = db.prepare(`
      INSERT INTO notifications (id, user_id, title, body, notification_type, reference_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

        const insertMany = db.transaction((notifs: Notification[]) => {
            for (const notif of notifs) {
                const id = notif.id || this.generateId();
                insert.run(
                    id,
                    notif.user_id,
                    notif.title,
                    notif.body,
                    notif.notification_type,
                    notif.reference_id || null
                );
            }
        });

        insertMany(notifications);
    }

    private generateId(): string {
        return `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

export const notificationRepo = new NotificationRepository();
