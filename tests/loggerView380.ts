/**
 * (#380) What the logger shows for a set, read the way the lifter reads it. The focused set's weight and
 * reps are inputs on the card (read by their accessible name); every other set is a row in the list
 * below it, a button named "Set N, 135 lb × 8, edit". Tests read values here, not markup (lesson 27).
 */

const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const unesc = (text: string) => text.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'");

/** The list row's line for set `n`: "135 lb × 8", "— × 8", "BW × 12", "20 lb × 30s". */
export function rowLine(html: string, n: number): string | undefined {
  const line = html.match(new RegExp(`aria-label="Set ${n}, ([^"]*), edit"`))?.[1];
  return line === undefined ? undefined : unesc(line);
}

/**
 * The value a set's weight or reps shows, by the input's accessible name ("Set 2 weight, pounds each",
 * "Set 2 reps", "Set 2 seconds"): the card's input when that set is on the card, else its list row.
 * A weight reads as the number alone ('' when the set has none); reps or seconds as the number.
 */
export function shownValue(html: string, label: string): string | undefined {
  const input = html.match(new RegExp(`aria-label="${esc(label)}"[^>]*value="([^"]*)"`))?.[1];
  if (input !== undefined) return unesc(input);
  const parts = label.match(/^Set (\d+) (weight|reps|seconds)/);
  if (!parts) return undefined;
  const line = rowLine(html, Number(parts[1]));
  if (line === undefined) return undefined;
  const [weight, reps] = line.split(' × ');
  if (parts[2] !== 'weight') return reps.replace(/s$/, '');
  return weight === '—' ? '' : weight.replace(/ (lb|kg)$/, '');
}

/** The set the card shows: its number from the card's heading. */
export function focusedSet(html: string): number | undefined {
  const n = html.match(/<section class="lg-focus" aria-label="(?:[AB]\d+, )?set (\d+) of \d+"/i)?.[1];
  return n === undefined ? undefined : Number(n);
}

/** True when set `n` is logged: its row carries the "Set N logged" tick. */
export function isLogged(html: string, n: number): boolean {
  return new RegExp(`role="img" aria-label="Set ${n} logged"`).test(html);
}
