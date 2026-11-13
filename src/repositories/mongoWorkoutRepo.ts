/**
 * mongoWorkoutRepo — DB access for workout_assignments and workout_logs.
 *
 * Security model:
 *  - Assignments are created by coaches, scoped to coach_id + client_id.
 *  - Logs are created by clients, scoped to client_id + assignment_id.
 *  - Backend always validates ownership before any read/write.
 *  - Client-submitted exercise names/targets are NEVER stored here —
 *    only exercise_id + actual performance fields are accepted from clients.
 */

import { getDb } from '../db/mongo';
import { v4 as uuidv4 } from 'uuid';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorkoutExercise {
    id:             string;   // UUID — stable reference from client logs
    name:           string;   // coach-assigned, read-only for client
    target_sets:    number;
    target_reps:    number;
    target_weight?: number;   // kg, optional
    notes?:         string;   // coach tip, read-only for client
}

export interface WorkoutAssignment {
    _id?:       any;          // MongoDB ObjectId
    coach_id:   string;
    client_id:  string;
    date:       string;       // YYYY-MM-DD
    title:      string;
    exercises:  WorkoutExercise[];
    created_at: Date;
    updated_at: Date;
}

export interface ExerciseLog {
    exercise_id:    string;   // references WorkoutExercise.id
    completed:      boolean;
    actual_sets?:   number;
    actual_reps?:   number;
    actual_weight?: number;
    difficulty?:    number;   // 1–10
    notes?:         string;
}

export interface WorkoutLog {
    _id?:           any;
    assignment_id:  string;
    client_id:      string;
    date:           string;   // YYYY-MM-DD (denormalised for quick queries)
    exercise_logs:  ExerciseLog[];
    created_at:     Date;
    updated_at:     Date;
}

// ─── Assignment CRUD ─────────────────────────────────────────────────────────

/**
 * Create a new workout assignment.
 * Each exercise gets a stable UUID id so clients can reference it in logs.
 * Coach-provided data only — client cannot call this.
 */
export async function createWorkoutAssignment(data: {
    coach_id:   string;
    client_id:  string;
    date:       string;
    title:      string;
    exercises:  Omit<WorkoutExercise, 'id'>[];
}): Promise<WorkoutAssignment> {
    const db  = await getDb();
    const now = new Date();

    const assignment: WorkoutAssignment = {
        coach_id:   data.coach_id,
        client_id:  data.client_id,
        date:       data.date,
        title:      data.title.trim(),
        exercises:  data.exercises.map(ex => ({
            id:             uuidv4(),
            name:           ex.name.trim(),
            target_sets:    ex.target_sets,
            target_reps:    ex.target_reps,
            target_weight:  ex.target_weight ?? undefined,
            notes:          ex.notes?.trim() ?? undefined,
        })),
        created_at: now,
        updated_at: now,
    };

    const result = await db.collection<WorkoutAssignment>('workout_assignments').insertOne(assignment as any);
    return { ...assignment, _id: result.insertedId };
}

/**
 * Get all assignments for a client on a specific date.
 * Returns null if no assignment exists for that date.
 * Used by client home screen to show "Today's Workout".
 */
export async function getWorkoutAssignmentForClient(
    clientId: string,
    date:     string,
): Promise<WorkoutAssignment | null> {
    const db = await getDb();
    const doc = await db.collection<WorkoutAssignment>('workout_assignments').findOne({
        client_id: clientId,
        date,
    });
    return doc ?? null;
}

/**
 * Get all assignments created by a coach for a specific client.
 * Sorted by date descending (most recent first).
 * Coach-only access — always validate ownership before calling.
 */
export async function getWorkoutAssignmentsByCoach(
    coachId:  string,
    clientId: string,
): Promise<WorkoutAssignment[]> {
    const db = await getDb();
    return db.collection<WorkoutAssignment>('workout_assignments')
        .find({ coach_id: coachId, client_id: clientId })
        .sort({ date: -1 })
        .toArray() as Promise<WorkoutAssignment[]>;
}

// ─── Log CRUD ─────────────────────────────────────────────────────────────────

/**
 * Upsert a workout log for a given assignment + client.
 * Safe to call multiple times (client can update their log before end of day).
 *
 * SECURITY NOTE:
 *   Only exercise_id + actual performance fields are stored.
 *   Exercise name and target values come from the ASSIGNMENT, not from client input.
 *   Validate exercise_id exists in assignment before calling this function.
 */
export async function upsertWorkoutLog(data: {
    assignment_id:  string;
    client_id:      string;
    date:           string;
    exercise_logs:  ExerciseLog[];
}): Promise<WorkoutLog> {
    const db  = await getDb();
    const now = new Date();

    const filter = {
        assignment_id: data.assignment_id,
        client_id:     data.client_id,
    };

    const update = {
        $set: {
            date:          data.date,
            exercise_logs: data.exercise_logs,
            updated_at:    now,
        },
        $setOnInsert: {
            created_at: now,
        },
    };

    await db.collection<WorkoutLog>('workout_logs').updateOne(filter, update, { upsert: true });

    const saved = await db.collection<WorkoutLog>('workout_logs').findOne(filter);
    return saved!;
}

/**
 * Workout logs for one client on the given dates.
 * Used to decide a missed-workout flag from logged exercises, not from a blank check-in field.
 */
export async function getWorkoutLogsForClientDates(
    clientId: string,
    dates: string[],
): Promise<WorkoutLog[]> {
    if (dates.length === 0) return [];
    const db = await getDb();
    return db.collection<WorkoutLog>('workout_logs')
        .find({ client_id: clientId, date: { $in: dates } })
        .toArray();
}

/**
 * Get the workout log for a specific assignment + client.
 * Returns null if the client hasn't logged yet.
 */
export async function getWorkoutLogForAssignment(
    assignmentId: string,
    clientId:     string,
): Promise<WorkoutLog | null> {
    const db = await getDb();
    const doc = await db.collection<WorkoutLog>('workout_logs').findOne({
        assignment_id: assignmentId,
        client_id:     clientId,
    });
    return doc ?? null;
}

/**
 * Get workout history for a client — assignments + matching logs.
 * Returns the most recent `limit` assignments (default 30) sorted by date desc.
 * Each entry pairs the assignment with its log (null if not yet logged).
 *
 * Used by:
 *  - Exercise history display ("Previous performance")
 *  - Personal best computation
 */
export async function getWorkoutHistoryForClient(
    clientId: string,
    limit:    number = 30,
): Promise<Array<{ assignment: WorkoutAssignment; log: WorkoutLog | null }>> {
    const db = await getDb();

    // 1. Fetch recent assignments for this client
    const assignments = await db.collection<WorkoutAssignment>('workout_assignments')
        .find({ client_id: clientId })
        .sort({ date: -1 })
        .limit(limit)
        .toArray();

    if (assignments.length === 0) return [];

    // 2. Batch-fetch all logs for these assignments in one query
    const assignmentIds = assignments.map(a => a._id!.toString());
    const logs = await db.collection<WorkoutLog>('workout_logs')
        .find({ client_id: clientId, assignment_id: { $in: assignmentIds } })
        .toArray();

    // 3. Index logs by assignment_id for O(1) lookup
    const logByAssignment = new Map<string, WorkoutLog>();
    for (const log of logs) {
        logByAssignment.set(log.assignment_id, log);
    }

    // 4. Pair each assignment with its log
    return assignments.map(a => ({
        assignment: a,
        log:        logByAssignment.get(a._id!.toString()) ?? null,
    }));
}
