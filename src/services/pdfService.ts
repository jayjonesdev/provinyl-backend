import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';

/* Branded, text-only collection appraisal (PDF-EXPORT-PLAN §Pillar 3).
 * Contains only user-authored figures (Your Value, purchase price, note) and
 * CC0 catalog fields — NO Discogs marketplace data. The Estimated Value is
 * referenced via a "view in app" note, never printed. */

const ACCENT = '#5f5c74';
const INK = '#1a1a22';
const DIM = '#6b6b78';
const FAINT = '#9a9aa4';
const LINE = '#e3e2e8';
const CARD = '#f6f6f9';

// Embedded Unicode fonts (Noto Sans) — pdfkit's built-in Helvetica is WinAnsi
// only, so non-Latin release names render as garbage. Falls back to Helvetica
// if the font files aren't present at runtime. (Copied to dist/assets by build.)
const FONT_DIR = path.join(__dirname, '../assets/fonts');
function loadFont(file: string): Buffer | null {
  try {
    return fs.readFileSync(path.join(FONT_DIR, file));
  } catch {
    return null;
  }
}
const FONTS = {
  regular: loadFont('NotoSans-Regular.ttf'),
  bold: loadFont('NotoSans-Bold.ttf'),
  italic: loadFont('NotoSans-Italic.ttf'),
};
const HAS_FONTS = Boolean(FONTS.regular && FONTS.bold && FONTS.italic);
const REG = HAS_FONTS ? 'Sans' : 'Helvetica';
const BOLD = HAS_FONTS ? 'Sans-Bold' : 'Helvetica-Bold';
const ITALIC = HAS_FONTS ? 'Sans-Italic' : 'Helvetica-Oblique';

function registerFonts(doc: PDFDocument): void {
  if (!HAS_FONTS) return;
  doc.registerFont('Sans', FONTS.regular!);
  doc.registerFont('Sans-Bold', FONTS.bold!);
  doc.registerFont('Sans-Italic', FONTS.italic!);
}

export interface AppraisalItem {
  artist: string;
  title: string;
  year: number;
  format: string;
  label: string;
  catno: string;
  media: string;
  sleeve: string;
  value: number;
  purchasePrice?: number;
  note?: string;
  image?: Buffer;
}

export interface AppraisalData {
  owner: string;
  name?: string;
  email?: string;
  generatedAt: Date;
  items: AppraisalItem[];
}

/** A small vinyl-record mark: dark disc, tinted label, light centre hole. */
function drawVinyl(doc: PDFDocument, cx: number, cy: number, r: number): void {
  doc.save();
  doc.circle(cx, cy, r).fillColor(INK).fill();
  doc.circle(cx, cy, r * 0.36).fillColor(ACCENT).fill();
  doc.circle(cx, cy, r * 0.08).fillColor('#ffffff').fill();
  doc.restore();
}

function money(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

const NOTICE =
  'This application uses Discogs’ API but is not affiliated with, sponsored or endorsed by Discogs. ' +
  '“Discogs” is a trademark of Zink Media, LLC. Data provided by Discogs.';

export function buildAppraisalPdf(stream: NodeJS.WritableStream, data: AppraisalData): void {
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
  registerFonts(doc);
  doc.pipe(stream);

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;

  const itemCount = data.items.length;
  const totalValue = data.items.reduce((s, i) => s + (i.value || 0), 0);
  const totalCost = data.items.reduce((s, i) => s + (i.purchasePrice || 0), 0);
  const gain = totalValue - totalCost;
  const withValue = data.items.filter((i) => i.value > 0).length;

  // ===== Cover / summary =====
  // Vinyl mark + "pro·vinyl" wordmark.
  const markR = 11;
  drawVinyl(doc, left + markR, 64 + markR, markR);
  doc.font(BOLD).fontSize(22);
  doc.fillColor(INK).text('pro', left + markR * 2 + 10, 64, { continued: true });
  doc.fillColor(ACCENT).text('vinyl');

  doc.moveDown(1.1);
  doc.fillColor(INK).font(BOLD).fontSize(26).text('Collection Appraisal', left, doc.y);
  doc.moveDown(0.3);
  // Owner identity: real name (if Discogs exposes it) then username · date, then email.
  const idLine = [data.name, data.owner].filter(Boolean).join('  ·  ');
  doc.font(REG).fontSize(11).fillColor(DIM).text(`${idLine}  ·  ${fmtDate(data.generatedAt)}`);
  if (data.email) {
    doc.font(REG).fontSize(10).fillColor(FAINT).text(data.email);
  }

  let y = doc.y + 22;
  const cardW = (width - 16) / 2;
  drawStat(doc, left, y, cardW, 'Items', String(itemCount));
  drawStat(doc, left + cardW + 16, y, cardW, 'Total stated value', money(totalValue));
  y += 64;
  drawStat(doc, left, y, cardW, 'Cost basis', money(totalCost));
  drawStat(doc, left + cardW + 16, y, cardW, 'Unrealized gain / loss', (gain >= 0 ? '+' : '') + money(gain));
  y += 64 + 10;

  doc.font(REG).fontSize(9.5).fillColor(DIM);
  doc.text(`${withValue} of ${itemCount} items have a stated value.`, left, y, { width });
  doc.moveDown(0.5);
  doc.text("‘Your Value’ figures are owner-supplied and not a certified appraisal.", { width });
  doc.moveDown(0.4);
  doc.font(BOLD).fillColor(ACCENT).text(
    'For the current estimated market value of your collection, open it in the ProVinyl app — estimates update over time and aren’t printed here.',
    { width },
  );
  // Required Discogs notice (placed here once, with room, rather than wrapping in
  // the page footer — which would overflow and spawn blank pages).
  doc.moveDown(1.2);
  doc.font(REG).fontSize(8).fillColor(FAINT).text(NOTICE, { width });

  // ===== Inventory =====
  doc.addPage();
  y = doc.page.margins.top;
  doc.font(BOLD).fontSize(13).fillColor(INK).text('Inventory', left, y);
  y = doc.y + 8;
  doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).lineWidth(1).stroke();
  y += 12;

  const bottom = doc.page.height - 66;
  if (itemCount === 0) {
    doc.font(REG).fontSize(11).fillColor(DIM).text('No items in your collection yet.', left, y, { width });
  }
  for (const it of data.items) {
    const rowH = 46 + (it.note ? 12 : 0);
    if (y + rowH > bottom) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    y = drawRow(doc, left, right, y, it);
  }

  // ===== Footer on every page =====
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    // Writing below the content area triggers pdfkit's auto page break (which
    // was spawning blank pages). Zero this page's bottom margin so the footer
    // renders in the margin without paginating.
    doc.page.margins.bottom = 0;
    const fy = doc.page.height - 38;
    doc.font(REG).fontSize(7.5).fillColor(FAINT);
    doc.text('Data provided by Discogs.', left, fy, { width: width - 80, lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, right - 70, fy, { width: 70, align: 'right', lineBreak: false });
  }

  doc.end();
}

function drawStat(doc: PDFDocument, x: number, y: number, w: number, label: string, value: string): void {
  doc.save();
  doc.roundedRect(x, y, w, 52, 8).fillColor(CARD).fill();
  doc.fillColor(DIM).font(REG).fontSize(8.5).text(label.toUpperCase(), x + 13, y + 11, {
    width: w - 26,
    characterSpacing: 0.5,
    lineBreak: false,
  });
  doc.fillColor(INK).font(BOLD).fontSize(17).text(value, x + 13, y + 24, {
    width: w - 26,
    lineBreak: false,
  });
  doc.restore();
}

function drawRow(doc: PDFDocument, left: number, right: number, y: number, it: AppraisalItem): number {
  const valX = right - 130;

  // Optional thumbnail on the far left; text shifts right to make room.
  let textLeft = left;
  const imgSize = 40;
  if (it.image) {
    try {
      doc.image(it.image, left, y, { fit: [imgSize, imgSize] });
      textLeft = left + imgSize + 12;
    } catch {
      // Unreadable image — skip it rather than abort the whole document.
    }
  }
  const textW = valX - textLeft - 12;

  // Right: stated value + paid
  doc.font(BOLD).fontSize(14).fillColor(it.value > 0 ? INK : '#b8b8c0')
    .text(it.value > 0 ? money(it.value) : '—', valX, y, { width: 130, align: 'right', lineBreak: false });
  if (it.purchasePrice) {
    doc.font(REG).fontSize(8.5).fillColor(DIM)
      .text('Paid ' + money(it.purchasePrice), valX, y + 18, { width: 130, align: 'right', lineBreak: false });
  }

  // Left: title / artist · year / label · format · condition
  doc.font(BOLD).fontSize(12).fillColor(INK)
    .text(it.title || 'Untitled', textLeft, y, { width: textW, lineBreak: false, ellipsis: true });
  const sub = [it.artist, it.year ? String(it.year) : ''].filter(Boolean).join('  ·  ');
  doc.font(REG).fontSize(9).fillColor(DIM)
    .text(sub, textLeft, y + 15, { width: textW, lineBreak: false, ellipsis: true });
  const meta = [
    [it.label, it.catno].filter(Boolean).join(' '),
    it.format,
    `Media: ${it.media} / Sleeve: ${it.sleeve}`,
  ].filter((s) => s && s.trim()).join('   ·   ');
  doc.font(REG).fontSize(9).fillColor(FAINT)
    .text(meta, textLeft, y + 28, { width: textW, lineBreak: false, ellipsis: true });

  let ny = y + 44;
  if (it.note) {
    doc.font(ITALIC).fontSize(8.5).fillColor(DIM)
      .text(it.note, textLeft, ny, { width: textW, lineBreak: false, ellipsis: true });
    ny += 12;
  }
  // Keep rows at least as tall as the thumbnail.
  if (it.image) ny = Math.max(ny, y + imgSize);
  doc.moveTo(left, ny + 2).lineTo(right, ny + 2).strokeColor(LINE).lineWidth(0.5).stroke();
  return ny + 10;
}
