import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware';

/**
 * Upload Routes
 *
 * POST /api/upload/checkin-photo  — upload ONE photo, returns relative URL
 * POST /api/upload/photos         — batch upload (up to 3), returns relative URL array
 *
 * Returns RELATIVE paths (/uploads/filename.jpg) so the mobile app
 * composes the full URL as: `${BASE_URL}${url}`.
 * This avoids hardcoding the server host in backend responses.
 *
 * Storage: local disk (MVP). To move to S3/GCS, swap the multer storage engine —
 * all route logic stays the same.
 */

const router = Router();

// ── Ensure uploads directory exists ──────────────────────────────────────────

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    console.log('[Upload] Created uploads directory:', UPLOADS_DIR);
}

// ── Multer config ─────────────────────────────────────────────────────────────

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename:    (_req, file, cb) => {
        const ext  = path.extname(file.originalname).toLowerCase() || '.jpg';
        const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
        cb(null, name);
    },
});

function imageOnly(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
    if (!file.mimetype.startsWith('image/')) {
        cb(new Error('Only image files are allowed.'));
        return;
    }
    cb(null, true);
}

const uploadSingle = multer({ storage, fileFilter: imageOnly, limits: { fileSize: 5 * 1024 * 1024 } });
const uploadBatch  = multer({ storage, fileFilter: imageOnly, limits: { fileSize: 5 * 1024 * 1024, files: 3 } });

// ── Shared multer error handler ───────────────────────────────────────────────

function handleMulterError(err: any, res: Response): boolean {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE')  { res.status(400).json({ success: false, error: 'Photo must be under 5 MB.' }); return true; }
        if (err.code === 'LIMIT_FILE_COUNT') { res.status(400).json({ success: false, error: 'Maximum 3 photos per check-in.' }); return true; }
        res.status(400).json({ success: false, error: err.message }); return true;
    }
    if (err) { res.status(400).json({ success: false, error: err.message }); return true; }
    return false;
}

// ── POST /api/upload/checkin-photo ────────────────────────────────────────────
//    Upload-on-select: called immediately when user picks a photo.
//    Field name: "photo" (single file)
//    Returns:    { success: true, url: "/uploads/filename.jpg" }

router.post(
    '/checkin-photo',
    authMiddleware,
    (req: Request, res: Response, next: any) => {
        uploadSingle.single('photo')(req, res, (err: any) => {
            if (handleMulterError(err, res)) return;
            next();
        });
    },
    (req: AuthenticatedRequest, res: Response) => {
        const file = req.file;
        if (!file) {
            res.status(400).json({ success: false, error: 'No photo received.' });
            return;
        }
        const url = `/uploads/${file.filename}`;
        console.log(`[Upload] Photo saved by ${req.coach?.email}: ${url}`);
        res.status(201).json({ success: true, url });
    }
);

// ── POST /api/upload/photos ───────────────────────────────────────────────────
//    Batch upload (kept for compatibility).
//    Field name: "photos" (repeat for multiple files)
//    Returns:    { success: true, urls: string[] }

router.post(
    '/photos',
    authMiddleware,
    (req: Request, res: Response, next: any) => {
        uploadBatch.array('photos', 3)(req, res, (err: any) => {
            if (handleMulterError(err, res)) return;
            next();
        });
    },
    (req: AuthenticatedRequest, res: Response) => {
        const files = req.files as Express.Multer.File[];
        if (!files || files.length === 0) {
            res.status(400).json({ success: false, error: 'No photos received.' });
            return;
        }
        const urls = files.map(f => `/uploads/${f.filename}`);
        console.log(`[Upload] ${files.length} photo(s) saved by ${req.coach?.email}:`, urls);
        res.status(201).json({ success: true, urls });
    }
);

export default router;
