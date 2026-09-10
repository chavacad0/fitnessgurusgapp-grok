import { getRecentCheckIns } from '../repositories/mongoCheckinRepo';
import { createRedFlag } from '../repositories/mongoRedFlagRepo';
import { CheckIn, RedFlag } from '../types';

/**
 * MongoDB-based Red Flag Detection Service
 * Detects concerning patterns in client check-in data
 */

interface DetectionResult {
    success: boolean;
    flagsDetected: number;
    flags: RedFlag[];
}

export async function detectRedFlagsForClient(clientId: string): Promise<DetectionResult> {
    const flags: RedFlag[] = [];

    // Get last 7 days of check-ins (sorted by date descending)
    const recentCheckIns = await getRecentCheckIns(clientId, 7);

    if (recentCheckIns.length < 3) {
        // Not enough data to detect patterns
        return {
            success: true,
            flagsDetected: 0,
            flags: []
        };
    }

    // Sort by date ascending for easier consecutive day checking
    const sortedCheckIns = [...recentCheckIns].sort((a, b) =>
        a.date.localeCompare(b.date)
    );

    // Rule 1: Low Energy Pattern (3 consecutive days with energy <= 4)
    const lowEnergyFlag = detectConsecutiveLowMetric(
        sortedCheckIns,
        'energy',
        4,
        3,
        'LOW_ENERGY',
        'high',
        'Low energy for {count} consecutive days',
        'Energy ≤ 4 for 3 consecutive days'
    );
    if (lowEnergyFlag) flags.push(lowEnergyFlag);

    // Rule 2: Missed Workout Pattern (3 consecutive days without workout)
    const missedWorkoutFlag = detectConsecutiveMissedWorkouts(
        sortedCheckIns,
        3,
        'MISSED_WORKOUT',
        'medium',
        'Missed workouts for {count} consecutive days',
        'No workouts completed for 3 consecutive days'
    );
    if (missedWorkoutFlag) flags.push(missedWorkoutFlag);

    // Rule 4: High Hunger with Low Activity (hunger >= 8 AND steps < 5000)
    const highHungerLowActivityFlag = detectHighHungerWithLowActivity(
        sortedCheckIns,
        'HIGH_HUNGER_WITH_LOW_ACTIVITY',
        'high',
        'High hunger (≥8) with low activity (<5000 steps)'
    );
    if (highHungerLowActivityFlag) flags.push(highHungerLowActivityFlag);

    // Rule 5: Work Fatigue (Singapore context - stress keywords in notes)
    const workFatigueFlag = detectWorkFatigue(
        sortedCheckIns,
        'WORK_FATIGUE',
        'medium',
        'Work-related stress detected in notes'
    );
    if (workFatigueFlag) flags.push(workFatigueFlag);

    // Rule 3: Low Mood Pattern (3 consecutive days with mood <= 3)
    const lowMoodFlag = detectConsecutiveLowMetric(
        sortedCheckIns,
        'mood',
        3,
        3,
        'LOW_MOOD',
        'high',
        'Low mood for {count} consecutive days',
        'Mood ≤ 3 for 3 consecutive days'
    );
    if (lowMoodFlag) flags.push(lowMoodFlag);

    // Save all detected flags to database
    const savedFlags: RedFlag[] = [];
    for (const flag of flags) {
        const savedFlag = await createRedFlag(flag);
        savedFlags.push(savedFlag);
    }

    return {
        success: true,
        flagsDetected: savedFlags.length,
        flags: savedFlags
    };
}

/**
 * Detect consecutive days where a metric is below threshold
 * Supports both new metrics object and legacy top-level fields
 */
function detectConsecutiveLowMetric(
    checkIns: CheckIn[],
    metricKey: 'energy' | 'mood' | 'hunger',
    threshold: number,
    consecutiveDays: number,
    flagType: 'LOW_ENERGY' | 'LOW_MOOD',
    severity: 'low' | 'medium' | 'high',
    messageTemplate: string,
    triggerCondition: string
): RedFlag | null {
    if (checkIns.length < consecutiveDays) return null;

    // Check the last N consecutive days
    const lastNDays = checkIns.slice(-consecutiveDays);
    const allLow = lastNDays.every(checkIn => {
        let value: number | undefined;

        // Try new metrics structure first, fall back to legacy fields
        if (metricKey === 'energy') {
            value = checkIn.metrics?.energy ?? checkIn.energy;
        } else if (metricKey === 'hunger') {
            value = checkIn.metrics?.hunger ?? checkIn.hunger;
        } else if (metricKey === 'mood') {
            value = checkIn.mood; // mood is still top-level (legacy)
        }

        return value !== undefined && value <= threshold;
    });

    if (allLow) {
        const clientId = checkIns[0].client_id;
        const relatedIds = lastNDays.map(c => c._id).filter(Boolean) as string[];

        return {
            client_id: clientId,
            type: flagType,
            severity,
            message: messageTemplate.replace('{count}', consecutiveDays.toString()),
            detectedAt: new Date(),
            triggerCondition,
            related_check_ins: relatedIds,
            metadata: {
                consecutive_days: consecutiveDays
            }
        };
    }

    return null;
}

/**
 * Detect consecutive days without completed workouts
 */
function detectConsecutiveMissedWorkouts(
    checkIns: CheckIn[],
    consecutiveDays: number,
    flagType: 'MISSED_WORKOUT',
    severity: 'low' | 'medium' | 'high',
    messageTemplate: string,
    triggerCondition: string
): RedFlag | null {
    if (checkIns.length < consecutiveDays) return null;

    // Check the last N consecutive days
    const lastNDays = checkIns.slice(-consecutiveDays);
    const allMissed = lastNDays.every(checkIn =>
        checkIn.workout_completed === false || checkIn.workout_completed === undefined
    );

    if (allMissed) {
        const clientId = checkIns[0].client_id;
        const relatedIds = lastNDays.map(c => c._id).filter(Boolean) as string[];

        return {
            client_id: clientId,
            type: flagType,
            severity,
            message: messageTemplate.replace('{count}', consecutiveDays.toString()),
            detectedAt: new Date(),
            triggerCondition,
            related_check_ins: relatedIds,
            metadata: {
                consecutive_days: consecutiveDays
            }
        };
    }

    return null;
}

/**
 * Detect high hunger with low activity (hunger >= 8 AND steps < 5000)
 */
function detectHighHungerWithLowActivity(
    checkIns: CheckIn[],
    flagType: 'HIGH_HUNGER_WITH_LOW_ACTIVITY',
    severity: 'low' | 'medium' | 'high',
    message: string
): RedFlag | null {
    if (checkIns.length === 0) return null;

    // Check the most recent check-in
    const latestCheckIn = checkIns[checkIns.length - 1];

    // Get hunger value (try metrics first, fall back to legacy field)
    const hunger = latestCheckIn.metrics?.hunger ?? latestCheckIn.hunger;

    // Get steps value (try metrics.stepsToday first, fall back to legacy steps field)
    const steps = latestCheckIn.metrics?.stepsToday ?? latestCheckIn.steps;

    // Trigger if hunger >= 8 AND steps < 5000
    if (hunger !== undefined && hunger >= 8 && steps !== undefined && steps < 5000) {
        return {
            client_id: latestCheckIn.client_id,
            type: flagType,
            severity,
            message,
            detectedAt: new Date(),
            triggerCondition: 'Hunger ≥ 8 AND Steps < 5000',
            related_check_ins: latestCheckIn._id ? [latestCheckIn._id] : [],
            metadata: {
                hunger_value: hunger,
                steps_value: steps
            } as any
        };
    }

    return null;
}

/**
 * Detect work fatigue based on Singapore workplace stress keywords in notes
 */
function detectWorkFatigue(
    checkIns: CheckIn[],
    flagType: 'WORK_FATIGUE',
    severity: 'low' | 'medium' | 'high',
    message: string
): RedFlag | null {
    if (checkIns.length === 0) return null;

    // Singapore work stress keywords
    const stressKeywords = ['stress', 'meeting', 'deadline', 'ot', 'overtime', 'long hours'];

    // Check the most recent check-in
    const latestCheckIn = checkIns[checkIns.length - 1];
    const notes = latestCheckIn.notes?.toLowerCase() || '';

    // Check if any stress keyword is present
    const hasStressKeyword = stressKeywords.some(keyword => notes.includes(keyword));

    if (hasStressKeyword) {
        return {
            client_id: latestCheckIn.client_id,
            type: flagType,
            severity,
            message,
            detectedAt: new Date(),
            triggerCondition: 'Work stress keywords detected in notes',
            related_check_ins: latestCheckIn._id ? [latestCheckIn._id] : [],
            metadata: {} as any
        };
    }

    return null;
}

