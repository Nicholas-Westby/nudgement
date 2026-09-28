/**
 * Split tall product-page screenshots at their midpoint and lay the top and
 * bottom halves side by side so they read better in the slideshow viewport.
 * Reads from public/images/usconec/, writes back to the same filename, and
 * leaves a small white gutter between the two halves.
 */

import sharp from "sharp";
import { join } from "node:path";

const GUTTER_PX = 40;
const TARGETS = [
  "public/images/usconec/product-mt-ferrule.png",
  "public/images/usconec/product-ibc-brand-solvent.png",
];

for (const rel of TARGETS) {
  const path = join(import.meta.dir, "..", rel);
  const meta = await sharp(path).metadata();
  if (!meta.width || !meta.height) {
    console.error(`skip ${rel}: missing dimensions`);
    continue;
  }
  const { width: w, height: h } = meta;
  const halfH = Math.floor(h / 2);

  const top = await sharp(path)
    .extract({ left: 0, top: 0, width: w, height: halfH })
    .png()
    .toBuffer();

  const bottom = await sharp(path)
    .extract({ left: 0, top: halfH, width: w, height: halfH })
    .png()
    .toBuffer();

  const outW = w * 2 + GUTTER_PX;
  const tmp = path + ".tmp.png";
  await sharp({
    create: {
      width: outW,
      height: halfH,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite([
      { input: top, left: 0, top: 0 },
      { input: bottom, left: w + GUTTER_PX, top: 0 },
    ])
    .png()
    .toFile(tmp);

  const { rename } = await import("node:fs/promises");
  await rename(tmp, path);
  console.log(`✓ ${rel}: ${w}x${h} → ${outW}x${halfH}`);
}
