// Pure helpers for the client address that abuse limits are keyed on (hashed in http.ts).

/**
 * The address abuse limits are keyed on. IPv6 clients usually control a whole /64
 * (one per phone on Korean carriers), so they are grouped by that prefix.
 */
export function clientNetwork(raw: string): string {
  const ip = raw.trim().toLowerCase().replace(/^\[|\](:\d+)?$/g, "").replace(/%.*$/, "");
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/.exec(ip);
  if (v4?.[1]) return v4[1];
  if (!ip.includes(":")) return ip;
  const [head = "", tail] = ip.split("::", 2);
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const groups = tail === undefined ? headParts : [...headParts, ...Array<string>(Math.max(0, 8 - headParts.length - tailParts.length)).fill("0"), ...tailParts];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return ip;
  return `${groups
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(":")}::/64`;
}

