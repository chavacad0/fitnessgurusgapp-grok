import { getDb } from '../db/mongo';

/**
 * Photos collection.
 *
 * One row is one private progress photo.
 *   id         — UUID used in GET /api/photos/:id
 *   client_id  — the client the photo belongs to
 *   coach_id   — that client's coach at upload time, or null if they had none
 *   created_at
 *   type       — image/jpeg, image/png, or image/heic
 *   size       — bytes stored on disk after metadata was removed
 *   storage_name — UUID file name inside the private folder. Never sent to the phone.
 *   legacy_sha256 — set only by the one-time migration, so a second run does not copy again.
 */
export interface PhotoRecord {
    id: string;
    client_id: string;
    coach_id: string | null;
    created_at: Date;
    type: 'image/jpeg' | 'image/png' | 'image/heic';
    size: number;
    storage_name: string;
    legacy_sha256?: string;
}

const PHOTO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHOTO_PATH = /^\/api\/photos\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export class PhotoInputError extends Error {
    statusCode = 400;
    constructor(message: string) {
        super(message);
    }
}

export async function createPhoto(photo: PhotoRecord): Promise<PhotoRecord> {
    const db = await getDb();
    await db.collection<PhotoRecord>('photos').insertOne({ ...photo });
    return photo;
}

export async function findPhotoById(id: string): Promise<PhotoRecord | null> {
    if (!PHOTO_ID.test(id)) return null;
    const db = await getDb();
    const doc = await db.collection<PhotoRecord>('photos').findOne(
        { id: id.toLowerCase() },
        { projection: { _id: 0 } },
    );
    return doc ?? null;
}

export async function findPhotoByLegacyHash(hash: string): Promise<PhotoRecord | null> {
    const db = await getDb();
    const doc = await db.collection<PhotoRecord>('photos').findOne(
        { legacy_sha256: hash },
        { projection: { _id: 0 } },
    );
    return doc ?? null;
}

/**
 * Turn the check-in `photos` field into private links owned by this client.
 * A missing field means no photos. Anything that is not this client's photo
 * is rejected, and nothing is saved.
 */
export async function photoUrlsForCheckIn(clientId: string, photos: unknown): Promise<string[]> {
    if (photos === undefined) return [];
    if (!Array.isArray(photos)) {
        throw new PhotoInputError('Photos must be a list of up to 3.');
    }
    if (photos.length > 3) {
        throw new PhotoInputError('Maximum 3 photos per check-in.');
    }

    const ids: string[] = [];
    for (const item of photos) {
        if (typeof item !== 'string') {
            throw new PhotoInputError('One or more photos could not be saved.');
        }
        const match = PHOTO_PATH.exec(item.trim());
        if (!match) throw new PhotoInputError('One or more photos could not be saved.');
        const id = match[1].toLowerCase();
        if (!ids.includes(id)) ids.push(id);
    }
    if (ids.length === 0) return [];

    const db = await getDb();
    const found = await db.collection<PhotoRecord>('photos').find(
        { id: { $in: ids }, client_id: clientId },
        { projection: { id: 1, client_id: 1 } },
    ).toArray();
    if (found.length !== ids.length) {
        throw new PhotoInputError('One or more photos could not be saved.');
    }
    return ids.map(id => `/api/photos/${id}`);
}
