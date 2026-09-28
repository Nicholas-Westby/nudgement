import type { BudgetVerdict } from "./budget-object";

export interface BudgetBinding {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): { fetch(request: Request): Promise<Response> };
}

const INSTANCE = "chat-budget";

async function call(
  ns: BudgetBinding,
  path: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const stub = ns.get(ns.idFromName(INSTANCE));
  const res = await stub.fetch(
    new Request(`https://chat-budget.internal${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  return res.json();
}

export async function checkBudget(
  ns: BudgetBinding,
  day: string,
  visitor: string
): Promise<BudgetVerdict> {
  try {
    return (await call(ns, "/check", { day, visitor })) as BudgetVerdict;
  } catch {
    // Fail closed: if the counter is unreachable, spend nothing.
    return { ok: false, reason: "daily" };
  }
}

export async function chargeBudget(
  ns: BudgetBinding,
  day: string,
  visitor: string
): Promise<BudgetVerdict> {
  try {
    return (await call(ns, "/charge", { day, visitor })) as BudgetVerdict;
  } catch {
    return { ok: false, reason: "daily" };
  }
}

export async function spendNeurons(
  ns: BudgetBinding,
  day: string,
  neurons: number
): Promise<void> {
  try {
    await call(ns, "/spend", { day, neurons });
  } catch {
    // Accounting only. Never fail a reply the visitor already received.
  }
}
