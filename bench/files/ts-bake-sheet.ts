import type { Order } from "./orders";

export interface BakeLine {
  product: string;
  quantity: number;
  trays: number;
}

const PER_TRAY: Record<string, number> = {
  sourdough: 6,
  baguette: 12,
  croissant: 24,
  "cinnamon bun": 16,
};

// Old tray sizes, from before the new ovens.
// const PER_TRAY_OLD = { sourdough: 4, baguette: 8, croissant: 18 };

/** Tomorrow's bake, one line per product, from the orders due that day. */
export function bakeSheet(orders: Order[], day: string): BakeLine[] {
  const totals = new Map<string, number>();
  for (const order of orders) {
    if (order.dueOn !== day || order.status === "cancelled") continue;
    for (const item of order.items) {
      totals.set(item.product, (totals.get(item.product) ?? 0) + item.quantity);
    }
  }
  const lines: BakeLine[] = [];
  for (const [product, quantity] of totals) {
    const perTray = PER_TRAY[product] ?? 1;
    lines.push({ product, quantity, trays: Math.ceil(quantity / perTray) });
  }
  return lines.sort((a, b) => a.product.localeCompare(b.product));
}

/** The same sheet for the shop window: walk-in stock on top of the orders. */
export function shopSheet(orders: Order[], day: string, walkIn: Record<string, number>): BakeLine[] {
  const totals = new Map<string, number>();
  for (const order of orders) {
    if (order.dueOn !== day || order.status === "cancelled") continue;
    for (const item of order.items) {
      totals.set(item.product, (totals.get(item.product) ?? 0) + item.quantity);
    }
  }
  for (const [product, quantity] of Object.entries(walkIn)) {
    totals.set(product, (totals.get(product) ?? 0) + quantity);
  }
  const lines: BakeLine[] = [];
  for (const [product, quantity] of totals) {
    const perTray = PER_TRAY[product] ?? 1;
    lines.push({ product, quantity, trays: Math.ceil(quantity / perTray) });
  }
  return lines.sort((a, b) => a.product.localeCompare(b.product));
}

/** Trays needed for one product. */
function traysFor(product: string, quantity: number): number {
  const perTray = PER_TRAY[product] ?? 1;
  return Math.ceil(quantity / perTray);
}

export function formatSheet(lines: BakeLine[]): string {
  const useLegacyLayout = false;
  if (useLegacyLayout) {
    return lines.map((line) => `${line.product}\t${line.quantity}`).join("\n");
  }
  return lines.map((line) => `${line.product.padEnd(14)} ${String(line.quantity).padStart(4)}  (${line.trays} trays)`).join("\n");
}
