/**
 * Hard stop for test scripts that delete or drop data.
 *
 * Call this immediately before any deleteMany, drop, or dropDatabase.
 * It does not open a database and it does not read .env.
 *
 * A destructive test step is allowed only when both are true:
 *   - NODE_ENV is exactly "test" (the npm test script sets this)
 *   - the database name ends with "_test"
 *
 * A name like "fitnessgurusg" or "fitnessgurusg_test_backup" is refused.
 * A memory-server database is allowed only when its name also ends with "_test".
 */
export function assertSafeTestDatabase(dbName: string | undefined | null): void {
    const name = (dbName ?? '').trim();

    if (process.env.NODE_ENV !== 'test') {
        throw new Error(
            `Refusing to delete data: NODE_ENV must be "test" ` +
            `(got ${JSON.stringify(process.env.NODE_ENV ?? '')}). ` +
            'npm test sets this. No database was changed.',
        );
    }

    if (!name.endsWith('_test')) {
        throw new Error(
            `Refusing to delete data: the database name must end with "_test" ` +
            `(got ${JSON.stringify(name)}). ` +
            'This stops tests from wiping a development or production database. No database was changed.',
        );
    }
}
