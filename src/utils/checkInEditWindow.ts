/**
 * Check-in edit window enforcement — Asia/Singapore timezone.
 *
 * Business rule: check-ins can only be created or edited on the same calendar
 * day they belong to (Singapore time). After midnight SGT the window closes.
 *
 * WHY NOT UTC?
 *   Clients are in Singapore (UTC+8). "Today" means today in SGT, not UTC.
 *   Using UTC would allow edits up to 08:00 SGT the next morning — wrong.
 *
 * WHY toLocaleString?
 *   Avoids external date libraries (moment, date-fns) for a simple timezone
 *   conversion. The 'en-CA' locale produces YYYY-MM-DD format natively.
 *   This works on Node.js 18+ with full ICU data (default in modern Node builds).
 */

/**
 * Returns the current date string (YYYY-MM-DD) in Asia/Singapore time.
 */
export function getTodaySGT(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

/**
 * Returns true only if the given date string equals today in Asia/Singapore time.
 * Apply this before allowing any check-in create or update operation.
 *
 * @param checkInDateStr — the `date` field from the request body (YYYY-MM-DD)
 */
export function canEditCheckIn(checkInDateStr: string): boolean {
    return checkInDateStr === getTodaySGT();
}
