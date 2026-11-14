/**
 * Daily check-in scale shared by the phone and the coach hint.
 *
 * Energy and appetite are still saved as numbers on the existing check-in
 * fields (metrics.energy and metrics.hunger, 1–10). Nothing new is stored.
 *
 * Energy faces save 2, 4, 6, 8, or 10 so coach charts and the low-energy
 * red flag (energy <= 4) keep working.
 * An older 1–10 value highlights the nearest face. A tie rounds up
 * (3 → Low, 5 → Okay, 7 → Good, 9 → Great).
 *
 * Appetite is the same 1–10 hunger field:
 *   Not hungry    → 2   (low, 1–3)
 *   Normal        → 5   (mid, 4–7)
 *   Always hungry → 9   (high, 8–10)
 * High starts at 8 because the existing high-hunger check uses hunger >= 8.
 */

export const ENERGY_FACES = [
    { id: 'drained', label: 'Drained', value: 2 },
    { id: 'low',     label: 'Low',     value: 4 },
    { id: 'okay',    label: 'Okay',    value: 6 },
    { id: 'good',    label: 'Good',    value: 8 },
    { id: 'great',   label: 'Great',   value: 10 },
] as const;

export type EnergyFaceId = typeof ENERGY_FACES[number]['id'];
export type EnergyFaceValue = typeof ENERGY_FACES[number]['value'];

export const APPETITE_CHIPS = [
    { id: 'not_hungry',    label: 'Not hungry',    value: 2 },
    { id: 'normal',        label: 'Normal',        value: 5 },
    { id: 'always_hungry', label: 'Always hungry', value: 9 },
] as const;

export type AppetiteChipId = typeof APPETITE_CHIPS[number]['id'];
export type AppetiteValue = typeof APPETITE_CHIPS[number]['value'];

export const LOW_DAY_MESSAGE = 'Tough day, and you still checked in. That counts.';
export const NORMAL_SUCCESS_TEXT = 'Come back tomorrow. Your coach will review it shortly.';
export const WORTH_A_CHECK_IN_LABEL = 'Worth a check-in';

export interface CheckInMood {
    energy?: number | null;
    hunger?: number | null;
}

function clampScale(value: number): number {
    return Math.min(10, Math.max(1, value));
}

/** Stored 1–10 energy → the face value 2, 4, 6, 8, or 10. */
export function nearestEnergyFace(energy: number): EnergyFaceValue {
    if (!Number.isFinite(energy)) return 6;
    const snapped = Math.round(clampScale(energy) / 2) * 2;
    return Math.min(10, Math.max(2, snapped)) as EnergyFaceValue;
}

/** Stored 1–10 hunger → Not hungry (2), Normal (5), or Always hungry (9). */
export function nearestAppetite(hunger: number): AppetiteValue {
    if (!Number.isFinite(hunger)) return 5;
    const clamped = clampScale(hunger);
    if (clamped >= 8) return 9;
    if (clamped <= 3) return 2;
    return 5;
}

export function isLowEnergy(energy: number | null | undefined): boolean {
    return typeof energy === 'number' && Number.isFinite(energy) && energy <= 4;
}

export function isAlwaysHungry(hunger: number | null | undefined): boolean {
    return typeof hunger === 'number' && Number.isFinite(hunger) && nearestAppetite(hunger) === 9;
}

/** Drained or Low — the two faces a tough day uses. */
export function isToughDay(energy: number): boolean {
    const face = nearestEnergyFace(energy);
    return face === 2 || face === 4;
}

export function checkInSuccessText(energy: number): string {
    return isToughDay(energy) ? LOW_DAY_MESSAGE : NORMAL_SUCCESS_TEXT;
}

/**
 * True when the last 3 check-ins are all low energy (<= 4) and Always hungry.
 * Pass them most-recent first. Fewer than 3 is not enough.
 */
export function worthACheckIn(mostRecentFirst: CheckInMood[]): boolean {
    if (mostRecentFirst.length < 3) return false;
    return mostRecentFirst.slice(0, 3).every(row =>
        isLowEnergy(row.energy) && isAlwaysHungry(row.hunger),
    );
}
