/**
 * Daily Reminder Service — MongoDB implementation
 *
 * ⚠️  NOT IMPLEMENTED — DO NOT USE IN PRODUCTION ⚠️
 *
 * Status: Stub only. Phase 7 will implement this properly.
 *
 * Reasons this was not completed in Phase 6:
 *  1. No notification delivery mechanism exists yet (no WhatsApp API, no push token).
 *  2. The scheduler must be coach-scoped — requires iterating over all coaches
 *     and running reminders per coach (coachId is a required parameter).
 *  3. `getClientsWithoutCheckIn` requires `(today: string, coachId: string)` —
 *     previous version was calling it with wrong arity and would have thrown at runtime.
 *
 * Phase 7 implementation requirements:
 *  - Accept `coachId: string` parameter (or run for all coaches via a top-level loop)
 *  - Integrate actual notification delivery (WhatsApp / push)
 *  - Called by a cron scheduler (node-cron or Agenda) registered in server.ts
 *
 * DO NOT wire this into any scheduler until Phase 7 implementation is complete.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function runDailyReminders(_coachId: string, _today: string): Promise<void> {
    throw new Error(
        'runDailyReminders is not yet implemented. ' +
        'See Phase 7 plan in PROJECT_STATUS.md before wiring this service.'
    );
}
