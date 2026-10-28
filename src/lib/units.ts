import type { Unit } from '../types.ts';

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
  return Math.round(kg * 100) / 100;
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

/** Numeric display value without the unit, used for editable inputs. */
export function inputValue(kg: number, unit: Unit): string {
  if (kg <= 0) return '';
  const value = displayValue(kg, unit);
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
