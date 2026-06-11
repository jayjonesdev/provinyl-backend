// Minimal type shim for pdfkit — the upstream package ships no types and the
// project's dependency tree can't resolve @types/pdfkit. Declares only the
// subset of the API used by services/pdfService.ts (mirrors the disconnect shim).
declare module 'pdfkit' {
  interface PDFDocumentOptions {
    size?: string;
    margin?: number;
    bufferPages?: boolean;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type TextOptions = Record<string, any>;

  class PDFDocument {
    constructor(options?: PDFDocumentOptions);
    readonly page: {
      margins: { left: number; right: number; top: number; bottom: number };
      width: number;
      height: number;
    };
    y: number;

    pipe(dest: NodeJS.WritableStream): NodeJS.WritableStream;
    registerFont(name: string, src: string | Buffer): this;
    font(name: string): this;
    circle(x: number, y: number, radius: number): this;
    fontSize(size: number): this;
    fillColor(color: string): this;
    strokeColor(color: string): this;
    lineWidth(width: number): this;
    text(text: string, x: number, y: number, options?: TextOptions): this;
    text(text: string, options?: TextOptions): this;
    image(src: Buffer | string, x: number, y: number, options?: TextOptions): this;
    moveDown(lines?: number): this;
    moveTo(x: number, y: number): this;
    lineTo(x: number, y: number): this;
    stroke(): this;
    fill(color?: string): this;
    rect(x: number, y: number, w: number, h: number): this;
    roundedRect(x: number, y: number, w: number, h: number, r: number): this;
    save(): this;
    restore(): this;
    addPage(options?: PDFDocumentOptions): this;
    bufferedPageRange(): { start: number; count: number };
    switchToPage(n: number): this;
    end(): void;
  }

  export default PDFDocument;
}
