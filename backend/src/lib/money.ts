/**
 * Money helpers. We store everything in minor units (pence) as integers.
 */
export const toMinor = (major: number): number => Math.round(major * 100);
export const toMajor = (minor: number): number => Math.round(minor) / 100;
export const formatGBP = (minor: number): string =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(toMajor(minor));
