// The token radar's model (radar-5): one sealed snapshot of the protocol universe in, one ranked
// board of pre-token protocols out — and this time the pricing model is not asserted, it is
// FITTED to the snapshot's own traded protocols and TESTED out of sample before it prices a
// single launch.
//
// Radar-3 priced every launch from one hand-set recipe: a category's median market-cap-to-TVL
// ratio among its token-bearing peers, shrunk toward the universe median, times three
// adjustments (seven-day momentum, tokenless maturity, chain footprint) whose weights were
// chosen by argument. Radar-4 keeps that recipe as one candidate among five and makes the
// candidates compete on the only evidence available: the 128 protocols in the snapshot whose
// token already trades and whose market cap is recorded. Each candidate is refit 128 times,
// each time leaving one priced peer out, and asked to predict the peer it never saw; the
// candidate with the lowest median absolute log error wins, and the winner — whichever it is —
// prices the board. The contest, every candidate's score and the winner's coefficients are
// published in the dashboard's methodology, so the claim "the model follows from the snapshot's
// own figures" is a table a reader can check, not a sentence.
//
//   candidates (each predicts a peer's market cap from TVL, category, 7d change, age, chains):
//     flat        one universe median ratio, no adjustments            (the house starter's idea)
//     category    radar-3: shrunk category medians x adjustments
//     cat-adj     category medians of adjustment-divided ratios x adjustments
//     curve       a log-log size curve on adjustment-divided ratios x adjustments
//     curve-cat   the size curve plus shrunk per-category offsets x adjustments
//
// The winner is then refit 200 times on bootstrap resamples of the peer set (a fixed-seed
// generator, so the two grading runs write the same bytes), and every board row carries the
// range those refits support: the 10th–90th percentile of its implied value and the
// 5th–95th percentile of its rank. A point estimate with no range was radar-3's honesty layer;
// a range measured from refits is radar-4's.
//
// Around the fitted price, each row is cross-examined by three independent comparable lenses —
// its category's peers, the traded protocols on its main chain, and the traded protocols at its
// own scale — and the dashboard names the actual comparable protocols behind each lens, with
// their market caps, TVLs and ratios, so a reader can audit the evidence row by row instead of
// trusting an aggregate. Where the lenses disagree, the row is flagged and its confidence score
// falls; the score is a published formula over the distinct comparable count and the lenses'
// spread, never a hidden judgement.
//
// The farm plans are netted, not just listed: each row prices its own plan (the gas of its
// chain, over its own hold window) and states the cost beside the capital, the cost as a share
// of the implied value, and a verdict — farm, thin or skip — from thresholds stated in the
// methodology. And the universe is accounted for in full: every one of the snapshot's protocols
// is ranked on the board or listed in the already-launched set. Nothing is set aside.
//
// Radar-5 closes the one gap radar-4 left: radar-4 ranked only the pre-token protocols that
// stand alone, and set 144 aside as products of tokens that already trade — a wrapper, a
// bridged or staked product, a numbered version, an exchange's own entry. The watchlist the
// house publishes is a floor, never a ceiling, so radar-5 ranks all 342 pre-token protocols.
// A product row is priced honestly rather than hopefully: the fitted curve values the business
// its TVL describes, and then a product discount — a published constant per product class —
// cuts that value to what a token issued by the product itself could claim, because the assets
// parked in a wrapper belong to the parent token's holders, not to a new one. The discount,
// its class and its reason are printed on the row and in its detail view, never applied
// silently: the reader sees the curve's value, the factor and the result, and can disagree
// with the factor while keeping the value.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label, stated on the dashboard. */
export const MODEL_VERSION = 'radar-5';

/** The model's constants, stated on the dashboard so the claim can be re-run by hand. */
export const MODEL = {
  peer_shrink_k: 4,
  momentum_weight: 0.6,
  momentum_floor_pct: -50,
  momentum_cap_pct: 150,
  momentum_min_mult: 0.55,
  maturity_base: 0.75,
  maturity_range: 0.45,
  maturity_days: 1460,
  unknown_age_days: 300,
  footprint_per_chain: 0.03,
  footprint_max_extra_chains: 7,
  winsor_quantile: 0.9,
  multiple_cap: 3,
  curve_offset_cap_log10: 0.5,
  bootstrap_reps: 200,
  bootstrap_seed: 0x9e3779b9,
  scale_band: 3,
  lens_disagree_spread: 1.5,
  farm_cost_pct_max: 0.005,
  // The product discounts: the share of the fitted curve's value a token issued by a product
  // of an already-traded token could claim. The parked assets belong to the parent token's
  // holders; what is left for a new token is the product's own economics — thinnest for an
  // exchange's tracked reserves (customer assets, not a business seeking a launch), thin for
  // a wrapper or staking product (a fee and governance claim on other people's assets),
  // thicker for a bridge (a fee stream on flow through it) and thickest for a numbered
  // version of a traded protocol (a real business of its own, discounted because a second
  // token would split the parent's claim rather than add to it).
  haircut_wrapper: 0.2,
  haircut_bridge: 0.3,
  haircut_version: 0.35,
  haircut_exchange: 0.1,
} as const;

/** Categories whose members are a product of another asset, not a launch candidate of their own. */
const PRODUCT_CATEGORIES = new Set(['Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'Bridge', 'Canonical Bridge', 'CEX']);

/** Names that mark a pool or product of an existing protocol rather than the protocol itself. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether DefiLlama's record carries a token for this protocol (a market cap, an id or a symbol). */
export function recordsToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}

/** The four ways a pre-token record can be a product of a token that already trades. */
export type ProductClass = 'wrapper' | 'bridge' | 'version' | 'exchange';

/** One product classification: its class, the discount the class carries, and the reason in words. */
export interface ProductInfo {
  cls: ProductClass;
  haircut: number;
  reason: string;
}

/**
 * How this protocol is a product of a traded token, or null when it stands alone. The screen
 * is the snapshot's own markers — the same ones the house's watchlist rule reads: a product
 * category, a version marker at the end of the name, a whole word wrapped, staked or staking
 * in the name, or an exchange's name at its start. Radar-4 set the matches aside; radar-5
 * ranks them with the class's discount, so the screen now prices instead of excluding.
 */
export function productInfo(p: SnapshotProtocol): ProductInfo | null {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) {
    const reason = `a ${p.category.toLowerCase()} product of a token that already trades`;
    if (p.category === 'Bridge' || p.category === 'Canonical Bridge') return { cls: 'bridge', haircut: MODEL.haircut_bridge, reason };
    if (p.category === 'CEX') return { cls: 'exchange', haircut: MODEL.haircut_exchange, reason };
    return { cls: 'wrapper', haircut: MODEL.haircut_wrapper, reason };
  }
  if (VERSIONED.test(p.name)) return { cls: 'version', haircut: MODEL.haircut_version, reason: 'a numbered version of a protocol that already trades' };
  if (PRODUCT_WORD.test(p.name)) return { cls: 'wrapper', haircut: MODEL.haircut_wrapper, reason: 'a wrapped or staked product of an asset that already trades' };
  if (EXCHANGE_PREFIX.test(p.name)) return { cls: 'exchange', haircut: MODEL.haircut_exchange, reason: 'an exchange product, not an independent launch' };
  return null;
}

/** Why a pre-token protocol is a product of a traded token rather than a launch, or null. */
export function exclusionReason(p: SnapshotProtocol): string | null {
  return productInfo(p)?.reason ?? null;
}

/** Whether this record is a wrapped, staked, bridged or exchange product of something that trades. */
export function isProduct(p: SnapshotProtocol): boolean {
  return productInfo(p) !== null;
}

const DAY_MS = 86_400_000;

/** Whole days from the day DefiLlama began tracking the protocol to the snapshot's day; null if unknown. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The q-quantile of a non-empty list of numbers, linear interpolation between closest ranks. */
function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((x, y) => x - y);
  if (sorted.length === 1) return sorted[0]!;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The three adjustments one protocol's own record earns, with every figure exposed. */
export interface Adjustments {
  momentumMult: number;
  maturityMult: number;
  footprintMult: number;
  total: number;
  age: number | null;
  growthPct: number;
}

/** Momentum, maturity and footprint for one protocol, exactly as radar-3 defined them. */
export function adjustmentsFor(p: SnapshotProtocol, asOf: string): Adjustments {
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const growthPct = Math.min(MODEL.momentum_cap_pct, Math.max(MODEL.momentum_floor_pct, rawGrowth));
  const momentumMult = Math.max(MODEL.momentum_min_mult, 1 + (growthPct / 100) * MODEL.momentum_weight);
  const ageForModel = age ?? MODEL.unknown_age_days;
  const maturityMult = MODEL.maturity_base + (Math.min(Math.max(ageForModel, 0), MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
  const extraChains = Math.min(Math.max(p.chains.length - 1, 0), MODEL.footprint_max_extra_chains);
  const footprintMult = 1 + MODEL.footprint_per_chain * extraChains;
  return { momentumMult, maturityMult, footprintMult, total: momentumMult * maturityMult * footprintMult, age, growthPct };
}

// ---- The priced peer universe -----------------------------------------------------------------

/** One traded protocol the model can learn from: it carries both a market cap and a TVL. */
export interface PricedPeer {
  p: SnapshotProtocol;
  ratio: number; // market cap / TVL, winsorized at the universe's 90th percentile
  adjRatio: number; // ratio with the protocol's own adjustments divided out, winsorized likewise
  adj: Adjustments;
}

/** The universe's winsorize cap: the 90th percentile of the raw ratios, as radar-3 set it. */
function winsorCap(ratios: number[]): number {
  if (ratios.length === 0) return MODEL.multiple_cap;
  const sorted = [...ratios].sort((x, y) => x - y);
  return sorted[Math.floor(MODEL.winsor_quantile * (sorted.length - 1))]!;
}

/** Every protocol in the snapshot whose traded price can teach the model anything. */
export function pricedPeers(snapshot: Snapshot): PricedPeer[] {
  const candidates: { p: SnapshotProtocol; raw: number; adj: Adjustments }[] = [];
  for (const p of snapshot.protocols) {
    if (!recordsToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    candidates.push({ p, raw: p.mcap_usd / p.tvl_usd, adj: adjustmentsFor(p, snapshot.as_of) });
  }
  const capRaw = winsorCap(candidates.map((c) => c.raw));
  const capAdj = winsorCap(candidates.map((c) => c.raw / c.adj.total));
  return candidates.map((c) => ({
    p: c.p,
    ratio: Math.min(c.raw, capRaw),
    adjRatio: Math.min(c.raw / c.adj.total, capAdj),
    adj: c.adj,
  }));
}

/** One category's radar-3 peer evidence, kept as a lens and as the category candidate's table. */
export interface CategoryMultiple {
  category: string;
  peers: number;
  raw_median: number | null;
  multiple: number;
  p25: number;
  p75: number;
}

/** Shrunk category medians over a peer set: the statistic radar-3 priced from. */
export function categoryMultiples(peers: PricedPeer[]): {
  global: number;
  globalP25: number;
  globalP75: number;
  byCategory: Map<string, CategoryMultiple>;
} {
  const all = peers.map((x) => x.ratio);
  const global = all.length > 0 ? median(all) : 0.2;
  const globalP25 = all.length > 0 ? quantile(all, 0.25) : 0.05;
  const globalP75 = all.length > 0 ? quantile(all, 0.75) : 0.6;
  const rawByCategory = new Map<string, number[]>();
  for (const x of peers) {
    const key = x.p.category ?? 'Uncategorised';
    const list = rawByCategory.get(key) ?? [];
    list.push(x.ratio);
    rawByCategory.set(key, list);
  }
  const shrink = (n: number, value: number, universe: number): number =>
    Math.min((n * value + MODEL.peer_shrink_k * universe) / (n + MODEL.peer_shrink_k), MODEL.multiple_cap);
  const byCategory = new Map<string, CategoryMultiple>();
  for (const [category, ratios] of rawByCategory) {
    byCategory.set(category, {
      category,
      peers: ratios.length,
      raw_median: median(ratios),
      multiple: shrink(ratios.length, median(ratios), global),
      p25: shrink(ratios.length, quantile(ratios, 0.25), globalP25),
      p75: shrink(ratios.length, quantile(ratios, 0.75), globalP75),
    });
  }
  return { global, globalP25, globalP75, byCategory };
}

// ---- The candidate contest ----------------------------------------------------------------------

/** A fitted pricing candidate: a name, a plain-words description, and a predictor. */
export interface Candidate {
  id: string;
  name: string;
  describe: string;
  /** Predict a market cap for any protocol from a fit on the given peers. */
  fit: (peers: PricedPeer[]) => (p: SnapshotProtocol, adj: Adjustments) => number;
  /** The fitted model's readable coefficients, for the methodology table. */
  coefficients: (peers: PricedPeer[]) => Record<string, number>;
}

/** Least squares of y on x over paired points; a flat line at the mean when x has no spread. */
function regress(xs: number[], ys: number[]): { a: number; b: number } {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
  }
  const b = sxx > 1e-12 ? sxy / sxx : 0;
  return { a: my - b * mx, b };
}

/** The shrunk category medians of the adjustment-divided ratios, for the cat-adj candidate. */
function adjCategoryMultiples(peers: PricedPeer[]): Map<string, { peers: number; multiple: number }> {
  const all = peers.map((x) => x.adjRatio);
  const global = all.length > 0 ? median(all) : 0.2;
  const rawByCategory = new Map<string, number[]>();
  for (const x of peers) {
    const key = x.p.category ?? 'Uncategorised';
    const list = rawByCategory.get(key) ?? [];
    list.push(x.adjRatio);
    rawByCategory.set(key, list);
  }
  const out = new Map<string, { peers: number; multiple: number }>();
  for (const [category, ratios] of rawByCategory) {
    const n = ratios.length;
    out.set(category, { peers: n, multiple: Math.min((n * median(ratios) + MODEL.peer_shrink_k * global) / (n + MODEL.peer_shrink_k), MODEL.multiple_cap) });
  }
  return out;
}

/** The size curve over adjustment-divided ratios, with optional shrunk category offsets. */
function fitCurve(peers: PricedPeer[], withOffsets: boolean): {
  a: number;
  b: number;
  offsets: Map<string, number>;
  globalAdjMedian: number;
} {
  const xs = peers.map((x) => Math.log10(Math.max(x.p.tvl_usd, 1)));
  const ys = peers.map((x) => Math.log10(Math.max(x.adjRatio, 1e-6)));
  const { a, b } = regress(xs, ys);
  const offsets = new Map<string, number>();
  if (withOffsets) {
    const residuals = new Map<string, number[]>();
    peers.forEach((x, i) => {
      const key = x.p.category ?? 'Uncategorised';
      const list = residuals.get(key) ?? [];
      list.push(ys[i]! - (a + b * xs[i]!));
      residuals.set(key, list);
    });
    for (const [category, list] of residuals) {
      const n = list.length;
      const shrunk = (n * median(list)) / (n + MODEL.peer_shrink_k);
      offsets.set(category, Math.max(-MODEL.curve_offset_cap_log10, Math.min(MODEL.curve_offset_cap_log10, shrunk)));
    }
  }
  return { a, b, offsets, globalAdjMedian: peers.length > 0 ? median(peers.map((x) => x.adjRatio)) : 0.2 };
}

/** The five candidates, simplest first; the contest, not this order, decides which prices. */
export const CANDIDATES: Candidate[] = [
  {
    id: 'flat',
    name: 'Flat universe multiple',
    describe: 'one median market-cap-to-TVL ratio for the whole universe, no adjustments — the house starter’s idea, kept as the control',
    fit: (peers) => {
      const m = peers.length > 0 ? median(peers.map((x) => x.ratio)) : 0.2;
      return (p) => Math.max(1, p.tvl_usd * m);
    },
    coefficients: (peers) => ({ universe_median_ratio: round4(peers.length > 0 ? median(peers.map((x) => x.ratio)) : 0.2) }),
  },
  {
    id: 'category',
    name: 'Category medians (radar-3)',
    describe: 'radar-3 unchanged: each category’s peer median shrunk toward the universe median, times the momentum, maturity and footprint adjustments',
    fit: (peers) => {
      const table = categoryMultiples(peers);
      return (p, adj) => {
        const found = table.byCategory.get(p.category ?? 'Uncategorised');
        const multiple = found !== undefined ? found.multiple : table.global;
        return Math.max(1, p.tvl_usd * multiple * adj.total);
      };
    },
    coefficients: (peers) => ({ universe_median_ratio: round4(categoryMultiples(peers).global), categories_priced: categoryMultiples(peers).byCategory.size }),
  },
  {
    id: 'cat-adj',
    name: 'Category medians, adjustment-tested',
    describe: 'radar-3’s medians read from ratios with each peer’s own adjustments divided out first, so the contest can tell whether the adjustment stack itself earns its place',
    fit: (peers) => {
      const table = adjCategoryMultiples(peers);
      const global = peers.length > 0 ? median(peers.map((x) => x.adjRatio)) : 0.2;
      return (p, adj) => {
        const found = table.get(p.category ?? 'Uncategorised');
        const multiple = found !== undefined ? found.multiple : Math.min(global, MODEL.multiple_cap);
        return Math.max(1, p.tvl_usd * multiple * adj.total);
      };
    },
    coefficients: (peers) => ({ universe_median_adjusted_ratio: round4(peers.length > 0 ? median(peers.map((x) => x.adjRatio)) : 0.2) }),
  },
  {
    id: 'curve',
    name: 'Size curve',
    describe: 'a log-log line fitted to the adjustment-divided ratios: what a dollar of TVL is worth falls (or rises) with the protocol’s own size, instead of one multiple per category',
    fit: (peers) => {
      const { a, b } = fitCurve(peers, false);
      return (p, adj) => {
        const multiple = Math.min(Math.pow(10, a + b * Math.log10(Math.max(p.tvl_usd, 1))), MODEL.multiple_cap);
        return Math.max(1, p.tvl_usd * multiple * adj.total);
      };
    },
    coefficients: (peers) => {
      const { a, b } = fitCurve(peers, false);
      return { intercept_log10: round4(a), slope_per_log10_tvl: round4(b) };
    },
  },
  {
    id: 'curve-cat',
    name: 'Size curve + category offsets',
    describe: 'the size curve, plus a shrunk per-category offset for the part of a category’s pricing the curve cannot see, capped so no small category can shout',
    fit: (peers) => {
      const { a, b, offsets } = fitCurve(peers, true);
      return (p, adj) => {
        const offset = offsets.get(p.category ?? 'Uncategorised') ?? 0;
        const multiple = Math.min(Math.pow(10, a + b * Math.log10(Math.max(p.tvl_usd, 1)) + offset), MODEL.multiple_cap);
        return Math.max(1, p.tvl_usd * multiple * adj.total);
      };
    },
    coefficients: (peers) => {
      const { a, b, offsets } = fitCurve(peers, true);
      return { intercept_log10: round4(a), slope_per_log10_tvl: round4(b), categories_with_offsets: offsets.size };
    },
  },
];

/** One candidate's out-of-sample report card from the leave-one-out contest. */
export interface ValidationRow {
  id: string;
  name: string;
  describe: string;
  median_abs_log_error: number;
  mean_abs_log_error: number;
  within_2x_pct: number;
}

/** The whole contest: every candidate's card, the winner, and its coefficients. */
export interface Validation {
  peers_priced: number;
  rows: ValidationRow[];
  winner: string;
  winner_name: string;
  coefficients: Record<string, number>;
}

/**
 * Leave-one-out over the priced peers: each candidate is refit without one peer and must
 * predict that peer's recorded market cap. The winner has the lowest median absolute log10
 * error; ties break toward the simpler candidate (the order above).
 */
export function runValidation(peers: PricedPeer[]): Validation {
  const rows: ValidationRow[] = CANDIDATES.map((c) => {
    const errors: number[] = [];
    let within = 0;
    for (let i = 0; i < peers.length; i++) {
      const rest = peers.filter((_, j) => j !== i);
      const predict = c.fit(rest);
      const held = peers[i]!;
      const predicted = predict(held.p, held.adj);
      const err = Math.abs(Math.log10(predicted / held.p.mcap_usd!));
      errors.push(err);
      if (err <= Math.log10(2)) within++;
    }
    return {
      id: c.id,
      name: c.name,
      describe: c.describe,
      median_abs_log_error: round4(median(errors)),
      mean_abs_log_error: round4(errors.reduce((s, v) => s + v, 0) / Math.max(errors.length, 1)),
      within_2x_pct: round2((100 * within) / Math.max(peers.length, 1)),
    };
  });
  let winner = rows[0]!;
  for (const r of rows) if (r.median_abs_log_error < winner.median_abs_log_error) winner = r;
  const candidate = CANDIDATES.find((c) => c.id === winner.id)!;
  return { peers_priced: peers.length, rows, winner: winner.id, winner_name: winner.name, coefficients: candidate.coefficients(peers) };
}

/** A deterministic PRNG (mulberry32): the bootstrap must write the same bytes on both runs. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Refit the winning candidate on bootstrap resamples of the peer set and re-price every board
 * candidate: per protocol, the refits' implied values and ranks, for the published ranges.
 * The optional transform is applied to each refit's price before values and ranks are read —
 * the board passes its product discount, so a product row's range and rank range describe the
 * discounted figure it actually prints, not the curve's undiscounted read.
 */
export function bootstrapRanges(
  peers: PricedPeer[],
  winnerId: string,
  targets: SnapshotProtocol[],
  asOf: string,
  transform?: (p: SnapshotProtocol, value: number) => number,
): Map<string, { values: number[]; ranks: number[] }> {
  const candidate = CANDIDATES.find((c) => c.id === winnerId)!;
  const rand = mulberry32(MODEL.bootstrap_seed);
  const adjs = new Map(targets.map((p) => [p.slug, adjustmentsFor(p, asOf)]));
  const collected = new Map<string, { values: number[]; ranks: number[] }>(targets.map((p) => [p.slug, { values: [], ranks: [] }]));
  for (let rep = 0; rep < MODEL.bootstrap_reps; rep++) {
    const sample: PricedPeer[] = [];
    for (let i = 0; i < peers.length; i++) sample.push(peers[Math.floor(rand() * peers.length)]!);
    const predict = candidate.fit(sample);
    const scored = targets.map((p) => {
      const raw = predict(p, adjs.get(p.slug)!);
      return { slug: p.slug, value: transform === undefined ? raw : transform(p, raw) };
    });
    scored.sort((x, y) => y.value - x.value || (x.slug < y.slug ? -1 : 1));
    scored.forEach((s, i) => {
      const cell = collected.get(s.slug)!;
      cell.values.push(s.value);
      cell.ranks.push(i + 1);
    });
  }
  return collected;
}

// ---- The three comparable lenses ------------------------------------------------------------------

/** One named comparable protocol behind a lens, with the figures a reader needs to audit it. */
export interface Comp {
  slug: string;
  name: string;
  mcap_usd: number;
  tvl_usd: number;
  ratio: number;
}

/** One lens's answer: the multiple it reads, how many peers stand behind it, its implied value. */
export interface Lens {
  multiple: number;
  peers: number;
  implied_usd: number;
  comps: Comp[];
}

/** A lens's peer set priced: shrunk median of its ratios toward the universe, top comps named. */
function priceLens(pool: PricedPeer[], global: number, p: SnapshotProtocol, adj: Adjustments): Lens {
  const n = pool.length;
  const multiple = n === 0 ? global : Math.min((n * median(pool.map((x) => x.ratio)) + MODEL.peer_shrink_k * global) / (n + MODEL.peer_shrink_k), MODEL.multiple_cap);
  const comps = [...pool]
    .sort((x, y) => y.p.tvl_usd - x.p.tvl_usd || (x.p.slug < y.p.slug ? -1 : 1))
    .slice(0, 5)
    .map((x) => ({ slug: x.p.slug, name: x.p.name, mcap_usd: x.p.mcap_usd!, tvl_usd: x.p.tvl_usd, ratio: round4(x.ratio) }));
  return { multiple: round4(multiple), peers: n, implied_usd: Math.max(1, Math.round(p.tvl_usd * multiple * adj.total)), comps };
}

/** The three independent comparable sets one protocol is cross-examined against. */
export function lensesFor(
  p: SnapshotProtocol,
  adj: Adjustments,
  peers: PricedPeer[],
  global: number,
): { category: Lens; chain: Lens; scale: Lens; distinctPeers: number } {
  const category = priceLens(peers.filter((x) => (x.p.category ?? 'Uncategorised') === (p.category ?? 'Uncategorised')), global, p, adj);
  const mainChain = p.chains[0];
  const chain = priceLens(mainChain !== undefined ? peers.filter((x) => x.p.chains.includes(mainChain)) : [], global, p, adj);
  const lo = p.tvl_usd / MODEL.scale_band;
  const hi = p.tvl_usd * MODEL.scale_band;
  const scale = priceLens(peers.filter((x) => x.p.tvl_usd >= lo && x.p.tvl_usd <= hi), global, p, adj);
  const distinct = new Set<string>();
  for (const lens of [category, chain, scale]) for (const c of lens.comps) distinct.add(c.slug);
  // Distinct counts every priced peer behind the lenses, not only the five named per lens.
  const counted = new Set<string>();
  for (const x of peers) {
    const inCategory = (x.p.category ?? 'Uncategorised') === (p.category ?? 'Uncategorised');
    const inChain = mainChain !== undefined && x.p.chains.includes(mainChain);
    const inScale = x.p.tvl_usd >= lo && x.p.tvl_usd <= hi;
    if (inCategory || inChain || inScale) counted.add(x.p.slug);
  }
  return { category, chain, scale, distinctPeers: counted.size };
}

// ---- Evidence, flags, confidence ------------------------------------------------------------------

/** How much peer evidence stands behind a multiple, graded for the reader. */
export type Evidence = 'deep' | 'fair' | 'thin' | 'universe';

/** The evidence grade for a peer count: 8+ prints is a market, 1–2 is an anecdote with shrinkage. */
export function evidenceFor(peerCount: number): Evidence {
  if (peerCount >= 8) return 'deep';
  if (peerCount >= 3) return 'fair';
  if (peerCount >= 1) return 'thin';
  return 'universe';
}

/**
 * The warnings one protocol's own record raises, in the order a reader should meet them.
 * Every flag is a threshold on a figure the row itself publishes; none names a protocol.
 */
export function flagsFor(
  p: SnapshotProtocol,
  v: { peer: CategoryMultiple; momentumMult: number; age: number | null; lensSpread: number; product: boolean },
): string[] {
  const flags: string[] = [];
  if (v.product) flags.push('traded-parent-product');
  if (v.peer.peers === 0) flags.push('no-category-peers');
  else if (v.peer.peers <= 2) flags.push('thin-evidence');
  if (v.lensSpread >= MODEL.lens_disagree_spread) flags.push('lenses-disagree');
  if (typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) && p.change_7d <= -15) flags.push('tvl-falling-fast');
  if (v.momentumMult >= 1.45) flags.push('one-hot-week');
  if (v.age === null) flags.push('age-unrecorded');
  else if (v.age < 180) flags.push('young');
  if (p.chains.length <= 1) flags.push('single-chain');
  return flags;
}

/**
 * A 0–100 signal score for the reader's eye, separate from the ranking: how much of the board's
 * own range this row covers on size, momentum, track record and reach. Rank is implied value
 * alone; the signal only says where a farmer's hour is best spent first.
 */
export function conviction(p: SnapshotProtocol, age: number | null, growthPct: number, logTvlMin: number, logTvlMax: number): number {
  const logTvl = Math.log10(Math.max(p.tvl_usd, 1));
  const tvlN = logTvlMax > logTvlMin ? (logTvl - logTvlMin) / (logTvlMax - logTvlMin) : 0.5;
  const momN = (growthPct - MODEL.momentum_floor_pct) / (MODEL.momentum_cap_pct - MODEL.momentum_floor_pct);
  const ageN = Math.min(age ?? MODEL.unknown_age_days, MODEL.maturity_days) / MODEL.maturity_days;
  const footN = Math.min(p.chains.length, 8) / 8;
  return Math.max(1, Math.min(100, Math.round(100 * (0.45 * tvlN + 0.25 * momN + 0.2 * ageN + 0.1 * footN))));
}

/**
 * A 0–100 confidence in the row's own number, from published parts: half from how many distinct
 * priced peers stand behind its three lenses (24 or more saturates), half from how closely the
 * lenses agree (a spread of 1.5 or more — the flag threshold — scores that half at zero).
 */
export function confidenceFor(distinctPeers: number, lensSpread: number): number {
  const evidenceHalf = Math.min(distinctPeers, 24) / 24;
  const agreementHalf = Math.max(0, 1 - lensSpread / MODEL.lens_disagree_spread);
  return Math.max(1, Math.min(100, Math.round(100 * (0.5 * evidenceHalf + 0.5 * agreementHalf))));
}

// ---- Farm plans, netted -----------------------------------------------------------------------------

/** What one transaction costs on a chain, in words and in the dollars the netting uses. */
function gasProfile(chain: string): { perTx: string; weekly: string; perTxUsd: number; weeklyUsd: number } {
  if (chain === 'Ethereum') return { perTx: 'about $12-30 of mainnet gas per transaction at typical fees', weekly: 'about $15-35 of mainnet gas a week', perTxUsd: 21, weeklyUsd: 25 };
  if (chain === 'Solana') return { perTx: 'well under $0.05 of network fees per transaction', weekly: 'under $1 of network fees a week', perTxUsd: 0.05, weeklyUsd: 0.5 };
  const cheap = ['Arbitrum', 'Base', 'Optimism', 'zkSync Era', 'Linea', 'Scroll', 'Mantle', 'Blast', 'Mode', 'Polygon', 'BSC', 'Avalanche', 'Fantom', 'Sonic', 'Berachain', 'Monad', 'Hyperliquid L1'];
  if (cheap.includes(chain)) return { perTx: 'about $0.10-$1 of gas per transaction', weekly: 'about $1-3 of gas a week', perTxUsd: 0.5, weeklyUsd: 2 };
  return { perTx: 'about $0.10-$2 of gas per transaction', weekly: 'about $1-4 of gas a week', perTxUsd: 1, weeklyUsd: 2.5 };
}

/** The first chain a protocol names, or a neutral phrase when it names none. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital a farm position needs, from the protocol's own TVL: bigger rooms, more farmers. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long a qualifying window runs, from the protocol's age: younger rooms count over more snapshots. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 540) return 45;
  return 30;
}

interface Playbook {
  open: (name: string, chain: string, capital: number) => string;
  second: (name: string, chain: string, capital: number) => string;
  weekly: (name: string, chain: string) => string;
}

/** The category's playbook: the position to open, the second qualifying action, the weekly habit. */
function playbookFor(p: SnapshotProtocol): Playbook {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('dex') || c.includes('amm')) {
    return {
      open: (n, ch, $) => `Provide $${$} split evenly between ETH and USDC in ${n}'s deepest pool on ${ch}, and keep the LP position open rather than hopping pools.`,
      second: (n, ch, $) => `Route two or three real swaps of about $${Math.max(25, Math.round($ / 4))} each through ${n} on ${ch} in the same week, so the wallet shows both sides of the market.`,
      weekly: (n) => `Rebalance the LP range if the pool offers one and add one small swap through ${n}; steady two-sided activity is what points seasons count.`,
    };
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      open: (n, ch, $) => `Supply $${$} of USDC to ${n} on ${ch} as collateral and leave it supplied; do not supply and withdraw inside the same week.`,
      second: (n, ch, $) => `Borrow about $${Math.round($ * 0.4)} against the position on ${n}, hold it for at least a week, then repay in full so the wallet carries a complete borrow cycle.`,
      weekly: (n) => `Top the supply up by a small amount or adjust the borrow on ${n} once a week; a live, changing position reads as use, not parking.`,
    };
  }
  if (c.includes('bridge') || c.includes('cross chain')) {
    return {
      open: (n, ch, $) => `Bridge $${$} of USDC from Ethereum to ${ch} through ${n}, then put the bridged funds to work in one app on the far side the same day.`,
      second: (n, ch, $) => `Bridge a smaller amount, about $${Math.max(25, Math.round($ / 4))}, back through ${n} a week later, so the wallet has honest routes in both directions.`,
      weekly: (n) => `Make one small bridge through ${n} each week and use the destination chain afterwards; volume with a purpose counts more than round trips.`,
    };
  }
  if (c.includes('staking') || c.includes('restaked')) {
    return {
      open: (n, ch, $) => `Mint $${$} of ${n}'s receipt token on ${ch} with the underlying asset and hold the receipt in the farming wallet; do not sell it into a pool the same week.`,
      second: (n, ch, $) => `Put about $${Math.max(25, Math.round($ / 4))} of the receipt token to work in the deepest pool or vault that lists it on ${ch}, so the wallet both holds and supplies it.`,
      weekly: (n) => `Check the receipt token's exchange rate and ${n}'s programme page once a week; staking rooms count holders across snapshots, not churn.`,
    };
  }
  if (c.includes('cex') || c.includes('exchange')) {
    return {
      open: (n, ch, $) => `Complete ${n}'s account verification, deposit $${$}, and subscribe it to the exchange's launchpool or earn product rather than leaving the balance idle.`,
      second: (n, ch, $) => `Take the smallest allocation in one live launchpool campaign on ${n} and hold whatever it farms until that campaign's distribution ends.`,
      weekly: (n) => `Check ${n}'s launchpool calendar once a week and roll the deposit into the next campaign when one closes; idle balances earn nothing.`,
    };
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) {
    return {
      open: (n, ch, $) => `Deposit $${$} of USDC as margin on ${n} and open one small hedged position, sized so a bad day costs a few dollars, not the farm.`,
      second: (n, ch) => `Close and reopen the hedge on ${n} once after a week, keeping total volume modest and the account consistently active rather than churned.`,
      weekly: (n) => `Place one or two small trades on ${n} each week and keep margin parked there between them; continuity is the signal.`,
    };
  }
  if (c.includes('basis')) {
    return {
      open: (n, ch, $) => `Fund $${$} on ${n} and open its standard basis position, half spot and half hedge, exactly as its own interface composes it.`,
      second: (n, ch, $) => `Add about $${Math.max(25, Math.round($ / 4))} to the basis position after the first funding week so the wallet's balance grows into the season.`,
      weekly: (n) => `Check the position's funding and health on ${n} once a week and top up margin if it drifts; basis farms pay the patient, not the busy.`,
    };
  }
  if (c.includes('rwa')) {
    return {
      open: (n, ch, $) => `Complete ${n}'s onboarding on ${ch} if it asks for it, then mint $${$} of its yield-bearing asset and hold it in the farming wallet.`,
      second: (n, ch, $) => `Add a second mint of about $${Math.max(25, Math.round($ / 4))} on ${n} a week later, so the holding has more than one dated entry.`,
      weekly: (n) => `Hold the asset and check ${n}'s attestations page once a week; for real-world-asset rooms the qualifying act is staying invested.`,
    };
  }
  if (c.includes('privacy')) {
    return {
      open: (n, ch, $) => `Deposit $${$} into ${n}'s shielded pool on ${ch} from the farming wallet and keep the note or receipt the interface gives you.`,
      second: (n, ch, $) => `Make one private transfer of about $${Math.max(25, Math.round($ / 4))} to a second wallet you control through ${n}, following its own guide.`,
      weekly: (n) => `Make one small shielded transaction on ${n} each week; private rooms count distinct active days, not size.`,
    };
  }
  if (c.includes('stable')) {
    return {
      open: (n, ch, $) => `Mint or deposit $${$} of the stable asset through ${n} on ${ch} and hold the balance in the farming wallet.`,
      second: (n, ch, $) => `Provide about $${Math.max(25, Math.round($ / 4))} of the stable asset to its main liquidity pool on ${ch}, so the wallet both holds and supplies it.`,
      weekly: (n) => `Mint or redeem a small amount through ${n} once a week to keep the wallet's history current on both sides.`,
    };
  }
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator') || c.includes('aggregator')) {
    return {
      open: (n, ch, $) => `Deposit $${$} of USDC into ${n}'s flagship vault on ${ch} and keep the vault shares in the farming wallet.`,
      second: (n, ch, $) => `Split a second $${Math.max(25, Math.round($ / 4))} into another of ${n}'s vaults on ${ch}, so the wallet follows more than one strategy.`,
      weekly: (n) => `Review the vault positions on ${n} once a week and move a small amount between them only when a strategy closes; churn is not the signal, tenure is.`,
    };
  }
  if (c.includes('launchpad') || c.includes('launch')) {
    return {
      open: (n, ch, $) => `Register the farming wallet on ${n} and stake or commit $${$} toward its next launch allocation on ${ch}.`,
      second: (n, ch) => `Take part in one live launch on ${n} at the smallest tier, completing every step its page lists, including any holding period.`,
      weekly: (n) => `Check ${n}'s launch calendar once a week and keep the commitment in place between launches.`,
    };
  }
  return {
    open: (n, ch, $) => `Deposit $${$} of USDC into ${n} on ${ch} through its own interface and keep the position open.`,
    second: (n, ch, $) => `Make one more qualifying transaction of about $${Math.max(25, Math.round($ / 4))} on ${n} a week later, so the wallet shows a pattern, not a single touch.`,
    weekly: (n) => `Use ${n} once a week in the way its own dashboard counts, and keep the position open between visits.`,
  };
}

/** A step as one string: the action, then what it costs and how long it takes, inside the gate's bounds. */
function stepText(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and the log current.`;
  return s;
}

/**
 * One protocol's farm plan: six steps built from its own record — its category's playbook, its
 * first chain's gas prices, capital scaled to its TVL and a hold window scaled to its age. Two
 * protocols share a step only where the step is the same advice for everyone (wallet hygiene,
 * claiming safely), and even there the figures are the protocol's own.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const gas = gasProfile(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const play = playbookFor(p);
  return [
    stepText(
      `Start from a fresh wallet that holds only the funds you mean to farm ${p.name} with, keep its seed phrase offline, and send one small test transaction first.`,
      'under $3 to set up, plus the test transaction',
      '10 minutes',
    ),
    stepText(play.open(p.name, chain, capital), `$${capital} of capital, ${gas.perTx}`, '15 minutes to set up'),
    stepText(play.second(p.name, chain, capital), gas.perTx, '10 minutes, a week after the first step'),
    stepText(play.weekly(p.name, chain), gas.weekly, '10 minutes a week'),
    stepText(
      `Hold the position for at least ${hold} days so the activity stands in more than one weekly snapshot, and keep a farm log of the wallet, the dates and every transaction hash.`,
      `the $${capital} stays in the position for the whole window`,
      `${hold} days`,
    ),
    stepText(
      `Watch ${p.name}'s own page and announcements for a points programme or a token announcement, claim only from links the protocol itself publishes, and unwind the position once any claim window closes.`,
      'nothing to watch, and never pay a fee to claim',
      '10 minutes a week of watching, 20 minutes to unwind',
    ),
  ];
}

/** The farm verdicts, from the thresholds the methodology states. */
export type FarmVerdict = 'farm' | 'thin' | 'skip';

/** One row's farm plan, netted: what it costs all-in, and whether the row earns the spend. */
export interface FarmEconomics {
  capital_usd: number;
  hold_days: number;
  plan_cost_usd: number;
  cost_pct_of_implied: number;
  verdict: FarmVerdict;
  verdict_reason: string;
}

/**
 * The netting: the plan's gas over its own hold window (setup, open, second, the weekly habit
 * and the unwind), priced at the chain's mid estimates — capital is a position, not a cost, and
 * is stated separately. The verdict follows the published thresholds: skip when the value rests
 * on the universe alone, or when a weak signal meets one-or-two-peer evidence; farm when the
 * signal is 55 or better and the row's confidence across its three lenses is 45 or better;
 * thin for everything between.
 */
export function farmEconomics(
  p: SnapshotProtocol,
  age: number | null,
  signal: number,
  evidence: Evidence,
  implied: number,
  confidence: number,
): FarmEconomics {
  const gas = gasProfile(chainOf(p));
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = Math.ceil(hold / 7);
  const cost = round2(gas.perTxUsd * 3 + gas.weeklyUsd * weeks);
  const pct = implied > 0 ? cost / implied : 1;
  let verdict: FarmVerdict;
  let reason: string;
  if (evidence === 'universe') {
    verdict = 'skip';
    reason = 'the implied value rests on the universe median alone — no peer in its category prices it, so the plan’s cost buys a guess, not a claim';
  } else if (signal < 20 && evidence === 'thin') {
    verdict = 'skip';
    reason = `signal ${signal} of 100 and a price resting on one or two peers — too little behind the claim to spend gas on yet`;
  } else if (signal >= 55 && confidence >= 45) {
    verdict = 'farm';
    reason = `signal ${signal} of 100 and confidence ${confidence} of 100 across its three lenses, and the whole plan costs ${(pct * 100).toFixed(3)}% of the implied value — the spend is small against the claim`;
  } else if (signal >= 55) {
    verdict = 'thin';
    reason = `signal ${signal} of 100 but confidence only ${confidence} of 100 — its three lenses do not agree closely enough to farm at full size yet`;
  } else if (evidence === 'thin') {
    verdict = 'thin';
    reason = 'the price rests on one or two traded peers — worth a small position only, sized down from the plan, until more of its category trades';
  } else if (signal < 55) {
    verdict = 'thin';
    reason = `signal ${signal} of 100 — worth a small position only, sized down from the plan, until the record strengthens`;
  } else {
    verdict = 'thin';
    reason = `the plan costs ${(pct * 100).toFixed(2)}% of the implied value, past the ${(MODEL.farm_cost_pct_max * 100).toFixed(1)}% line the radar farms under — the claim is too small for its gas`;
  }
  return { capital_usd: capital, hold_days: hold, plan_cost_usd: cost, cost_pct_of_implied: round4(pct), verdict, verdict_reason: reason };
}

// ---- The board -------------------------------------------------------------------------------------

/** One row of board.json: the ranked board's row, its fitted price, its evidence and its plan. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  /** Why this row is a product of a traded token, or null when it stands alone. */
  product_reason: string | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  rank_low: number;
  rank_high: number;
  evidence: Evidence;
  confidence: number;
  flags: string[];
  conviction: number;
  model: {
    fitted_model: string;
    /** The fitted model's value before the product discount: the business the TVL describes. */
    gross_value_usd: number;
    /** The product discount applied to the gross value: 1 when the row stands alone. */
    product_haircut: number;
    peer_multiple: number;
    peer_multiple_p25: number;
    peer_multiple_p75: number;
    peer_count: number;
    global_multiple: number;
    momentum_multiplier: number;
    maturity_multiplier: number;
    footprint_multiplier: number;
    lens_category_usd: number;
    lens_chain_usd: number;
    lens_scale_usd: number;
    lens_category_multiple: number;
    lens_chain_multiple: number;
    lens_scale_multiple: number;
    lens_category_peers: number;
    lens_chain_peers: number;
    lens_scale_peers: number;
    lens_spread: number;
    distinct_peers: number;
  };
  comps: { category: Comp[]; chain: Comp[]; scale: Comp[] };
  farm: FarmEconomics;
  farm_steps: string[];
}

/** A token-bearing protocol, shown apart from the board at the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl: number | null;
}

/** Everything the dashboard renders: the board, the launched set and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: typeof MODEL;
  stats: {
    protocols: number;
    pre_token: number;
    board_size: number;
    watchlist_size: number;
    live_size: number;
    products_size: number;
    token_bearing: number;
    peers_priced: number;
    aggregate_implied_usd: number;
    global_multiple: number;
    avg_distinct_peers: number;
    farm_verdicts: { farm: number; thin: number; skip: number };
  };
  validation: Validation;
  categories: { category: string; peers: number; multiple: number; multiple_p25: number; multiple_p75: number; evidence: Evidence }[];
  rows: BoardRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/**
 * The protocols the board ranks: the watchlist whole, plus every protocol that records no
 * token — products of traded tokens included, priced with their discount. The board's subject
 * is the pre-token universe entire; the house's watchlist is its floor, never its ceiling.
 */
function boardCandidates(snapshot: Snapshot): SnapshotProtocol[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && !recordsToken(p)) chosen.set(p.slug, p);
  }
  return [...chosen.values()];
}

/** The board, strongest first: fitted price, refit ranges, lenses, comps, netted farm plans. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const peers = pricedPeers(snapshot);
  const validation = runValidation(peers);
  const winner = CANDIDATES.find((c) => c.id === validation.winner)!;
  const predict = winner.fit(peers);
  const table = categoryMultiples(peers);
  const candidates = boardCandidates(snapshot);
  const ranges = bootstrapRanges(peers, validation.winner, candidates, snapshot.as_of, (p, value) => value * (productInfo(p)?.haircut ?? 1));
  const logTvls = candidates.map((p) => Math.log10(Math.max(p.tvl_usd, 1)));
  const logMin = Math.min(...logTvls);
  const logMax = Math.max(...logTvls);
  const watch = new Set(snapshot.watchlist);
  const scored = candidates.map((p) => {
    const adj = adjustmentsFor(p, snapshot.as_of);
    const product = productInfo(p);
    const haircut = product?.haircut ?? 1;
    // The fitted model prices the business the TVL describes; a product of a traded token is
    // then cut to the share of that value its own token could claim, and the row prints both.
    const gross = Math.max(1, Math.round(predict(p, adj)));
    const implied = Math.max(1, Math.round(gross * haircut));
    const lens = lensesFor(p, adj, peers, table.global);
    const lensValues = [lens.category.implied_usd, lens.chain.implied_usd, lens.scale.implied_usd];
    // The lenses cross-examine the business, so their spread is read against the gross value:
    // the product discount is a stated step after the comparison, not part of the disagreement.
    const spread = (Math.max(...lensValues) - Math.min(...lensValues)) / Math.max(gross, 1);
    const peer = table.byCategory.get(p.category ?? 'Uncategorised') ?? {
      category: p.category ?? 'Uncategorised',
      peers: 0,
      raw_median: null,
      multiple: table.global,
      p25: table.globalP25,
      p75: table.globalP75,
    };
    const cell = ranges.get(p.slug)!;
    const low = Math.max(1, Math.min(implied, Math.round(quantile(cell.values, 0.1))));
    const high = Math.max(implied, Math.round(quantile(cell.values, 0.9)));
    const signal = conviction(p, adj.age, adj.growthPct, logMin, logMax);
    const evidence = evidenceFor(peer.peers);
    const confidence = confidenceFor(lens.distinctPeers, spread);
    return {
      p,
      adj,
      product,
      gross,
      haircut,
      implied,
      low,
      high,
      rankLow: Math.max(1, Math.round(quantile(cell.ranks, 0.05))),
      rankHigh: Math.round(quantile(cell.ranks, 0.95)),
      lens,
      spread,
      peer,
      signal,
      evidence,
      confidence,
      flags: flagsFor(p, { peer, momentumMult: adj.momentumMult, age: adj.age, lensSpread: spread, product: product !== null }),
      farm: farmEconomics(p, adj.age, signal, evidence, implied, confidence),
    };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    watchlist: watch.has(s.p.slug),
    product_reason: s.product?.reason ?? null,
    age_days: s.adj.age,
    implied_value_usd: s.implied,
    implied_low_usd: s.low,
    implied_high_usd: s.high,
    rank_low: Math.min(s.rankLow, i + 1),
    rank_high: Math.max(s.rankHigh, i + 1),
    evidence: s.evidence,
    confidence: s.confidence,
    flags: s.flags,
    conviction: s.signal,
    model: {
      fitted_model: validation.winner,
      gross_value_usd: s.gross,
      product_haircut: s.haircut,
      peer_multiple: round4(s.peer.multiple),
      peer_multiple_p25: round4(s.peer.p25),
      peer_multiple_p75: round4(s.peer.p75),
      peer_count: s.peer.peers,
      global_multiple: round4(table.global),
      momentum_multiplier: round4(s.adj.momentumMult),
      maturity_multiplier: round4(s.adj.maturityMult),
      footprint_multiplier: round4(s.adj.footprintMult),
      lens_category_usd: s.lens.category.implied_usd,
      lens_chain_usd: s.lens.chain.implied_usd,
      lens_scale_usd: s.lens.scale.implied_usd,
      lens_category_multiple: s.lens.category.multiple,
      lens_chain_multiple: s.lens.chain.multiple,
      lens_scale_multiple: s.lens.scale.multiple,
      lens_category_peers: s.lens.category.peers,
      lens_chain_peers: s.lens.chain.peers,
      lens_scale_peers: s.lens.scale.peers,
      lens_spread: round4(s.spread),
      distinct_peers: s.lens.distinctPeers,
    },
    comps: { category: s.lens.category.comps, chain: s.lens.chain.comps, scale: s.lens.scale.comps },
    farm: s.farm,
    farm_steps: farmSteps(s.p, s.adj.age),
  }));
}

/** Every token-bearing protocol, by market cap: the full comparable universe, not a sample. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => recordsToken(p))
    .sort((a, b) => (b.mcap_usd ?? -1) - (a.mcap_usd ?? -1) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round2(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Everything the entry hands in: the board for board.json and the data the dashboard renders. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const peers = pricedPeers(snapshot);
  const validation = runValidation(peers);
  const table = categoryMultiples(peers);
  const live = liveRows(snapshot);
  const preToken = snapshot.protocols.filter((p) => !recordsToken(p)).length;
  const verdicts = { farm: 0, thin: 0, skip: 0 };
  for (const r of board) verdicts[r.farm.verdict]++;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: MODEL,
    stats: {
      protocols: snapshot.protocols.length,
      pre_token: preToken,
      board_size: board.length,
      watchlist_size: snapshot.watchlist.length,
      live_size: live.length,
      products_size: board.filter((r) => r.product_reason !== null).length,
      token_bearing: snapshot.protocols.length - preToken,
      peers_priced: peers.length,
      aggregate_implied_usd: board.reduce((sum, r) => sum + r.implied_value_usd, 0),
      global_multiple: round4(table.global),
      avg_distinct_peers: round2(board.reduce((sum, r) => sum + r.model.distinct_peers, 0) / Math.max(board.length, 1)),
      farm_verdicts: verdicts,
    },
    validation,
    categories: [...table.byCategory.values()]
      .map((c) => ({
        category: c.category,
        peers: c.peers,
        multiple: round4(c.multiple),
        multiple_p25: round4(c.p25),
        multiple_p75: round4(c.p75),
        evidence: evidenceFor(c.peers),
      }))
      .sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1)),
    rows: board,
    live,
  };
  return { board, radar };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, values, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const validSlugs = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!validSlugs.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears on the board twice';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100 to 4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `rank ${i + 1} outranks rank ${i} on implied value`;
  }
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.implied_low_usd > r.implied_value_usd || r.implied_high_usd < r.implied_value_usd) {
      return `${r.slug} has an implied range ${r.implied_low_usd} to ${r.implied_high_usd} that does not hold its value ${r.implied_value_usd}`;
    }
    if (r.rank_low > r.rank || r.rank_high < r.rank) return `${r.slug} has a rank range ${r.rank_low} to ${r.rank_high} that does not hold its rank ${r.rank}`;
    if (r.confidence < 1 || r.confidence > 100) return `${r.slug} has confidence ${r.confidence}`;
    if (r.comps.category.length === 0 && r.model.peer_count > 0) return `${r.slug} names no category comparables behind ${r.model.peer_count} peers`;
    if (!['farm', 'thin', 'skip'].includes(r.farm.verdict)) return `${r.slug} has farm verdict ${r.farm.verdict}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
