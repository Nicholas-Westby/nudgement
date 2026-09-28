import type { BudgetVerdict } from "./budget-object";

export interface BudgetBinding {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): { fetch(request: Request): Promise<Response> };
}

export interface BudgetClientOptions {
  /** Name of the durable object instance that holds the counters. */
  instance?: string;
  /** How many times a failed call is retried before giving up. */
  retries?: number;
  /** Delay before the first retry, doubled for each one after it. */
  retryDelayMs?: number;
  /** Base URL for the internal requests sent to the durable object. */
  baseUrl?: string;
}

const DEFAULT_OPTIONS: Required<BudgetClientOptions> = {
  instance: "chat-budget",
  retries: 0,
  retryDelayMs: 100,
  baseUrl: "https://chat-budget.internal",
};

async function call(
  ns: BudgetBinding,
  path: string,
  body: Record<string, unknown>,
  options: BudgetClientOptions = {}
): Promise<unknown> {
  const { instance, retries, retryDelayMs, baseUrl } = { ...DEFAULT_OPTIONS, ...options };
  const stub = ns.get(ns.idFromName(instance));

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      console.log(`chat budget: POST ${path} (attempt ${attempt + 1} of ${retries + 1})`);
      const res = await stub.fetch(
        new Request(`${baseUrl}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      );
      const result = await res.json();
      console.log(`chat budget: ${path} answered ${res.status}`, result);
      return result;
    } catch (error) {
      lastError = error;
      console.warn(`chat budget: ${path} failed on attempt ${attempt + 1}`, error);
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

export async function checkBudget(
  ns: BudgetBinding,
  day: string,
  visitor: string,
  options?: BudgetClientOptions
): Promise<BudgetVerdict> {
  console.log(`chat budget: checking day=${day} visitor=${visitor}`);
  try {
    const verdict = (await call(ns, "/check", { day, visitor }, options)) as BudgetVerdict;
    console.log("chat budget: check verdict", verdict);
    return verdict;
  } catch (error) {
    // Fail closed: if the counter is unreachable, spend nothing.
    console.error("chat budget: check failed, failing closed", error);
    return { ok: false, reason: "daily" };
  }
}

export async function chargeBudget(
  ns: BudgetBinding,
  day: string,
  visitor: string,
  options?: BudgetClientOptions
): Promise<BudgetVerdict> {
  console.log(`chat budget: charging day=${day} visitor=${visitor}`);
  try {
    const verdict = (await call(ns, "/charge", { day, visitor }, options)) as BudgetVerdict;
    console.log("chat budget: charge verdict", verdict);
    return verdict;
  } catch (error) {
    console.error("chat budget: charge failed, failing closed", error);
    return { ok: false, reason: "daily" };
  }
}

export async function spendNeurons(
  ns: BudgetBinding,
  day: string,
  neurons: number,
  options?: BudgetClientOptions
): Promise<void> {
  console.log(`chat budget: recording ${neurons} neurons for ${day}`);
  try {
    await call(ns, "/spend", { day, neurons }, options);
    console.log("chat budget: spend recorded");
  } catch (error) {
    // Accounting only. Never fail a reply the visitor already received.
    console.error("chat budget: spend failed, ignoring", error);
  }
}
