import { afterEach, describe, expect, it, vi } from "vitest";
import { contrast, DARK_INK, LIGHT_INK, readableInk } from "@/lib/color";
import { abuseLimits, PRODUCTS } from "@/lib/config";
import { clientNetwork } from "@/lib/ip";
import { couponCodeFor, nextPlan, parseSettings, SettingsSchema } from "@/lib/schema";

const DAY = 86_400_000;
const NOW = new Date("2026-10-11T03:00:00Z");
const inDays = (d: number) => new Date(NOW.getTime() + d * DAY);
const daysFromNow = (d: Date) => (d.getTime() - NOW.getTime()) / DAY;

describe("nextPlan", () => {
  const proDay = PRODUCTS.pro_month.amount / PRODUCTS.pro_month.days; // the dearest pro day
  const proYearDay = PRODUCTS.pro_year.amount / PRODUCTS.pro_year.days; // the cheapest pro day
  const agencyDay = PRODUCTS.agency_month.amount / PRODUCTS.agency_month.days;

  it("starts the product's plan when nothing is running", () => {
    for (const current of [
      { plan: "free" as const, expiresAt: null },
      { plan: "pro" as const, expiresAt: inDays(-1) },
      { plan: "agency" as const, expiresAt: null },
    ]) {
      const c = nextPlan(current, PRODUCTS.pro_month, NOW);
      expect(c).toMatchObject({ plan: "pro", kind: "start", convertedDays: 0 });
      expect(daysFromNow(c.expiresAt)).toBeCloseTo(30, 6);
    }
  });

  it("stacks days on the same tier after the current expiry", () => {
    const pro = nextPlan({ plan: "pro", expiresAt: inDays(10) }, PRODUCTS.pro_year, NOW);
    expect(pro).toMatchObject({ plan: "pro", kind: "extend" });
    expect(daysFromNow(pro.expiresAt)).toBeCloseTo(375, 6);
    const agency = nextPlan({ plan: "agency", expiresAt: inDays(5) }, PRODUCTS.agency_month, NOW);
    expect(agency).toMatchObject({ plan: "agency", kind: "extend" });
    expect(daysFromNow(agency.expiresAt)).toBeCloseTo(35, 6);
  });

  it("turns a pro purchase during agency into agency days worth what was paid", () => {
    const c = nextPlan({ plan: "agency", expiresAt: inDays(20) }, PRODUCTS.pro_month, NOW);
    expect(c.plan).toBe("agency");
    expect(c.kind).toBe("pro_as_agency");
    expect(c.convertedDays).toBeCloseTo(PRODUCTS.pro_month.amount / agencyDay, 6); // ≈ 9.87, not 30
    expect(daysFromNow(c.expiresAt)).toBeCloseTo(20 + (30 * 49000) / 149000, 6);
  });

  it("does not convert a campaign pass's concierge share into agency time", () => {
    const c = nextPlan({ plan: "agency", expiresAt: inDays(20) }, PRODUCTS.campaign, NOW);
    expect(c.kind).toBe("pro_as_agency");
    expect(c.convertedDays).toBeCloseTo((PRODUCTS.campaign.days * proDay) / agencyDay, 6);
    const year = nextPlan({ plan: "agency", expiresAt: inDays(20) }, PRODUCTS.pro_year, NOW);
    expect(year.convertedDays).toBeCloseTo(PRODUCTS.pro_year.amount / agencyDay, 6);
  });

  it("upgrades remaining pro time to agency at the cheapest pro day price, then adds the agency days", () => {
    const c = nextPlan({ plan: "pro", expiresAt: inDays(300) }, PRODUCTS.agency_month, NOW);
    expect(c.plan).toBe("agency");
    expect(c.kind).toBe("upgrade");
    expect(c.convertedDays).toBeCloseTo((300 * proYearDay) / agencyDay, 6);
    expect(daysFromNow(c.expiresAt)).toBeCloseTo(30 + 300 * ((468000 / 365) / (149000 / 30)), 6); // ≈ 107.4
    expect(daysFromNow(c.expiresAt)).toBeLessThan(300);
  });
});

describe("parseSettings", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  afterEach(() => warn.mockClear());

  it("resets only the invalid section and keeps the others", () => {
    const s = parseSettings({
      theme: { accent: "#f60", style: "night" },
      lead: { enabled: true, fields: ["email"], retentionDays: 90 },
      coupon: { enabled: true, code: "A", perResult: { r1: "B" } },
    });
    expect(s.theme).toEqual(SettingsSchema.shape.theme.parse(undefined));
    expect(s.lead).toMatchObject({ enabled: true, fields: ["email"], retentionDays: 90 });
    expect(s.coupon).toMatchObject({ enabled: true, code: "A", perResult: { r1: "B" } });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("settings.theme");
  });

  it("falls back per section for a bad lead section without touching the coupon", () => {
    const s = parseSettings({ lead: { enabled: true, retentionDays: 10 }, coupon: { enabled: true, code: "KEEP" }, cta: { enabled: "yes" } });
    expect(s.lead.enabled).toBe(false);
    expect(s.coupon.code).toBe("KEEP");
    expect(s.cta.enabled).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("returns full defaults for anything that is not an object", () => {
    for (const raw of [null, "x", 3, [1, 2]]) expect(parseSettings(raw)).toEqual(SettingsSchema.parse({}));
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("couponCodeFor", () => {
  const coupon = SettingsSchema.shape.coupon.parse({ enabled: true, code: "ALL", perResult: { r1: "ONE", r2: "" } });
  it("prefers the per-result code and falls back to the common one", () => {
    expect(couponCodeFor(coupon, "r1")).toBe("ONE");
    expect(couponCodeFor(coupon, "r2")).toBe("ALL");
    expect(couponCodeFor(coupon, null)).toBe("ALL");
    expect(couponCodeFor(coupon, "constructor")).toBe("ALL");
  });
  it("is null when there is no code at all", () => {
    expect(couponCodeFor({ ...coupon, code: "", perResult: {} }, "r1")).toBeNull();
  });
});

describe("readableInk", () => {
  it("picks dark text on light result colors and white on dark ones", () => {
    expect(readableInk("#f2a900")).toBe(DARK_INK);
    expect(readableInk("#ff5a36")).toBe(DARK_INK);
    expect(readableInk("#ffffff")).toBe(DARK_INK);
    expect(readableInk("#2f6fed")).toBe(LIGHT_INK);
    expect(readableInk("#15172b")).toBe(LIGHT_INK);
  });
  it("defaults to white for anything that is not #rrggbb", () => {
    expect(readableInk("red")).toBe(LIGHT_INK);
    expect(readableInk("#fff")).toBe(LIGHT_INK);
  });
  it("computes WCAG contrast ratios", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#777777")).toBeCloseTo(1, 5);
    expect(contrast("nope", "#ffffff")).toBe(1);
  });
});

describe("clientNetwork", () => {
  it("reduces IPv4 forms to the plain address", () => {
    expect(clientNetwork("203.0.113.7")).toBe("203.0.113.7");
    expect(clientNetwork(" 203.0.113.7:51234 ")).toBe("203.0.113.7");
    expect(clientNetwork("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });
  it("groups IPv6 by /64 so one client cannot rotate addresses", () => {
    expect(clientNetwork("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(clientNetwork("2001:DB8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(clientNetwork("[2001:db8:1:2::99]:443")).toBe("2001:db8:1:2::/64");
    expect(clientNetwork("2001:db8::1")).toBe("2001:db8:0:0::/64");
  });
  it("passes anything else through", () => {
    expect(clientNetwork("unknown")).toBe("unknown");
  });
});

describe("abuseLimits", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("scales every limit with RATE_LIMIT_SCALE and never goes below 1", () => {
    const base = abuseLimits();
    vi.stubEnv("RATE_LIMIT_SCALE", "100");
    expect(abuseLimits().generationsPerIpPerDay).toBe(base.generationsPerIpPerDay * 100);
    vi.stubEnv("RATE_LIMIT_SCALE", "0");
    expect(Object.values(abuseLimits()).every((n) => n === 1)).toBe(true);
    vi.stubEnv("RATE_LIMIT_SCALE", "abc");
    expect(abuseLimits()).toEqual(base);
  });
});
