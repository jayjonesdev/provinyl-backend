import sharp from 'sharp';

/* Validate + normalize user-uploaded images. Re-encoding to JPEG strips EXIF
 * metadata (critically GPS, which would leak the owner's location) and any
 * payloads hidden in the original file, and produces a thumbnail for the grid
 * and the PDF. */

export type SniffedType = 'image/jpeg' | 'image/png' | 'image/heic';

/** Identify an image by its magic bytes — never trust the client Content-Type. */
export function sniffImageType(buf: Buffer): SniffedType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return 'image/png';
  }
  // HEIC/HEIF: an ISO-BMFF "ftyp" box near the start with an image brand.
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp') {
    const brand = buf.toString('latin1', 8, 12);
    if (['heic', 'heix', 'mif1', 'msf1', 'hevc'].includes(brand)) return 'image/heic';
  }
  return null;
}

export interface ProcessedImage {
  full: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
  contentType: 'image/jpeg';
}

const THUMB_PX = 400;

/** Re-encode to a clean JPEG + thumbnail. `.rotate()` (no args) bakes in EXIF
 * orientation and then drops the metadata. */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  const meta = await sharp(input).metadata();
  const full = await sharp(input).rotate().jpeg({ quality: 85 }).toBuffer();
  const thumb = await sharp(input)
    .rotate()
    .resize(THUMB_PX, THUMB_PX, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toBuffer();
  return {
    full,
    thumb,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    contentType: 'image/jpeg',
  };
}
