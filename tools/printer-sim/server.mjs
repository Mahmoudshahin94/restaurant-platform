// Simulated network receipt printer (ESC/POS over TCP, "port 9100") for development and tests.
//
//   node tools/printer-sim/server.mjs [port] [outDir]
//
// Each job is saved as <outDir>/job-<n>.bin (raw bytes) and, when it contains raster images
// (GS v 0), as <outDir>/job-<n>.pbm — a standard bitmap viewable in most image viewers.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { decodeRasterJob } from './decode.mjs';

const port = Number(process.argv[2] ?? 9100);
const outDir = process.argv[3] ?? join(import.meta.dirname, 'out');
mkdirSync(outDir, { recursive: true });

let jobNumber = 0;
const server = createServer((socket) => {
  const chunks = [];
  socket.on('data', (chunk) => chunks.push(chunk));
  socket.on('end', () => {
    jobNumber += 1;
    const bytes = Buffer.concat(chunks);
    const base = join(outDir, `job-${jobNumber}`);
    writeFileSync(`${base}.bin`, bytes);
    const image = decodeRasterJob(bytes);
    if (image) {
      writeFileSync(
        `${base}.pbm`,
        Buffer.concat([
          Buffer.from(`P4\n${image.width} ${image.height}\n`),
          Buffer.from(image.data),
        ]),
      );
    }
    console.log(
      `job ${jobNumber}: ${bytes.length} bytes${image ? `, raster ${image.width}x${image.height}` : ''}, cut=${image?.cut ?? false}`,
    );
  });
});
server.listen(port, () =>
  console.log(`printer simulator listening on :${port}, saving to ${outDir}`),
);
