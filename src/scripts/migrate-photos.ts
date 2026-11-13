/**
 * One-time photo migration. Not run by the server.
 *
 *   npm run migrate:photos              dry run, prints counts only
 *   npm run migrate:photos -- --apply   moves files and updates records
 *
 * Back up the database and the uploads folder before --apply.
 * Output is counts only: no file names, client names, or other personal data.
 */
import dotenv from 'dotenv';

dotenv.config();

async function main(): Promise<void> {
    const { runPhotoMigrationCli } = await import('../services/photoMigration');
    const code = await runPhotoMigrationCli(process.argv);
    process.exit(code);
}

main().catch(() => {
    console.error('Photo migration failed.');
    process.exit(1);
});
