/**
 * One-time move of progress photos out of the public uploads folder.
 *
 * This is not called when the server starts. Ava runs it with
 * `npm run migrate:photos` (dry run) and then `npm run migrate:photos -- --apply`.
 *
 * Dry run is the default. It only counts. Apply moves each file whose owner
 * can be read from a check-in or a client record, strips EXIF and GPS, stores
 * a private UUID name, writes a photos row, and updates those references.
 * A file with no single owner is left where it is. It is no longer public,
 * because the server does not serve /uploads.
 *
 * Logs are counts only. File names, client names and other personal data
 * are not printed.
 */
import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import { Db } from 'mongodb';
import { detectImageType, stripImageMetadata, mimeFor, extFor } from './photoBytes';
import { safePrivatePath } from './photoFiles';
import { createPhoto, findPhotoByLegacyHash, PhotoRecord } from '../repositories/mongoPhotoRepo';

const MAX_MIGRATE_BYTES = 20 * 1024 * 1024;

export interface PhotoMigrationCounts {
    mode: 'dry-run' | 'apply';
    files_seen: number;
    would_move: number;
    moved: number;
    already_migrated: number;
    owner_unknown: number;
    not_a_photo: number;
    not_stripped: number;
    skipped: number;
    references_to_update: number;
    references_updated: number;
}

export function emptyCounts(apply: boolean): PhotoMigrationCounts {
    return {
        mode: apply ? 'apply' : 'dry-run',
        files_seen: 0,
        would_move: 0,
        moved: 0,
        already_migrated: 0,
        owner_unknown: 0,
        not_a_photo: 0,
        not_stripped: 0,
        skipped: 0,
        references_to_update: 0,
        references_updated: 0,
    };
}

export function formatMigrationCounts(counts: PhotoMigrationCounts): string {
    const lines = [
        'Photo migration',
        counts.mode === 'apply'
            ? 'Mode: apply'
            : 'Mode: dry run (nothing will be changed)',
        'Back up the database and the uploads folder before you use --apply.',
        '',
        `files_seen: ${counts.files_seen}`,
        `would_move: ${counts.would_move}`,
        `moved: ${counts.moved}`,
        `already_migrated: ${counts.already_migrated}`,
        `owner_unknown: ${counts.owner_unknown}`,
        `not_a_photo: ${counts.not_a_photo}`,
        `not_stripped: ${counts.not_stripped}`,
        `skipped: ${counts.skipped}`,
        `references_to_update: ${counts.references_to_update}`,
        `references_updated: ${counts.references_updated}`,
    ];
    return lines.join('\n');
}

interface Owner {
    clientId: string;
    coachId: string | null;
}

export async function migrateLegacyPhotos(options: {
    db: Db;
    publicDir: string;
    privateDir: string;
    apply: boolean;
}): Promise<PhotoMigrationCounts> {
    const counts = emptyCounts(options.apply);
    let names: string[] = [];
    try {
        const dirents = await fs.promises.readdir(options.publicDir, { withFileTypes: true });
        names = dirents
            .filter(entry => entry.isFile() && !entry.name.startsWith('.'))
            .map(entry => entry.name)
            .filter(name => !name.includes('/') && !name.includes('\\') && !name.includes('\0'));
    } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return counts;
        throw err;
    }

    for (const name of names) {
        counts.files_seen++;
        const source = path.resolve(options.publicDir, name);
        const root = path.resolve(options.publicDir);
        if (source !== path.join(root, name)) {
            counts.skipped++;
            continue;
        }

        let bytes: Buffer;
        try {
            const stat = await fs.promises.lstat(source);
            if (!stat.isFile() || stat.isSymbolicLink()) {
                counts.skipped++;
                continue;
            }
            if (stat.size > MAX_MIGRATE_BYTES) {
                counts.skipped++;
                continue;
            }
            bytes = await fs.promises.readFile(source);
        } catch {
            counts.skipped++;
            continue;
        }

        const kind = detectImageType(bytes);
        if (!kind) {
            counts.not_a_photo++;
            continue;
        }
        const stripped = stripImageMetadata(bytes);
        if (!stripped || detectImageType(stripped) !== kind) {
            counts.not_stripped++;
            continue;
        }

        const owner = await findOwner(options.db, name);
        if (!owner) {
            counts.owner_unknown++;
            continue;
        }

        const hash = createHash('sha256').update(bytes).digest('hex');
        const existing = await findPhotoByLegacyHash(hash);
        const referenceCount = await countReferences(options.db, name);

        if (existing) {
            counts.already_migrated++;
            if (options.apply) {
                counts.references_updated += await retargetReferences(
                    options.db,
                    name,
                    `/api/photos/${existing.id}`,
                    true,
                );
                await fs.promises.rm(source, { force: true });
            } else {
                counts.references_to_update += referenceCount;
            }
            continue;
        }

        if (!options.apply) {
            counts.would_move++;
            counts.references_to_update += referenceCount;
            continue;
        }

        const storageName = `${randomUUID()}.${extFor(kind)}`;
        const dest = safePrivatePath(options.privateDir, storageName);
        if (!dest) {
            counts.not_stripped++;
            continue;
        }
        await fs.promises.mkdir(options.privateDir, { recursive: true, mode: 0o700 });
        const tmp = `${dest}.tmp`;
        await fs.promises.writeFile(tmp, stripped, { mode: 0o600 });
        await fs.promises.rename(tmp, dest);

        const record: PhotoRecord = {
            id: storageName.slice(0, 36),
            client_id: owner.clientId,
            coach_id: owner.coachId,
            created_at: new Date(),
            type: mimeFor(kind),
            size: stripped.length,
            storage_name: storageName,
            legacy_sha256: hash,
        };
        await createPhoto(record);
        counts.moved++;
        counts.references_updated += await retargetReferences(
            options.db,
            name,
            `/api/photos/${record.id}`,
            true,
        );
        await fs.promises.rm(source, { force: true });
    }

    return counts;
}

async function findOwner(db: Db, filename: string): Promise<Owner | null> {
    const pathRef = `/uploads/${filename}`;
    const checkins = await db.collection('checkins').find(
        { $or: [{ photos: pathRef }, { photo: pathRef }, { photo_url: pathRef }] },
        { projection: { client_id: 1 } },
    ).toArray();
    const clients = await db.collection('clients').find(
        { $or: [{ photos: pathRef }, { photo: pathRef }, { photo_url: pathRef }] },
        { projection: { id: 1, coach_id: 1 } },
    ).toArray();

    const clientIds = new Set<string>();
    for (const row of checkins) {
        if (typeof row.client_id === 'string' && row.client_id) clientIds.add(row.client_id);
    }
    for (const row of clients) {
        if (typeof row.id === 'string' && row.id) clientIds.add(row.id);
    }
    if (clientIds.size !== 1) return null;

    const clientId = [...clientIds][0];
    const client = await db.collection('clients').findOne(
        { id: clientId },
        { projection: { coach_id: 1 } },
    );
    const coachId = typeof client?.coach_id === 'string' && client.coach_id ? client.coach_id : null;
    return { clientId, coachId };
}

async function countReferences(db: Db, filename: string): Promise<number> {
    return retargetReferences(db, filename, '', false);
}

async function retargetReferences(db: Db, filename: string, nextUrl: string, apply: boolean): Promise<number> {
    const pathRef = `/uploads/${filename}`;
    let changed = 0;
    changed += await retargetCollection(db, 'checkins', pathRef, nextUrl, apply);
    changed += await retargetCollection(db, 'clients', pathRef, nextUrl, apply);
    return changed;
}

async function retargetCollection(
    db: Db,
    collection: 'checkins' | 'clients',
    pathRef: string,
    nextUrl: string,
    apply: boolean,
): Promise<number> {
    const rows = await db.collection(collection).find(
        { $or: [{ photos: pathRef }, { photo: pathRef }, { photo_url: pathRef }] },
        { projection: { photos: 1, photo: 1, photo_url: 1 } },
    ).toArray();

    let changed = 0;
    for (const row of rows) {
        const set: Record<string, unknown> = {};
        for (const field of ['photos', 'photo', 'photo_url'] as const) {
            const current = row[field];
            if (typeof current === 'string' && current === pathRef) {
                set[field] = nextUrl;
            } else if (Array.isArray(current) && current.some(item => item === pathRef)) {
                set[field] = current.map(item => (item === pathRef ? nextUrl : item));
            }
        }
        if (Object.keys(set).length === 0) continue;
        changed++;
        if (apply) {
            await db.collection(collection).updateOne({ _id: row._id }, { $set: set });
        }
    }
    return changed;
}

/** True only for an explicit --apply that is not also a dry run. */
export function migrationWillApply(argv: string[]): boolean {
    return argv.includes('--apply') && !argv.includes('--dry-run');
}

export async function runPhotoMigrationCli(argv: string[]): Promise<number> {
    const apply = migrationWillApply(argv);
    if (argv.includes('--apply') && argv.includes('--dry-run')) {
        console.log('Both --apply and --dry-run were set. Nothing will be changed.');
    }

    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI is not set. Nothing was changed.');
        return 1;
    }

    console.log(apply
        ? 'Photo migration is about to change files and the database. A backup should already exist.'
        : 'Photo migration dry run. Nothing will be changed. Back up first, then run with --apply.');

    const { getDb, closeDb } = await import('../db/mongo');
    const { publicUploadsDir, privatePhotosDir } = await import('./photoFiles');
    try {
        const db = await getDb();
        const counts = await migrateLegacyPhotos({
            db,
            publicDir: publicUploadsDir(),
            privateDir: privatePhotosDir(),
            apply,
        });
        console.log(formatMigrationCounts(counts));
        return 0;
    } catch (err: unknown) {
        console.error(safeFailure(err));
        return 1;
    } finally {
        await closeDb().catch(() => undefined);
    }
}

function safeFailure(err: unknown): string {
    const message = err instanceof Error ? err.message : '';
    if (/mongodb(\+srv)?:\/\//i.test(message) || message.includes('@') || /[/\\]/.test(message)) {
        return 'Photo migration failed. Details were hidden so a database address or file path is not printed.';
    }
    return message
        ? `Photo migration failed: ${message}`
        : 'Photo migration failed.';
}
