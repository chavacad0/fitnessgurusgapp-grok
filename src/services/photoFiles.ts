/**
 * Private photo files.
 *
 * New photos are written under uploads/private with a random UUID name.
 * The original file name is never kept. Nothing in this folder is served
 * as a public static file.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { detectImageType, extFor, mimeFor, stripImageMetadata, ImageKind } from './photoBytes';

const STORAGE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|heic)$/i;

export function publicUploadsDir(): string {
    return process.env.PHOTO_PUBLIC_DIR || path.join(process.cwd(), 'uploads');
}

export function privatePhotosDir(): string {
    return process.env.PHOTO_PRIVATE_DIR || path.join(process.cwd(), 'uploads', 'private');
}

export interface StoredFile {
    storageName: string;
    size: number;
    kind: ImageKind;
    mime: 'image/jpeg' | 'image/png' | 'image/heic';
    bytes: Buffer;
}

/**
 * Check the real bytes, strip EXIF / GPS, and write the file.
 * Returns null when the bytes are not a JPG, PNG or HEIC, or when metadata
 * cannot be removed safely. Nothing is written in that case.
 */
export async function storePrivatePhoto(original: Buffer, dir = privatePhotosDir()): Promise<StoredFile | null> {
    const kind = detectImageType(original);
    if (!kind) return null;
    const bytes = stripImageMetadata(original);
    if (!bytes || detectImageType(bytes) !== kind) return null;

    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
    const storageName = `${randomUUID()}.${extFor(kind)}`;
    const dest = safePrivatePath(dir, storageName);
    if (!dest) return null;
    const tmp = `${dest}.tmp`;
    await fs.promises.writeFile(tmp, bytes, { mode: 0o600 });
    await fs.promises.rename(tmp, dest);
    return { storageName, size: bytes.length, kind, mime: mimeFor(kind), bytes };
}

export async function readPrivatePhoto(storageName: string, dir = privatePhotosDir()): Promise<Buffer | null> {
    const dest = safePrivatePath(dir, storageName);
    if (!dest) return null;
    try {
        return await fs.promises.readFile(dest);
    } catch {
        return null;
    }
}

export function safePrivatePath(dir: string, storageName: string): string | null {
    if (!STORAGE_NAME.test(storageName)) return null;
    const root = path.resolve(dir);
    const dest = path.resolve(root, storageName);
    if (dest !== path.join(root, storageName)) return null;
    return dest;
}
