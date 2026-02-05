import { getClientsWithoutCheckIn } from '../repositories/mongoClientRepo';

export async function runDailyReminders(today: string) {
    const clients = await getClientsWithoutCheckIn(today);

    for (const client of clients) {
        const hasAccess =
            client.access_override === true ||
            (client.paid_until && new Date(client.paid_until) >= new Date(today));

        if (!hasAccess) continue;

        console.log(`📩 Would send reminder to ${client.name}`);
    }
}


