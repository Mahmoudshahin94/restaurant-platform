import {
  PAPER_WIDTH_DOTS,
  type ReceiptDocument,
  encodeRasterJob,
  rgbaToMonoBitmap,
} from '@pos/receipts';
import { invoke } from '@tauri-apps/api/core';
import type { PrinterConfig } from '../stores/preferences';
import { isTauri } from './device';

const FONT_FAMILY = "'Noto Sans Arabic Variable', 'Inter Variable', system-ui, sans-serif";

/** Splits text into lines that fit `maxWidth` on the canvas (word wrap, long words kept whole). */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [''];
}

/**
 * Draws a receipt on a canvas exactly as it will print: the browser does Arabic shaping and
 * RTL layout, so receipts look the same on every printer (sent as an image).
 */
export async function renderReceiptCanvas(
  doc: ReceiptDocument,
  widthDots: number,
): Promise<HTMLCanvasElement> {
  if (typeof document !== 'undefined' && 'fonts' in document) await document.fonts.ready;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');

  const base = widthDots >= 576 ? 24 : 18;
  const pad = Math.round(base / 2);
  const inner = widthDots - pad * 2;
  const rtl = doc.direction === 'rtl';
  const startX = rtl ? widthDots - pad : pad;
  const endX = rtl ? pad : widthDots - pad;

  type Op = (y: number) => void;
  const ops: { height: number; draw: Op }[] = [];
  const font = (size: 'normal' | 'large', bold: boolean) =>
    `${bold ? '700' : '400'} ${size === 'large' ? Math.round(base * 1.35) : base}px ${FONT_FAMILY}`;

  ctx.direction = doc.direction;
  for (const block of doc.blocks) {
    if (block.kind === 'divider') {
      ops.push({
        height: base,
        draw: (y) => {
          ctx.fillRect(pad, y + base / 2, inner, 2);
        },
      });
    } else if (block.kind === 'spacer') {
      ops.push({ height: base * 2, draw: () => undefined });
    } else if (block.kind === 'text' || block.kind === 'qr') {
      const content =
        block.kind === 'text' ? block.text : [block.caption, block.data].filter(Boolean).join(' ');
      const f = block.kind === 'text' ? font(block.size, block.bold) : font('normal', false);
      ctx.font = f;
      const lineHeight = Math.round(parseInt(/\d+px/.exec(f)?.[0] ?? `${base}`, 10) * 1.4);
      for (const line of wrap(ctx, content, inner)) {
        const align = block.kind === 'text' ? block.align : 'center';
        ops.push({
          height: lineHeight,
          draw: (y) => {
            ctx.font = f;
            ctx.textAlign = align === 'center' ? 'center' : align;
            const x = align === 'center' ? widthDots / 2 : align === 'start' ? startX : endX;
            ctx.fillText(line, x, y + lineHeight * 0.75);
          },
        });
      }
    } else {
      const f = font(block.size, block.bold);
      ctx.font = f;
      const lineHeight = Math.round((block.size === 'large' ? base * 1.35 : base) * 1.4);
      const endWidth = ctx.measureText(block.end).width;
      const startLines = wrap(ctx, block.start, inner - endWidth - pad);
      startLines.forEach((line, index) => {
        ops.push({
          height: lineHeight,
          draw: (y) => {
            ctx.font = f;
            ctx.textAlign = 'start';
            ctx.fillText(line, startX, y + lineHeight * 0.75);
            if (index === 0) {
              ctx.textAlign = 'end';
              ctx.fillText(block.end, endX, y + lineHeight * 0.75);
            }
          },
        });
      });
    }
  }

  canvas.width = widthDots;
  canvas.height = Math.max(
    1,
    ops.reduce((sum, op) => sum + op.height, pad * 2),
  );
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.direction = doc.direction;
  let y = pad;
  for (const op of ops) {
    op.draw(y);
    y += op.height;
  }
  return canvas;
}

/** The ESC/POS raster job for a receipt (what a network printer receives). */
export async function receiptToEscPos(
  doc: ReceiptDocument,
  widthDots: number,
): Promise<Uint8Array> {
  const canvas = await renderReceiptCanvas(doc, widthDots);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return encodeRasterJob(rgbaToMonoBitmap(image.data, canvas.width, canvas.height));
}

/** Prints through the operating system's print dialog (any installed printer). */
async function printWithBrowser(
  doc: ReceiptDocument,
  widthDots: number,
  paperMm: number,
): Promise<void> {
  const canvas = await renderReceiptCanvas(doc, widthDots);
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  document.body.appendChild(frame);
  const frameDoc = frame.contentDocument;
  if (!frameDoc || !frame.contentWindow) throw new Error('Cannot open print frame');
  const style = frameDoc.createElement('style');
  style.textContent = `@page{size:${paperMm}mm auto;margin:0}body{margin:0}img{width:${paperMm}mm;display:block}`;
  frameDoc.head.appendChild(style);
  const image = frameDoc.createElement('img');
  const loaded = new Promise((resolve) => {
    image.onload = resolve;
  });
  image.src = canvas.toDataURL('image/png');
  frameDoc.body.appendChild(image);
  await loaded;
  frame.contentWindow.focus();
  frame.contentWindow.print();
  setTimeout(() => {
    frame.remove();
  }, 1000);
}

/**
 * The one entry point for receipt printing. Printer models are not hard-coded: the browser path
 * uses any OS printer; the network path speaks raw ESC/POS on port 9100 (desktop app only).
 */
export async function printReceipt(doc: ReceiptDocument, printer: PrinterConfig): Promise<void> {
  const widthDots = PAPER_WIDTH_DOTS[printer.paper];
  if (printer.kind === 'browser') {
    await printWithBrowser(doc, widthDots, printer.paper === '58mm' ? 58 : 80);
    return;
  }
  if (!isTauri()) throw new Error('DESKTOP_ONLY');
  const job = await receiptToEscPos(doc, widthDots);
  await invoke('print_raw', { host: printer.host, port: printer.port, data: Array.from(job) });
}
