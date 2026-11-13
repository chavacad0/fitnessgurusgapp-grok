/**
 * Private progress photos (AUD-002, SEC-09, AUD-008).
 *
 *   TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm run test:photos
 *
 * Safety:
 *   - Connects only through TEST_MONGODB_URI. It never reads MONGO_URI from .env.
 *   - Uses the database fitnessgurusg_photos_test.
 *   - Refuses to delete unless NODE_ENV is "test" and the name ends with "_test".
 *   - Drops only that test database.
 *   - Photo files are written under a temporary folder, not the project uploads folder.
 *
 * Fixture labels only. No real client and no real location.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { assertSafeTestDatabase } from './assertSafeTestDatabase';

const TEST_MONGODB_URI = process.env.TEST_MONGODB_URI;
const TEST_DB = 'fitnessgurusg_photos_test';
const SENTINEL = 'GPSLatitude-FIXTURE';

if (!TEST_MONGODB_URI) {
    throw new Error(
        'TEST_MONGODB_URI is not set. This suite does not read MONGO_URI or .env. ' +
        'Point TEST_MONGODB_URI at a local MongoDB server.',
    );
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-photos-'));
const publicDir = path.join(scratch, 'uploads');
const privateDir = path.join(scratch, 'private');
fs.mkdirSync(publicDir, { recursive: true });
fs.mkdirSync(privateDir, { recursive: true });

process.env.MONGO_URI = TEST_MONGODB_URI;
process.env.DB_NAME = TEST_DB;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'photo-test-secret-not-real';
process.env.PHOTO_PUBLIC_DIR = publicDir;
process.env.PHOTO_PRIVATE_DIR = privateDir;
assertSafeTestDatabase(TEST_DB);

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: unknown, detail?: unknown): void {
    if (cond) {
        passed++;
        console.log(`  ✅ ${name}`);
    } else {
        failures.push(name);
        console.log(`  ❌ ${name}`, detail !== undefined ? JSON.stringify(detail) : '');
    }
}
function section(title: string): void {
    console.log(`\n▶ ${title}`);
}

function sgtToday(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

/** A tiny JPEG with an EXIF APP1 segment that carries the sentinel. */
function jpegWithExif(): Buffer {
    const payload = Buffer.concat([
        Buffer.from('Exif\0\0', 'ascii'),
        Buffer.from(SENTINEL, 'ascii'),
    ]);
    const app1 = Buffer.alloc(4 + payload.length);
    app1[0] = 0xff;
    app1[1] = 0xe1;
    app1.writeUInt16BE(payload.length + 2, 2);
    payload.copy(app1, 4);
    const rest = Buffer.from(
        'ffd8ffe000104a46494600010100000100010000ffda000800010001003f00ffd9',
        'hex',
    );
    return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, rest.subarray(2)]);
}

function box(type: string, payload: Buffer): Buffer {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(8 + payload.length, 0);
    header.write(type, 4, 'ascii');
    return Buffer.concat([header, payload]);
}

/**
 * A minimal HEIC-shaped file. The EXIF item payload is the sentinel.
 * This is a fixture for the stripper, not a camera photo.
 */
function heicWithExif(): Buffer {
    const exifPayload = Buffer.from(SENTINEL, 'ascii');
    const imagePayload = Buffer.from('IMAGEDATA', 'ascii');
    const infe = box('infe', Buffer.concat([
        Buffer.from([2, 0, 0, 0]),
        Buffer.from([0x00, 0x01]),
        Buffer.from([0x00, 0x00]),
        Buffer.from('Exif', 'ascii'),
        Buffer.from([0]),
    ]));
    const iinf = box('iinf', Buffer.concat([
        Buffer.from([0, 0, 0, 0]),
        Buffer.from([0x00, 0x01]),
        infe,
    ]));
    const offsetSlot = Buffer.alloc(4);
    const iloc = box('iloc', Buffer.concat([
        Buffer.from([0, 0, 0, 0]),
        Buffer.from([0x44, 0x00]),
        Buffer.from([0x00, 0x01]),
        Buffer.from([0x00, 0x01]),
        Buffer.from([0x00, 0x00]),
        Buffer.from([0x00, 0x01]),
        offsetSlot,
        (() => {
            const len = Buffer.alloc(4);
            len.writeUInt32BE(exifPayload.length, 0);
            return len;
        })(),
    ]));
    const meta = box('meta', Buffer.concat([
        Buffer.from([0, 0, 0, 0]),
        iinf,
        iloc,
    ]));
    const ftyp = box('ftyp', Buffer.concat([
        Buffer.from('heic', 'ascii'),
        Buffer.from([0, 0, 0, 0]),
        Buffer.from('heic', 'ascii'),
    ]));
    const mdat = box('mdat', Buffer.concat([exifPayload, imagePayload]));
    const file = Buffer.concat([ftyp, meta, mdat]);
    const exifAt = ftyp.length + meta.length + 8;
    const placeholderAt = ftyp.length + 8 + 4 + iinf.length + 8 + (iloc.length - 8 - 8);
    file.writeUInt32BE(exifAt, placeholderAt);
    return file;
}

type ApiResult = { status: number; body: Record<string, unknown> | null; raw: Buffer };

async function main(): Promise<void> {
    const jwt = (await import('jsonwebtoken')).default;
    const express = (await import('express')).default;
    const { getDb, closeDb } = await import('../db/mongo');
    const routes = (await import('../api/routes')).default;
    const uploadRoutes = (await import('../api/uploadRoutes')).default;
    const photoRoutes = (await import('../api/photoRoutes')).default;
    const { stripImageMetadata } = await import('../services/photoBytes');
    const { migrateLegacyPhotos, migrationWillApply } = await import('../services/photoMigration');

    const db = await getDb();
    if (db.databaseName !== TEST_DB) {
        throw new Error(`Connected to "${db.databaseName}" instead of "${TEST_DB}".`);
    }
    assertSafeTestDatabase(db.databaseName);
    await db.dropDatabase();

    const app = express();
    app.use(express.json());
    app.use('/api', routes);
    app.use('/api/upload', uploadRoutes);
    app.use('/api/photos', photoRoutes);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const secret = process.env.JWT_SECRET as string;
    const sign = (payload: Record<string, string>) => jwt.sign(payload, secret, { expiresIn: '1h' });

    const clientA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const clientB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const coachA = 'coach-a-id';
    const coachB = 'coach-b-id';
    await db.collection('clients').insertMany([
        { id: clientA, name: 'Client A', email: 'a@test.local', coach_id: coachA },
        { id: clientB, name: 'Client B', email: 'b@test.local', coach_id: coachB },
    ]);
    const tokenA = sign({ sub: clientA, email: 'a@test.local', role: 'client' });
    const tokenB = sign({ sub: clientB, email: 'b@test.local', role: 'client' });
    const coachAToken = sign({ sub: coachA, email: 'coach.a@test.local', role: 'coach' });
    const coachBToken = sign({ sub: coachB, email: 'coach.b@test.local', role: 'coach' });
    const noRole = sign({ sub: clientA, email: 'a@test.local', role: 'none' });

    const call = async (method: string, url: string, body?: unknown, token?: string): Promise<ApiResult> => {
        const res = await fetch(base + url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const raw = Buffer.from(await res.arrayBuffer());
        let parsed: Record<string, unknown> | null = null;
        try { parsed = JSON.parse(raw.toString('utf8')) as Record<string, unknown>; } catch { /* image body */ }
        return { status: res.status, body: parsed, raw };
    };

    const upload = async (bytes: Buffer, filename: string, mime: string, token?: string): Promise<ApiResult> => {
        const form = new FormData();
        form.append('photo', new File([new Uint8Array(bytes)], filename, { type: mime }));
        const res = await fetch(`${base}/api/upload/checkin-photo`, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: form,
        });
        const raw = Buffer.from(await res.arrayBuffer());
        let parsed: Record<string, unknown> | null = null;
        try { parsed = JSON.parse(raw.toString('utf8')) as Record<string, unknown>; } catch { /* */ }
        return { status: res.status, body: parsed, raw };
    };

    try {
        section('EXIF strip');
        const jpeg = jpegWithExif();
        check('fixture contains EXIF', jpeg.includes(Buffer.from('Exif\0\0')) && jpeg.includes(SENTINEL));
        const strippedJpeg = stripImageMetadata(jpeg);
        check('stored jpeg fixture has no EXIF', !!strippedJpeg && !strippedJpeg.includes(SENTINEL) && !strippedJpeg.includes(Buffer.from('Exif\0\0')));
        check('stored jpeg still starts like a jpeg', !!strippedJpeg && strippedJpeg[0] === 0xff && strippedJpeg[1] === 0xd8);

        const heic = heicWithExif();
        check('heic fixture contains the sentinel', heic.includes(SENTINEL));
        const strippedHeic = stripImageMetadata(heic);
        check('heic fixture sentinel is cleared', !!strippedHeic && !strippedHeic.includes(SENTINEL) && strippedHeic.includes('IMAGEDATA'));

        section('Upload rules');
        const noTokenUpload = await upload(jpeg, 'original-name.jpg', 'image/jpeg');
        check('no token gives 401', noTokenUpload.status === 401, noTokenUpload.status);

        const coachUpload = await upload(jpeg, 'original-name.jpg', 'image/jpeg', coachAToken);
        check('coach upload gives 403', coachUpload.status === 403, coachUpload.status);

        const svg = await upload(
            Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
            'evil.svg',
            'image/svg+xml',
            tokenA,
        );
        check('an .svg upload gives 400', svg.status === 400, svg.status);

        const html = await upload(
            Buffer.from('<!DOCTYPE html><html><body>no</body></html>'),
            'page.html',
            'text/html',
            tokenA,
        );
        check('an .html upload gives 400', html.status === 400, html.status);

        const disguised = await upload(
            Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
            'photo.jpg',
            'image/jpeg',
            tokenA,
        );
        check('svg bytes with a jpg name gives 400', disguised.status === 400, disguised.status);

        const beforePrivate = fs.readdirSync(privateDir);
        check('rejected uploads wrote no file', beforePrivate.length === 0, beforePrivate.length);

        const saved = await upload(jpeg, 'original-name.jpg', 'image/jpeg', tokenA);
        check('client upload gives 201', saved.status === 201, saved.status);
        const photoUrl = String(saved.body?.url ?? '');
        const photoId = String(saved.body?.id ?? '');
        check('response is a private photo link', photoUrl === `/api/photos/${photoId}` && /^[0-9a-f-]{36}$/.test(photoId));

        const names = fs.readdirSync(privateDir);
        check('original name was dropped', names.length === 1 && !names[0].includes('original') && names[0].endsWith('.jpg'));
        const stored = fs.readFileSync(path.join(privateDir, names[0]));
        check('EXIF is absent in the stored fixture', !stored.includes(SENTINEL) && !stored.includes(Buffer.from('Exif\0\0')));

        section('Who can open a photo');
        const openMissing = await call('GET', `/api/photos/${photoId}`);
        check('no token gives 401', openMissing.status === 401, openMissing.status);

        const otherClient = await call('GET', `/api/photos/${photoId}`, undefined, tokenB);
        check('another client gives 403', otherClient.status === 403, otherClient.status);

        const otherCoach = await call('GET', `/api/photos/${photoId}`, undefined, coachBToken);
        check('another coach gives 403', otherCoach.status === 403, otherCoach.status);

        const noRoleGet = await call('GET', `/api/photos/${photoId}`, undefined, noRole);
        check('token without a role gives 401', noRoleGet.status === 401, noRoleGet.status);

        const owner = await call('GET', `/api/photos/${photoId}`, undefined, tokenA);
        check('owning client can open the photo', owner.status === 200 && owner.raw[0] === 0xff && !owner.raw.includes(SENTINEL), owner.status);

        const ownCoach = await call('GET', `/api/photos/${photoId}`, undefined, coachAToken);
        check('owning coach can open the photo', ownCoach.status === 200 && !ownCoach.raw.includes(SENTINEL), ownCoach.status);

        const oldLink = await call('GET', '/uploads/original-name.jpg');
        check('old /uploads URL does not load', oldLink.status === 404, oldLink.status);
        const serverSrc = fs.readFileSync(path.join(process.cwd(), 'src/server.ts'), 'utf8');
        check('server does not mount a public uploads route', !serverSrc.includes('express.static'));

        section('Check-in keeps the photo');
        const today = sgtToday();
        const posted = await call('POST', `/api/clients/${clientA}/checkins`, {
            date: today,
            type: 'MANUAL',
            metrics: { energy: 6, hunger: 4 },
            photos: [photoUrl],
        }, tokenA);
        const postedCheckin = posted.body?.checkin as { photos?: string[] } | undefined;
        check('check-in save returns the photo link', posted.status === 200 && postedCheckin?.photos?.[0] === photoUrl, posted.status);

        const listed = await call('GET', `/api/clients/${clientA}/checkins`, undefined, tokenA);
        const rows = listed.body?.checkins as Array<{ photos?: string[] }> | undefined;
        check('check-in record still has the photo', rows?.[0]?.photos?.[0] === photoUrl, listed.status);

        const stolen = await call('POST', `/api/clients/${clientB}/checkins`, {
            date: today,
            type: 'MANUAL',
            metrics: { energy: 5, hunger: 5 },
            photos: [photoUrl],
        }, tokenB);
        check('another client cannot attach the photo', stolen.status === 400, stolen.status);

        section('Migration');
        check('dry run is the default', migrationWillApply(['node', 'migrate-photos.ts']) === false);
        check('apply is explicit', migrationWillApply(['node', 'migrate-photos.ts', '--apply']) === true);
        check('both flags do not apply', migrationWillApply(['--apply', '--dry-run']) === false);

        const legacyName = 'legacy.jpg';
        const legacyPath = path.join(publicDir, legacyName);
        const legacyBytes = jpegWithExif();
        fs.writeFileSync(legacyPath, legacyBytes);
        fs.writeFileSync(path.join(publicDir, 'orphan.jpg'), jpegWithExif());
        fs.writeFileSync(path.join(publicDir, 'notes.txt'), Buffer.from('not a photo'));
        await db.collection('checkins').insertOne({
            client_id: clientA,
            date: '2020-01-02',
            type: 'MANUAL',
            photos: [`/uploads/${legacyName}`],
        });

        const photosBefore = await db.collection('photos').countDocuments({ legacy_sha256: { $exists: true } });
        const privateBefore = fs.readdirSync(privateDir).sort();
        const dry = await migrateLegacyPhotos({ db, publicDir, privateDir, apply: false });
        check('dry run would move the owned file only', dry.mode === 'dry-run' && dry.would_move === 1 && dry.moved === 0, dry);
        check('dry run leaves the unknown owner', dry.owner_unknown === 1, dry);
        check('dry run leaves the non-photo', dry.not_a_photo === 1, dry);
        check('dry run changes no file bytes', fs.readFileSync(legacyPath).equals(legacyBytes));
        check('dry run writes no private file', fs.readdirSync(privateDir).sort().join() === privateBefore.join());
        check('dry run writes no photo record', (await db.collection('photos').countDocuments({ legacy_sha256: { $exists: true } })) === photosBefore);
        const dryCheckin = await db.collection('checkins').findOne({ client_id: clientA, date: '2020-01-02' });
        check('dry run leaves the old reference', Array.isArray(dryCheckin?.photos) && dryCheckin.photos[0] === `/uploads/${legacyName}`);

        const applied = await migrateLegacyPhotos({ db, publicDir, privateDir, apply: true });
        check('apply moves one file', applied.moved === 1 && applied.would_move === 0, applied);
        check('apply removes the public file', !fs.existsSync(legacyPath));
        check('unknown owner stays in place', fs.existsSync(path.join(publicDir, 'orphan.jpg')));
        check('non-photo stays in place', fs.existsSync(path.join(publicDir, 'notes.txt')));
        const legacyRows = await db.collection('photos').find({ legacy_sha256: { $exists: true } }).toArray();
        check('apply creates one photo record', legacyRows.length === 1 && legacyRows[0].client_id === clientA);
        const legacyId = String(legacyRows[0].id);
        const movedCheckin = await db.collection('checkins').findOne({ client_id: clientA, date: '2020-01-02' });
        check('apply updates the check-in reference', Array.isArray(movedCheckin?.photos) && movedCheckin.photos[0] === `/api/photos/${legacyId}`);
        const movedName = fs.readdirSync(privateDir).find(name => name.startsWith(legacyId));
        const movedBytes = movedName ? fs.readFileSync(path.join(privateDir, movedName)) : Buffer.alloc(0);
        check('migrated file has no EXIF', movedBytes.length > 0 && !movedBytes.includes(SENTINEL));

        fs.writeFileSync(legacyPath, legacyBytes);
        await db.collection('checkins').updateOne(
            { client_id: clientA, date: '2020-01-02' },
            { $set: { photos: [`/uploads/${legacyName}`] } },
        );
        const again = await migrateLegacyPhotos({ db, publicDir, privateDir, apply: true });
        const legacyRowsAgain = await db.collection('photos').find({ legacy_sha256: { $exists: true } }).toArray();
        check('second apply moves nothing new', again.moved === 0 && again.already_migrated === 1, again);
        check('second apply does not duplicate the record', legacyRowsAgain.length === 1 && String(legacyRowsAgain[0].id) === legacyId);
        check('second apply removes the public file again', !fs.existsSync(legacyPath));
        const finalCheckin = await db.collection('checkins').findOne({ client_id: clientA, date: '2020-01-02' });
        check('second apply keeps a single private link', Array.isArray(finalCheckin?.photos) && finalCheckin.photos.length === 1 && finalCheckin.photos[0] === `/api/photos/${legacyId}`);
    } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
        assertSafeTestDatabase(db.databaseName);
        await db.dropDatabase();
        await closeDb();
        fs.rmSync(scratch, { recursive: true, force: true });
    }

    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length > 0) {
        console.log(failures.join('\n'));
        process.exit(1);
    }
}

main().catch(err => {
    const message = err instanceof Error ? err.message : String(err);
    if (/mongodb(\+srv)?:\/\//i.test(message)) {
        console.error('Photo tests failed before finishing. The database address was not printed.');
    } else {
        console.error(message);
    }
    process.exit(1);
});
