import { Router, Response } from 'express';
import multer from 'multer';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/requireRole';
import { findClientById } from '../repositories/mongoClientAuthRepo';
import { createPhoto } from '../repositories/mongoPhotoRepo';
import { stripImageMetadata } from '../services/photoBytes';
import { storePrivatePhoto } from '../services/photoFiles';

/**
 * Upload routes
 *
 * POST /api/upload/checkin-photo  — one photo, client only
 * POST /api/upload/photos         — up to 3 photos, client only
 *
 * The file is checked by its real bytes (JPG, PNG or HEIC only). The original
 * name is dropped. EXIF and GPS are removed before the file is stored.
 * The response is a private link, /api/photos/<id>, not a public /uploads path.
 * A coach cannot upload into a client's record.
 */

const router = Router();
const MAX_BYTES = 5 * 1024 * 1024;

const uploadSingle = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES, files: 1 },
});
const uploadBatch = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES, files: 3 },
});

function handleMulterError(err: unknown, res: Response): boolean {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            res.status(400).json({ success: false, error: 'Photo must be under 5 MB.' });
            return true;
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
            res.status(400).json({ success: false, error: 'Maximum 3 photos per check-in.' });
            return true;
        }
        res.status(400).json({ success: false, error: 'Photo could not be uploaded.' });
        return true;
    }
    if (err) {
        res.status(400).json({ success: false, error: 'Photo could not be uploaded.' });
        return true;
    }
    return false;
}

function clientIdFrom(req: AuthenticatedRequest): string {
    return req.coach?.clientId || req.coach?.sub || '';
}

async function saveOne(clientId: string, bytes: Buffer): Promise<{ id: string; url: string } | null> {
    const stored = await storePrivatePhoto(bytes);
    if (!stored) return null;
    const client = await findClientById(clientId);
    const coachId = typeof client?.coach_id === 'string' && client.coach_id ? client.coach_id : null;
    const id = stored.storageName.split('.')[0];
    await createPhoto({
        id,
        client_id: clientId,
        coach_id: coachId,
        created_at: new Date(),
        type: stored.mime,
        size: stored.size,
        storage_name: stored.storageName,
    });
    return { id, url: `/api/photos/${id}` };
}

// POST /api/upload/checkin-photo
// Field name: "photo"
router.post(
    '/checkin-photo',
    authMiddleware,
    requireRole('client'),
    (req, res, next) => {
        uploadSingle.single('photo')(req, res, (err: unknown) => {
            if (handleMulterError(err, res)) return;
            next();
        });
    },
    async (req: AuthenticatedRequest, res: Response) => {
        const file = req.file;
        if (!file || !file.buffer || file.buffer.length === 0) {
            res.status(400).json({ success: false, error: 'No photo received.' });
            return;
        }
        const saved = await saveOne(clientIdFrom(req), file.buffer);
        if (!saved) {
            res.status(400).json({ success: false, error: 'Photo must be a JPG, PNG, or HEIC image.' });
            return;
        }
        console.log('[Upload] 1 photo stored');
        res.status(201).json({ success: true, id: saved.id, url: saved.url });
    },
);

// POST /api/upload/photos
// Field name: "photos"
router.post(
    '/photos',
    authMiddleware,
    requireRole('client'),
    (req, res, next) => {
        uploadBatch.array('photos', 3)(req, res, (err: unknown) => {
            if (handleMulterError(err, res)) return;
            next();
        });
    },
    async (req: AuthenticatedRequest, res: Response) => {
        const files = (req.files as Express.Multer.File[] | undefined) ?? [];
        if (files.length === 0) {
            res.status(400).json({ success: false, error: 'No photos received.' });
            return;
        }
        for (const file of files) {
            if (!file.buffer || file.buffer.length === 0 || !stripImageMetadata(file.buffer)) {
                res.status(400).json({ success: false, error: 'Photo must be a JPG, PNG, or HEIC image.' });
                return;
            }
        }
        const clientId = clientIdFrom(req);
        const saved: Array<{ id: string; url: string }> = [];
        for (const file of files) {
            if (!file.buffer || file.buffer.length === 0) {
                res.status(400).json({ success: false, error: 'Photo must be a JPG, PNG, or HEIC image.' });
                return;
            }
            const one = await saveOne(clientId, file.buffer);
            if (!one) {
                res.status(400).json({ success: false, error: 'Photo must be a JPG, PNG, or HEIC image.' });
                return;
            }
            saved.push(one);
        }
        console.log(`[Upload] ${saved.length} photo(s) stored`);
        res.status(201).json({
            success: true,
            photos: saved,
            urls: saved.map(item => item.url),
        });
    },
);

export default router;
