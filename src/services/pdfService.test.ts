import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import sharp from 'sharp';
import { buildAppraisalPdf, AppraisalItem } from './pdfService';

/** Collect a PDF stream into a single Buffer. */
function render(items: AppraisalItem[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
    });
    sink.on('finish', () => resolve(Buffer.concat(chunks)));
    sink.on('error', reject);
    buildAppraisalPdf(sink, { owner: 'me', generatedAt: new Date('2026-06-10'), items });
  });
}

const item = (over: Partial<AppraisalItem> = {}): AppraisalItem => ({
  artist: 'John Coltrane',
  title: 'Blue Train',
  year: 1957,
  format: 'Vinyl, LP',
  label: 'Blue Note',
  catno: 'BLP 1577',
  media: 'Near Mint (NM or M-)',
  sleeve: 'Very Good (VG)',
  value: 250,
  purchasePrice: 80,
  note: 'Amoeba SF',
  ...over,
});

describe('buildAppraisalPdf', () => {
  it('produces a valid PDF document', async () => {
    const buf = await render([item(), item({ title: 'Giant Steps', value: 0, purchasePrice: undefined, note: undefined })]);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(1000);
    // %%EOF marks a complete document.
    expect(buf.subarray(-1024).toString('latin1')).toContain('%%EOF');
  });

  it('handles an empty collection', async () => {
    const buf = await render([]);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(500);
  });

  it('paginates a large collection without throwing', async () => {
    const many = Array.from({ length: 120 }, (_, i) => item({ title: `Record ${i}`, value: i }));
    const buf = await render(many);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(5000);
  });

  it('embeds an item thumbnail when provided', async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#5f5c74' } }).png().toBuffer();
    const buf = await render([item({ image: png })]);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.subarray(-1024).toString('latin1')).toContain('%%EOF');
  });

  it('survives an unreadable image buffer (no crash)', async () => {
    const buf = await render([item({ image: Buffer.from('not an image') })]);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
