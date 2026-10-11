// Readable text on user-chosen colors (result cards, accent buttons, OG images). Pure, so the
// player, the shared result page and the OG route all pick the same ink.

export const DARK_INK = "#15172b";
export const LIGHT_INK = "#ffffff";

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a #rrggbb color, or null when it is not one. */
export function luminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) return null;
  const n = parseInt(m[1], 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio between two #rrggbb colors (1 when either is not one). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return 1;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Dark or white text, whichever has the higher WCAG contrast ratio on `bg`. */
export function readableInk(bg: string): string {
  if (luminance(bg) === null) return LIGHT_INK;
  return contrast(bg, DARK_INK) > contrast(bg, LIGHT_INK) ? DARK_INK : LIGHT_INK;
}
