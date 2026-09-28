// The shape of Wren's mark, in one place.
//
// Two things draw this tree: an SVG in the shipped HTML and a WebGL canvas
// that paints it growing. They have to agree, so both are built from the
// growth below rather than each carrying its own copy of the coordinates.
//
// Coordinates run -1 to 1 with y up, origin at the middle of a square box.

export interface Limb {
  /** Where it springs from. */
  a: readonly [number, number];
  /** Where it ends. */
  b: readonly [number, number];
  /** Half thickness, in the same units. */
  r: number;
  /** Its slice of the growth timeline, both 0 to 1. */
  t0: number;
  t1: number;
}

export interface Tip {
  /** Where the leaf sits. */
  p: readonly [number, number];
  /** When it opens, 0 to 1. */
  t0: number;
}

/** How many leaves the tree carries, one at the end of each free branch. */
const LEAVES = 9;

/**
 * Which tree you get. Every number below is drawn from this, so changing it
 * grows a different tree and changing nothing keeps this one exactly.
 */
const SEED = 20393371;

/** Limbs finish by here; the last leaf opens over what is left. */
const SPAN = 0.85;

/** How much of the box the tree fills, leaving room for the glow. */
const FIT = 0.94;

/**
 * How far the narrow axis may be stretched to fill the box. Trees come out
 * taller than they are wide, and a mark 22 pixels across cannot afford to
 * leave a third of itself empty on either side.
 */
const STRETCH = 1.4;

/** A small deterministic generator, so the tree is the same on every load. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface Raw {
  a: [number, number];
  b: [number, number];
  r: number;
  from: number;
  to: number;
}

export interface Tree {
  limbs: readonly Limb[];
  tips: readonly Tip[];
  /** Radius of a leaf once it has opened. */
  tipRadius: number;
}

/**
 * Grows a tree from the base up and fits it to the box.
 *
 * Every fork hands its budget of leaves to its children, so the total comes
 * out at exactly nine however the angles fall. The child with the largest
 * share carries on nearest the parent's heading and the rest swing out, which
 * is what stops the result looking like a candelabra.
 */
export function buildTree(seed: number): Tree {
  const rand = rng(seed);
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);

  const raw: Raw[] = [];
  const grown: { p: [number, number]; at: number }[] = [];

  const share = (total: number, kids: number): number[] => {
    const parts = new Array<number>(kids).fill(1);
    for (let left = total - kids; left > 0; left--) {
      parts[Math.floor(rand() * kids)] += 1;
    }
    return parts;
  };

  const branch = (
    start: [number, number],
    heading: number,
    length: number,
    width: number,
    budget: number,
    travelled: number,
    segments: number
  ) => {
    let at = start;
    let angle = heading;
    let far = travelled;

    // More than one segment bends the limb, which is what keeps a trunk from
    // looking like it was drawn with a ruler.
    for (let i = 0; i < segments; i++) {
      const step = length / segments;
      angle += between(-0.1, 0.1);
      const next: [number, number] = [
        at[0] + Math.cos(angle) * step,
        at[1] + Math.sin(angle) * step,
      ];
      raw.push({
        a: at,
        b: next,
        r: width * (1 - (0.14 * i) / segments),
        from: far,
        to: far + step,
      });
      at = next;
      far += step;
    }

    if (budget <= 1) {
      grown.push({ p: at, at: far });
      return;
    }

    const kids = budget >= 5 && rand() < 0.55 ? 3 : 2;
    const shares = share(budget, kids).sort((x, y) => y - x);
    let side = rand() < 0.5 ? 1 : -1;

    shares.forEach((part, i) => {
      const swing = i === 0 ? between(-0.2, 0.2) : side * between(0.42, 0.95);
      if (i > 0) side = -side;
      branch(
        at,
        angle + swing,
        length * between(0.62, 0.86),
        width * between(0.7, 0.84),
        part,
        far,
        1
      );
    });
  };

  branch([0, -1], Math.PI / 2 + between(-0.12, 0.12), 0.6, 0.085, LEAVES, 0, 3);

  /** Leaves are a shade fatter than the twigs that carry them. */
  const rawTip = Math.min(...raw.map((limb) => limb.r)) * 1.9;
  const reach = Math.max(...raw.map((limb) => limb.to));

  // Fit whatever grew into the box. The ink is padded by the widest thing
  // drawn on it so nothing clips at the edge.
  const pad = Math.max(rawTip, ...raw.map((limb) => limb.r));
  const xs = raw.flatMap((limb) => [limb.a[0], limb.b[0]]);
  const ys = raw.flatMap((limb) => [limb.a[1], limb.b[1]]);
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad;
  const maxY = Math.max(...ys) + pad;

  const even = (2 * FIT) / Math.max(maxX - minX, maxY - minY);
  const scaleX = Math.min((2 * FIT) / (maxX - minX), even * STRETCH);
  const scaleY = Math.min((2 * FIT) / (maxY - minY), even * STRETCH);
  // Limbs stay round while the tree spreads, so the stretch reads as a wider
  // canopy rather than as fatter branches.
  const scale = (scaleX + scaleY) / 2;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const place = (p: readonly [number, number]): [number, number] => [
    (p[0] - midX) * scaleX,
    (p[1] - midY) * scaleY,
  ];

  return {
    limbs: raw.map((limb) => ({
      a: place(limb.a),
      b: place(limb.b),
      r: limb.r * scale,
      t0: (limb.from / reach) * SPAN,
      t1: (limb.to / reach) * SPAN,
    })),
    tips: grown.map((tip) => ({ p: place(tip.p), t0: (tip.at / reach) * SPAN })),
    tipRadius: rawTip * scale,
  };
}

const TREE = buildTree(SEED);

export const LIMBS = TREE.limbs;
export const TIPS = TREE.tips;
export const TIP_RADIUS = TREE.tipRadius;

export interface Stroke {
  d: string;
  width: number;
}

/**
 * The same tree as SVG paths, for a square viewBox of the given size.
 *
 * Limbs are grouped into a few thicknesses rather than drawn one path each: a
 * trunk the same weight as a twig reads as a scribble at 22 pixels, and one
 * path per limb would put forty elements in the markup of every page. Run at
 * build time, so none of this ships to the browser.
 */
export function treeStrokes(size = 24, groups = 3, tree: Tree = TREE): Stroke[] {
  const half = size / 2;
  const at = (p: readonly [number, number]) =>
    `${(half + p[0] * half).toFixed(2)} ${(half - p[1] * half).toFixed(2)}`;

  const widths = tree.limbs.map((limb) => limb.r * 2 * half);
  const thinnest = Math.min(...widths);
  const thickest = Math.max(...widths);
  const span = thickest - thinnest || 1;

  const bands = new Map<number, { parts: string[]; widths: number[] }>();
  tree.limbs.forEach((limb, i) => {
    const band = Math.round(((widths[i] - thinnest) / span) * (groups - 1));
    const found = bands.get(band) ?? { parts: [], widths: [] };
    found.parts.push(`M${at(limb.a)} L${at(limb.b)}`);
    found.widths.push(widths[i]);
    bands.set(band, found);
  });

  return [...bands.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, found]) => ({
      d: found.parts.join(" "),
      width: Number(
        (found.widths.reduce((sum, w) => sum + w, 0) / found.widths.length).toFixed(2)
      ),
    }));
}
