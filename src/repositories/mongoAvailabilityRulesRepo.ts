import { getDb } from '../db/mongo';
import { CoachAvailabilityRules } from '../types';

/**
 * One document per coach in coach_availability_rules.
 * Weekly hours, blocks, and one-off changes live together so a coach
 * cannot be split across collections, and another coach's id never matches.
 */

const COLLECTION = 'coach_availability_rules';

export async function getAvailabilityRules(coachId: string): Promise<CoachAvailabilityRules | null> {
    const db = await getDb();
    const doc = await db.collection<CoachAvailabilityRules>(COLLECTION).findOne({ coach_id: coachId });
    return doc ?? null;
}

/**
 * Replaces the stored rules for this coach. The filter is the coach id,
 * so a caller cannot write another coach's document by passing a different id
 * inside the payload. The payload's coach_id is set by the caller from the login.
 */
export async function upsertAvailabilityRules(
    coachId: string,
    rules: Omit<CoachAvailabilityRules, '_id' | 'coach_id'>,
): Promise<CoachAvailabilityRules> {
    const db = await getDb();
    const source = rules as CoachAvailabilityRules;
    const set: Omit<CoachAvailabilityRules, '_id'> = {
        timezone: 'Asia/Singapore',
        hours_saved: source.hours_saved,
        slot_length_minutes: source.slot_length_minutes,
        buffer_minutes: source.buffer_minutes,
        weekdays: source.weekdays,
        blocks: source.blocks,
        overrides: source.overrides,
        updated_at: source.updated_at,
        coach_id: coachId,
    };
    await db.collection(COLLECTION).updateOne(
        { coach_id: coachId },
        { $set: set },
        { upsert: true },
    );
    const saved = await getAvailabilityRules(coachId);
    if (!saved) {
        throw new Error('Working hours could not be saved.');
    }
    return saved;
}
