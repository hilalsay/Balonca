/**
 * Text out of a PDF, in the browser (phase 4): the file never leaves the device, only the text becomes a library
 * text like a pasted one. PDF.js is loaded on first use (its own chunk and worker, served from this site).
 * No OCR: a scanned PDF (pictures of pages) has no text to read.
 */
export const PDF_MAX_BYTES = 20 * 1024 * 1024;
export const PDF_MAX_PAGES = 300;

export class PdfError extends Error {
  constructor(public readonly code: 'too-big' | 'too-many-pages' | 'no-text' | 'bad-file') { super(code); }
}

/** Lines of PDF text as a reader expects them: words split over a line end joined again, page breaks as blank lines. */
export function tidyPdfText(pages: string[]): string {
  return pages
    .map((p) => p.replace(/[ \t ]+/g, ' ').replace(/(\p{Ll})-\n(\p{Ll})/gu, '$1$2').replace(/ *\n */g, '\n').trim())
    .filter(Boolean)
    .join('\n\n');
}

export async function pdfText(file: File, onPage?: (done: number, total: number) => void): Promise<{ text: string; title: string }> {
  if (file.size > PDF_MAX_BYTES) throw new PdfError('too-big');
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  let doc;
  try {
    // isEvalSupported: false — PDF.js never builds code from the file; disableFontFace: no fonts from the file either.
    doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, disableFontFace: true }).promise;
  } catch { throw new PdfError('bad-file'); }
  try {
    if (doc.numPages > PDF_MAX_PAGES) throw new PdfError('too-many-pages');
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      pages.push(content.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : '') : '')).join(''));
      onPage?.(i, doc.numPages);
    }
    const text = tidyPdfText(pages);
    if (!/\p{L}{2}/u.test(text)) throw new PdfError('no-text');
    const info = (await doc.getMetadata().catch(() => null))?.info as { Title?: unknown } | undefined;
    return { text, title: typeof info?.Title === 'string' ? info.Title.trim().slice(0, 120) : '' };
  } finally { void doc.destroy(); }
}
