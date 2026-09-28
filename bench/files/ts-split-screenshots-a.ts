/**
 * Split tall product-page screenshots at their midpoint and lay the top and
 * bottom halves side by side so they read better in the slideshow viewport.
 * Reads from public/images/usconec/, writes back to the same filename, and
 * leaves a small white gutter between the two halves.
 */

import sharp from "sharp";
import { join } from "node:path";
import { access, rename } from "node:fs/promises";
import { constants } from "node:fs";

// ============================================================================
// Configuration
// ============================================================================

/** Output formats the splitter can write. */
type OutputFormat = "png" | "jpeg" | "webp";

/** An RGB color. */
interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/** Options that control how an image is split. */
interface SplitOptions {
  /** Width of the gap between the two halves, in pixels. */
  gutterPx: number;
  /** Color of the gutter and any uncovered canvas. */
  background: RgbColor;
  /** Format of the written image. */
  format: OutputFormat;
  /** Suffix for the temporary file written before the rename. */
  tempSuffix: string;
  /** When true, report what would happen without writing anything. */
  dryRun: boolean;
}

const DEFAULT_OPTIONS: SplitOptions = {
  gutterPx: 40,
  background: { r: 255, g: 255, b: 255 },
  format: "png",
  tempSuffix: ".tmp.png",
  dryRun: false,
};

const TARGETS = [
  "public/images/usconec/product-mt-ferrule.png",
  "public/images/usconec/product-ibc-brand-solvent.png",
];

// ============================================================================
// Types
// ============================================================================

/** Width and height of an image. */
interface Dimensions {
  width: number;
  height: number;
}

/** The outcome of processing one image. */
interface SplitResult {
  file: string;
  status: "split" | "skipped" | "dry-run";
  before?: Dimensions;
  after?: Dimensions;
  reason?: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Checks whether a file exists.
 * @param path - The path to check.
 * @returns True if the file exists.
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads an image's dimensions.
 * @param path - The image to read.
 * @returns The dimensions, or null when sharp cannot report them.
 */
async function readDimensions(path: string): Promise<Dimensions | null> {
  const meta = await sharp(path).metadata();
  if (!meta.width || !meta.height) {
    return null;
  }
  return { width: meta.width, height: meta.height };
}

/**
 * Extracts a full-width horizontal band from an image.
 * @param path - The source image.
 * @param top - The first row of the band.
 * @param width - The width of the band.
 * @param height - The height of the band.
 * @param format - The encoding of the returned buffer.
 * @returns The encoded band.
 */
async function extractBand(
  path: string,
  top: number,
  width: number,
  height: number,
  format: OutputFormat
): Promise<Buffer> {
  console.log(`  extracting ${width}x${height} band at y=${top}`);
  return sharp(path)
    .extract({ left: 0, top, width, height })
    .toFormat(format)
    .toBuffer();
}

// Previous approach: scale the whole screenshot down instead of splitting it.
// async function shrinkToFit(path: string, maxHeight: number) {
//   const resized = await sharp(path).resize({ height: maxHeight }).png().toBuffer();
//   await sharp(resized).toFile(path);
// }

// ============================================================================
// Splitter
// ============================================================================

/**
 * Splits tall images in half and places the halves side by side.
 */
class ImageSplitter {
  private readonly options: SplitOptions;

  constructor(options: Partial<SplitOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Splits one image in place.
   * @param path - Absolute path of the image.
   * @param label - The name shown in log output.
   * @returns What happened to the image.
   */
  async split(path: string, label: string): Promise<SplitResult> {
    console.log(`Processing ${label}...`);

    if (!(await fileExists(path))) {
      throw new Error(`Input file not found: ${path}`);
    }

    const dimensions = await readDimensions(path);
    if (!dimensions) {
      console.error(`skip ${label}: missing dimensions`);
      return { file: label, status: "skipped", reason: "missing dimensions" };
    }

    const { width: w, height: h } = dimensions;
    const halfH = Math.floor(h / 2);
    const outW = w * 2 + this.options.gutterPx;
    console.log(`  source is ${w}x${h}, output will be ${outW}x${halfH}`);

    if (this.options.dryRun) {
      console.log(`  dry run: not writing ${label}`);
      return { file: label, status: "dry-run", before: dimensions, after: { width: outW, height: halfH } };
    }

    // Extract the top half
    const top = await extractBand(path, 0, w, halfH, this.options.format);

    // Extract the bottom half
    const bottom = await extractBand(path, halfH, w, halfH, this.options.format);

    // Compose the two halves side by side on a new canvas
    const tmp = path + this.options.tempSuffix;
    await sharp({
      create: {
        width: outW,
        height: halfH,
        channels: 3,
        background: this.options.background,
      },
    })
      .composite([
        { input: top, left: 0, top: 0 },
        { input: bottom, left: w + this.options.gutterPx, top: 0 },
      ])
      .toFormat(this.options.format)
      .toFile(tmp);
    console.log(`  wrote temporary file ${tmp}`);

    // Replace the original with the new image
    await rename(tmp, path);
    console.log(`✓ ${label}: ${w}x${h} → ${outW}x${halfH}`);

    return { file: label, status: "split", before: dimensions, after: { width: outW, height: halfH } };
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log("Starting screenshot split");
  console.log(`Options: ${JSON.stringify(DEFAULT_OPTIONS)}`);

  const splitter = new ImageSplitter();
  const results: SplitResult[] = [];

  for (const rel of TARGETS) {
    const path = join(import.meta.dir, "..", rel);
    try {
      results.push(await splitter.split(path, rel));
    } catch (error) {
      console.error(`Failed to process ${rel}:`, error);
      throw error;
    }
  }

  const split = results.filter((result) => result.status === "split").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  console.log(`Done. Split ${split}, skipped ${skipped}.`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
