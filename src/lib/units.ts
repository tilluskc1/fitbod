import type { Profile, Unit } from '../types.ts';

export const KG_PER_LB = 0.45359237;

export function unitOf(value: { unit?: Unit } | null | undefined): Unit {
  return value?.unit === 'lb' ? 'lb' : 'kg';
}

export function unitLabel(unit: Unit): string {
  return unit === 'lb' ? 'lb' : 'kg';
}

/** Convert a stored kilogram value into the display unit. */
export function toDisplay(kg: number, unit: Unit): number {
  return unit === 'lb' ? kg / KG_PER_LB : kg;
}

/** Convert a typed display value back into canonical kilograms. */
export function toKg(value: number, unit: Unit): number {
  const kg = unit === 'lb' ? value * KG_PER_LB : value;
  return Math.round(kg * 1000) / 1000;
}

/**
 * Owned loads typed as "10, 15 18" or "25lb, 35 lb" in the display unit, as sorted unique canonical kg.
 * A token that still reads as one of `stored` in this unit keeps that exact kg instead of re-converting.
 */
export function parseLoads(text: string, unit: Unit, stored: number[] = []): number[] {
  const kept = new Map(stored.map((kg) => [calibrationInputValue(kg, unit), kg]));
  const values = text
    .replace(/(\d)\s*(?:kgs?|lbs?)\b/gi, '$1 ')
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((token) => kept.get(token) ?? (Number(token) > 0 ? toKg(Number(token), unit) : NaN))
    .filter(Number.isFinite);
  return [...new Set(values)].sort((a, b) => a - b);
}

/** Display value snapped to a half unit so inputs read like real plates. */
export function displayValue(kg: number, unit: Unit): number {
  const value = toDisplay(kg, unit);
  return Math.round(value * 2) / 2;
}

/** Short label such as "15 kg", "22.5 kg" or "45 lb". */
export function formatWeight(kg: number, unit: Unit, options: { perSide?: boolean } = {}): string {
  if (kg <= 0) return 'Bodyweight';
  const value = displayValue(kg, unit);
  const text = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${text} ${unitLabel(unit)}${options.perSide ? ' each' : ''}`;
}

/** Format a recorded load without rounding it to a planned plate step. */
export function formatActualWeight(kg: number, unit: Unit, options: { perSide?: boolean } = {}): string {
  if (kg <= 0) return 'Bodyweight';
  return `${calibrationInputValue(kg, unit)} ${unitLabel(unit)}${options.perSide ? ' each' : ''}`;
}

/** Numeric display value without the unit, used for editable inputs. */
export function inputValue(kg: number, unit: Unit): string {
  if (kg <= 0) return '';
  const value = displayValue(kg, unit);
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Preserve a calibrated load's stored precision when opening its editor. */
export function calibrationInputValue(kg: number, unit: Unit): string {
  if (kg <= 0) return '';
  if (unit === 'kg') return String(kg);
  return String(Math.round(toDisplay(kg, unit) * 100) / 100);
}

/** Owned loads as editable text in the display unit, at the logger's precision. */
export function loadsInputText(kgs: number[] | undefined, unit: Unit): string {
  return (kgs ?? []).map((kg) => calibrationInputValue(kg, unit)).join(', ');
}

/**
 * Settings save for owned dumbbells. Null means save nothing: the text still shows what is stored
 * (so kg never drifts), or it is non-blank but holds no load (so a typo never wipes the rack).
 */
export function dumbbellLoadsPatch(text: string, profile: Profile): Partial<Profile> | null {
  const unit = unitOf(profile);
  const stored = profile.loads.Dumbbell ?? [];
  if (text.trim() === loadsInputText(stored, unit)) return null;
  const loads = parseLoads(text, unit, stored);
  if (text.trim() && loads.length === 0) return null;
  return { loads: { ...profile.loads, Dumbbell: loads } };
}
