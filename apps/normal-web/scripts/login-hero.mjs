// Exports the sign-in hero picture (docs/login-hero-art.md) as two WebP files in public/login/.
// Source: assets/login-hero-src/2026-10-20-v2.png (ignored by git, kept on the author's disk).
// Usage: pnpm --filter @bp/normal-web login:hero
import { mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const SRC = fileURLToPath(new URL('../../../assets/login-hero-src/2026-10-20-v2.png', import.meta.url));
const OUT = fileURLToPath(new URL('../public/login/', import.meta.url));
const QUALITY = 82;

const TARGETS = [
  { width: 1536, file: 'hero-1536.webp', maxKb: 250 },
  { width: 768, file: 'hero-768.webp', maxKb: 90 },
];

await mkdir(OUT, { recursive: true });

let failed = false;
for (const { width, file, maxKb } of TARGETS) {
  const target = OUT + file;
  await sharp(SRC).resize(width).webp({ quality: QUALITY }).toFile(target);
  const kb = (await stat(target)).size / 1024;
  const over = kb > maxKb;
  if (over) failed = true;
  console.log(`${file}: ${width} px, quality ${QUALITY}, ${kb.toFixed(1)} KB (budget ${maxKb} KB)${over ? ' OVER BUDGET' : ''}`);
}

if (failed) {
  console.error('A picture is over its budget: lower QUALITY (76) and record it in docs/login-hero-art.md.');
  process.exit(1);
}
