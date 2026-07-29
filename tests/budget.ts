// tests/budget.ts — wall-clock budget for the pathological-input guards.

/**
 * The guard tests assert semantically that a hostile document is neutralized;
 * the elapsed-time check beside each assertion is a regression canary for
 * quadratic blowup, not a performance target.
 *
 * `TEML_NESTING_PARSE_BUDGET_MS` raises every canary at once, because a loaded
 * machine can exceed the local budget while the algorithm is still linear. The
 * blowups these catch cost seconds, so a generous budget still fails loudly.
 */
export function parseGuardBudgetMs(fallbackMs: number): number {
  const configured = Number(process.env.TEML_NESTING_PARSE_BUDGET_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : fallbackMs;
}
