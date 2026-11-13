/**
 * Photo bytes: real file type, and removal of EXIF / GPS.
 *
 * No image library is required. JPEG metadata lives in APP1 (EXIF and XMP)
 * and APP13 (IPTC) segments, which are removed without re-encoding the picture.
 * PNG metadata lives in text and eXIf chunks, which are removed the same way.
 * HEIC stores EXIF as an item inside the file; those bytes are cleared in place
 * so box sizes stay valid and the picture is not re-encoded.
 */

export type ImageKind = 'jpeg' | 'png' | 'heic';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs']);

export function mimeFor(kind: ImageKind): 'image/jpeg' | 'image/png' | 'image/heic' {
    if (kind === 'jpeg') return 'image/jpeg';
    if (kind === 'png') return 'image/png';
    return 'image/heic';
}

export function extFor(kind: ImageKind): 'jpg' | 'png' | 'heic' {
    if (kind === 'jpeg') return 'jpg';
    if (kind === 'png') return 'png';
    return 'heic';
}

export function detectImageType(buf: Buffer): ImageKind | null {
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
    if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) return 'png';
    if (isHeic(buf)) return 'heic';
    return null;
}

/**
 * Returns a copy with EXIF, XMP, IPTC and GPS removed.
 * Returns null when the file is not a supported image, or when HEIC metadata
 * cannot be cleared without risking the picture.
 */
export function stripImageMetadata(buf: Buffer): Buffer | null {
    const kind = detectImageType(buf);
    if (!kind) return null;
    if (kind === 'jpeg') return stripJpegMetadata(buf);
    if (kind === 'png') return stripPngMetadata(buf);
    return stripHeicMetadata(buf);
}

function isHeic(buf: Buffer): boolean {
    if (buf.length < 16) return false;
    if (buf.toString('ascii', 4, 8) !== 'ftyp') return false;
    const size = buf.readUInt32BE(0);
    const end = size >= 16 && size <= buf.length ? size : Math.min(buf.length, 64);
    // major brand at byte 8; minor version at 12 is skipped; brands follow.
    for (let i = 8; i + 4 <= end; i += 4) {
        if (i === 12) continue;
        if (HEIC_BRANDS.has(buf.toString('ascii', i, i + 4))) return true;
    }
    return false;
}

function stripJpegMetadata(input: Buffer): Buffer | null {
    if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return null;
    const chunks: Buffer[] = [input.subarray(0, 2)];
    let i = 2;
    while (i < input.length) {
        if (input[i] !== 0xff) return null;
        const markerStart = i;
        while (i < input.length && input[i] === 0xff) i++;
        if (i >= input.length) return null;
        const marker = input[i];
        i++;

        // Markers that have no length field.
        if (marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            chunks.push(input.subarray(markerStart, i));
            if (marker === 0xd9) return Buffer.concat(chunks);
            continue;
        }

        if (i + 2 > input.length) return null;
        const segLen = input.readUInt16BE(i);
        if (segLen < 2 || i + segLen > input.length) return null;
        const segEnd = i + segLen;

        // Start of scan: the rest of the file is the picture. Copy it unchanged.
        if (marker === 0xda) {
            chunks.push(input.subarray(markerStart));
            return Buffer.concat(chunks);
        }

        // APP1 = EXIF and XMP. APP13 = IPTC. COM = comment. GPS lives in these.
        const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe;
        if (!drop) chunks.push(input.subarray(markerStart, segEnd));
        i = segEnd;
    }
    return Buffer.concat(chunks);
}

function stripPngMetadata(input: Buffer): Buffer | null {
    if (input.length < 8 || !input.subarray(0, 8).equals(PNG_SIG)) return null;
    const chunks: Buffer[] = [PNG_SIG];
    let i = 8;
    while (i + 12 <= input.length) {
        const len = input.readUInt32BE(i);
        if (i + 12 + len > input.length) return null;
        const type = input.toString('ascii', i + 4, i + 8);
        const end = i + 12 + len;
        if (!PNG_DROP.has(type)) chunks.push(input.subarray(i, end));
        i = end;
        if (type === 'IEND') return Buffer.concat(chunks);
    }
    return null;
}

interface Box {
    type: string;
    start: number;
    header: number;
    end: number;
}

function readBoxes(buf: Buffer, start: number, end: number): Box[] | null {
    const boxes: Box[] = [];
    let i = start;
    while (i + 8 <= end) {
        let size = buf.readUInt32BE(i);
        const type = buf.toString('ascii', i + 4, i + 8);
        let header = 8;
        if (size === 1) {
            if (i + 16 > end) return null;
            const large = buf.readBigUInt64BE(i + 8);
            if (large > BigInt(end - i) || large < 16n) return null;
            size = Number(large);
            header = 16;
        } else if (size === 0) {
            size = end - i;
        }
        if (size < header || i + size > end) return null;
        boxes.push({ type, start: i, header, end: i + size });
        i += size;
    }
    return boxes;
}

function readInt(buf: Buffer, offset: number, size: number): number | null {
    if (size === 0) return 0;
    if (offset + size > buf.length) return null;
    if (size === 4) return buf.readUInt32BE(offset);
    if (size === 8) {
        const value = buf.readBigUInt64BE(offset);
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
        return Number(value);
    }
    if (size === 2) return buf.readUInt16BE(offset);
    if (size === 1) return buf[offset];
    return null;
}

function cString(buf: Buffer, offset: number, end: number): { text: string; next: number } | null {
    if (offset > end) return null;
    const stop = buf.indexOf(0, offset);
    if (stop === -1 || stop >= end) return null;
    return { text: buf.toString('utf8', offset, stop), next: stop + 1 };
}

/**
 * Clear HEIC EXIF and XMP item payloads. Offsets and box sizes stay the same,
 * so the picture data is not shifted. Returns null if the layout is not one
 * we can clear safely.
 */
function stripHeicMetadata(input: Buffer): Buffer | null {
    const top = readBoxes(input, 0, input.length);
    if (!top) return null;
    const meta = top.find(box => box.type === 'meta');
    if (!meta || meta.header + 4 > meta.end) return null;

    const children = readBoxes(input, meta.start + meta.header + 4, meta.end);
    if (!children) return null;
    const iinf = children.find(box => box.type === 'iinf');
    const iloc = children.find(box => box.type === 'iloc');
    if (!iinf || !iloc) return null;

    const exifIds = readExifItemIds(input, iinf);
    if (!exifIds) return null;
    if (exifIds.size === 0) return Buffer.from(input);

    const idat = top.find(box => box.type === 'idat');
    const idatPayload = idat ? idat.start + idat.header : null;
    const ranges = readItemRanges(input, iloc, exifIds, idatPayload);
    if (!ranges) return null;

    const out = Buffer.from(input);
    for (const range of ranges) {
        if (range.start < 0 || range.end < range.start || range.end > out.length) return null;
        out.fill(0, range.start, range.end);
    }
    return out;
}

function readExifItemIds(buf: Buffer, iinf: Box): Set<number> | null {
    const payload = iinf.start + iinf.header;
    if (payload + 6 > iinf.end) return null;
    const version = buf[payload];
    const countBytes = version === 0 ? 2 : 4;
    const listStart = payload + 4 + countBytes;
    if (listStart > iinf.end) return null;
    const entries = readBoxes(buf, listStart, iinf.end);
    if (!entries) return null;

    const ids = new Set<number>();
    for (const entry of entries) {
        if (entry.type !== 'infe') continue;
        const parsed = readInfe(buf, entry);
        if (!parsed) return null;
        const isExif = parsed.itemType === 'Exif';
        const isXmp = parsed.itemType === 'mime'
            && /xml|rdf|xmp/i.test(parsed.contentType);
        if (isExif || isXmp) ids.add(parsed.id);
    }
    return ids;
}

function readInfe(buf: Buffer, box: Box): { id: number; itemType: string; contentType: string } | null {
    const payload = box.start + box.header;
    if (payload + 8 > box.end) return null;
    const version = buf[payload];
    let offset = payload + 4;
    let id: number;
    if (version === 0 || version === 1 || version === 2) {
        if (offset + 2 > box.end) return null;
        id = buf.readUInt16BE(offset);
        offset += 2;
    } else if (version === 3) {
        if (offset + 4 > box.end) return null;
        id = buf.readUInt32BE(offset);
        offset += 4;
    } else {
        return null;
    }
    if (offset + 2 > box.end) return null;
    offset += 2; // item_protection_index
    if (version < 2) {
        return { id, itemType: '', contentType: '' };
    }
    if (offset + 4 > box.end) return null;
    const itemType = buf.toString('ascii', offset, offset + 4);
    offset += 4;
    const name = cString(buf, offset, box.end);
    if (!name) return null;
    offset = name.next;
    let contentType = '';
    if (itemType === 'mime') {
        const content = cString(buf, offset, box.end);
        if (!content) return null;
        contentType = content.text;
    }
    return { id, itemType, contentType };
}

function readItemRanges(
    buf: Buffer,
    iloc: Box,
    itemIds: Set<number>,
    idatPayload: number | null,
): Array<{ start: number; end: number }> | null {
    const payload = iloc.start + iloc.header;
    if (payload + 8 > iloc.end) return null;
    const version = buf[payload];
    const offsetSize = buf[payload + 4] >> 4;
    const lengthSize = buf[payload + 4] & 0x0f;
    const baseOffsetSize = buf[payload + 5] >> 4;
    const indexSize = version === 1 || version === 2 ? (buf[payload + 5] & 0x0f) : 0;
    let offset = payload + 6;
    if (version >= 2) {
        if (offset + 4 > iloc.end) return null;
    }
    const itemCount = version < 2 ? buf.readUInt16BE(offset) : buf.readUInt32BE(offset);
    offset += version < 2 ? 2 : 4;
    if (itemCount > 10000) return null;

    const ranges: Array<{ start: number; end: number }> = [];
    for (let i = 0; i < itemCount; i++) {
        const idSize = version < 2 ? 2 : 4;
        const id = readInt(buf, offset, idSize);
        if (id === null) return null;
        offset += idSize;
        let method = 0;
        if (version === 1 || version === 2) {
            const methodWord = readInt(buf, offset, 2);
            if (methodWord === null) return null;
            method = methodWord & 0x0f;
            offset += 2;
        }
        if (offset + 2 > iloc.end) return null;
        offset += 2; // data_reference_index
        const base = readInt(buf, offset, baseOffsetSize);
        if (base === null) return null;
        offset += baseOffsetSize;
        const extentCount = readInt(buf, offset, 2);
        if (extentCount === null || extentCount > 1000) return null;
        offset += 2;
        for (let j = 0; j < extentCount; j++) {
            if (indexSize > 0) {
                if (readInt(buf, offset, indexSize) === null) return null;
                offset += indexSize;
            }
            const extentOffset = readInt(buf, offset, offsetSize);
            if (extentOffset === null) return null;
            offset += offsetSize;
            const extentLength = readInt(buf, offset, lengthSize);
            if (extentLength === null) return null;
            offset += lengthSize;
            if (!itemIds.has(id)) continue;
            if (method !== 0 && method !== 1) return null;
            let start = base + extentOffset;
            if (method === 1) {
                if (idatPayload === null) return null;
                start = idatPayload + base + extentOffset;
            }
            ranges.push({ start, end: start + extentLength });
        }
    }
    return ranges;
}
