import db from '../../local-db/init';
import { AutomatedRule } from '../types';

export async function getActiveRulesByCoach(
    coachId: string,
    triggerType: "daily_reminder" | "red_flag"
): Promise<AutomatedRule[]> {
    const db = await getDb();
    return db.collection<AutomatedRule>('automated_message_rules')
        .find({
            coach_id: coachId,
            trigger_type: triggerType,
            is_active: true
        })
        .toArray();
}

export async function createRule(rule: AutomatedRule): Promise<void> {
    const db = await getDb();
    await db.collection<AutomatedRule>('automated_message_rules').insertOne(rule);
}
