/**
 * (#360) Every addition id is `add-` and lower-case words. No built-in exercise or gym item id starts
 * with `add-` (tests/catalog360.test.ts), so an addition can never take a built-in id. No imports here:
 * stored-data validation reads it too.
 */
export const ADDITION_ID = /^add-[a-z0-9]+(-[a-z0-9]+)*$/;
export const isAdditionId = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 48 && ADDITION_ID.test(value);
