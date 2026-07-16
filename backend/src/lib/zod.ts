import { z } from 'zod';

/**
 * Optional boolean query parameter. Unlike z.coerce.boolean() (which does
 * Boolean(value) and turns the string "false" into `true`), this treats only
 * "true"/"1"/"yes"/"on" as true and "false"/"0"/"no"/"off" as false.
 */
export const queryBool = z.preprocess((v) => {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'boolean') return v;
  return ['true', '1', 'yes', 'on'].includes(String(v).trim().toLowerCase());
}, z.boolean().optional());
