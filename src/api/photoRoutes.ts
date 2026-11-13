import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware';
import { validateClientOwnership } from '../repositories/mongoClientRepo';
import { findPhotoById, PhotoRecord } from '../repositories/mongoPhotoRepo';
import { readPrivatePhoto } from '../services/photoFiles';

/**
 * GET /api/photos/:id
 *
 * The file is not public. Order of checks:
 *   1. A valid login token (401 if missing or invalid)
 *   2. The role is client or coach
 *   3. Ownership: the client sees their own photo, and the owning coach
 *      sees their client's photo. Everyone else gets 403.
 */
const router = Router();

router.get('/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    const photo = await findPhotoById(String(req.params['id'] ?? ''));
    if (!photo) {
        res.status(404).json({ success: false, error: 'Photo not found.' });
        return;
    }

    const allowed = await canView(req, photo);
    if (!allowed) {
        res.status(403).json({ success: false, error: 'Access denied.' });
        return;
    }

    const bytes = await readPrivatePhoto(photo.storage_name);
    if (!bytes) {
        res.status(404).json({ success: false, error: 'Photo not found.' });
        return;
    }

    res.setHeader('Content-Type', photo.type);
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.status(200).end(bytes);
});

async function canView(req: AuthenticatedRequest, photo: PhotoRecord): Promise<boolean> {
    const role = req.coach?.role;
    if (role === 'client') {
        const ownId = req.coach?.clientId || req.coach?.sub;
        return photo.client_id === ownId || photo.client_id === req.coach?.sub;
    }
    if (role === 'coach') {
        const coachId = req.coach?.sub ?? '';
        if (photo.coach_id && photo.coach_id === coachId) return true;
        const owned = await validateClientOwnership(photo.client_id, coachId);
        return owned !== null;
    }
    return false;
}

export default router;
