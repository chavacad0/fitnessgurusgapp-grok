import { getDb } from '../db/mongo';
import { RedFlag } from '../types';

/**
 * MongoDB repository for red flags.
 * Pure data access layer — no business logic.
 *
 * CONCURRENCY NOTE: createRedFlag() uses a single atomic upsert.
 * The unique index on { client_id, type } in mongo.ts enforces the
 * one-flag-per-type-per-client rule at the DB level, so concurrent
 * detection runs cannot produce duplicate documents.
 */

/**
 * Create or atomically update a red flag.
 *
 * Uses findOneAndUpdate with upsert:true — one DB round-trip regardless
 * of whether the flag already exists. Safe under concurrent detection runs.
 *
 * The unique index on { client_id, type } (see mongo.ts initIndexes) is
 * the hard constraint. This upsert pattern is consistent with it.
 */
export async function createRedFlag(flag: RedFlag): Promise<RedFlag> {
    const db = await getDb();
    const now = new Date();

    const result = await db.collection<RedFlag>('red_flags').findOneAndUpdate(
        { client_id: flag.client_id, type: flag.type },
        {
            $set: {
                detectedAt:        now,
                message:           flag.message,
                severity:          flag.severity,
                triggerCondition:  flag.triggerCondition,
                related_check_ins: flag.related_check_ins,
                metadata:          flag.metadata,
            },
            $setOnInsert: {
                client_id: flag.client_id,
                type:      flag.type,
            },
        },
        { upsert: true, returnDocument: 'after' }
    );

    return result as unknown as RedFlag;
}

export async function getRedFlagsByClient(
    clientId: string,
    limit: number = 50
): Promise<RedFlag[]> {
    const db = await getDb();
    return db.collection<RedFlag>('red_flags')
        .find({ client_id: clientId })
        .sort({ detectedAt: -1 })
        .limit(limit)
        .toArray();
}
