/**
 * Every rule the product knows about, in one array.
 *
 * That array is the extension point. Push a `Rule` onto it and the rule
 * appears in the mark panel, in the menu, in the CLI report and in the
 * published artifact with no other file edited — adding a rule must never
 * mean touching a component.
 */
import type { Mark, RuleId } from './types.ts';
import type { Ctx, Rule } from './rule.ts';
import { BAR_RULES } from './rules/bars.ts';
import { LINE_RULES } from './rules/lines.ts';
import { ENTRY_RULES } from './rules/entries.ts';

export const RULES: readonly Rule[] = [...BAR_RULES, ...LINE_RULES, ...ENTRY_RULES];

const BY_ID = new Map(RULES.map((r) => [r.id, r]));

export function ruleFor(id: RuleId): Rule | undefined {
  return BY_ID.get(id);
}

/** The ids that are on when nothing has been configured. */
export function defaultEnabled(): RuleId[] {
  return RULES.filter((r) => r.defaultOn).map((r) => r.id);
}

/**
 * Run the enabled rules and return their marks in session order.
 *
 * Sorted here rather than by each caller: the chart wants markers in time
 * order, the mark list reads top-down, and the CLI report is a table. One sort
 * over the merged output is cheaper than three, and makes the order a property
 * of detection rather than of whoever consumed it.
 */
export function detect(ctx: Ctx, enabled?: ReadonlySet<RuleId>): Mark[] {
  const out: Mark[] = [];
  // Ids must be unique: a verdict is keyed by one, and the mark list is a
  // keyed loop that throws outright on a duplicate. Rules are expected to
  // produce distinct ids and each is fixed when it does not — this is the
  // backstop that keeps the invariant true for every rule written later.
  const seen = new Set<string>();
  for (const rule of RULES) {
    if (enabled && !enabled.has(rule.id)) continue;
    for (const mark of rule.detect(ctx)) {
      if (seen.has(mark.id)) continue;
      seen.add(mark.id);
      out.push(mark);
    }
  }
  out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.rule < b.rule ? -1 : 1));
  return out;
}
