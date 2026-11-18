// The token radar's model (radar-3): one sealed snapshot of the protocol universe in, one ranked
// board of pre-token protocols out, every row carrying the value the model claims for its launch,
// the range that claim honestly spans, and the steps to farm it.
//
// Where radar-1 (the house starter) priced every launch at one flat multiple of TVL, this model
// calibrates the multiple from the snapshot itself. The snapshot's token-bearing protocols are the
// market's own answer to "what is a dollar of TVL worth as a token, in this category, today":
// for each category it takes the median market-cap-to-TVL ratio of the protocols whose token
// already trades, shrunk toward the universe-wide median by the number of peers behind it, so a
// category priced by two thin peers cannot shout down one priced by thirty. A pre-token protocol
// is then valued as its TVL at its own category's multiple, adjusted by three things the snapshot
// also records: its seven-day TVL momentum, how long it has run at scale with no token recorded
// (a survival premium), and how many chains it already reaches (its day-one distribution).
//
//   peerMultiple(category) = (n x median(peers) + K x globalMedian) / (n + K),   K = 4
//
// Two guards keep one wild peer from pricing a whole category: every peer ratio is winsorized at
// the universe's 90th percentile before any median is taken (a token trading at 400x its TVL is a
// speculation print, not a pricing anchor), and no category multiple stands above 3x. The product
// exclusions are the watchlist's own, categories included: a bridge or staking product of a token
// that trades is not a launch, whatever its size — WBTC is Bitcoin on Ethereum, not a candidate.
//   base                   = tvl_usd x peerMultiple
//   momentumMult           = max(0.55, 1 + clamp(change_7d, -50, 150) / 100 x 0.6)
//   maturityMult           = 0.75 + 0.45 x min(age_days, 1460) / 1460   (age unknown: 300 days)
//   footprintMult          = 1 + 0.03 x min(chains - 1, 7)
//   implied_value_usd      = max(1, round(base x momentumMult x maturityMult x footprintMult))
//
// Radar-3 adds the honesty layer around that central claim, because the snapshot's peer evidence
// is uneven: only 128 of its 416 token-bearing protocols carry a market cap a multiple can be
// read from, and most categories are priced by a handful of peers — the board's largest claim
// rests on a category priced by one. So every category also publishes its peer ratios' 25th and
// 75th percentiles, shrunk toward the universe's quartiles by the same K, and every row carries
// the implied value at those two multiples beside the central one (implied_low_usd,
// implied_high_usd): a category priced by one peer inherits most of the universe's spread, so
// its range is wide, and the width is the disclosure. Each row is also graded on the evidence
// behind its multiple (deep / fair / thin / universe) and flagged where its own record warns
// the reader — a multiple resting on two prints, TVL falling fast, one hot week carrying the
// momentum, a short or unrecorded tokenless history, a single chain. The central estimate, and
// with it every rank, is radar-2's unchanged: the range describes the claim, it does not move it.
//
// The board ranks every protocol that records no token and is not a wrapped, staked or bridged
// product of one that trades — the watchlist's own definition, applied at every size, not only
// above its $50M floor — plus every watchlist slug unconditionally. No name is special-cased:
// the same functions classify and score every row, and each row carries its own arithmetic so a
// reader can check the claim line by line.

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
export const MODEL_VERSION = 'radar-3';

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

/** Whether this record is a wrapped, staked, bridged or exchange product of something that trades. */
export function isProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return true;
  if (VERSIONED.test(p.name)) return true;
  if (PRODUCT_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  return false;
}

/** Whether the board may rank this protocol: it records no token and is no product of one. */
export function isRankable(p: SnapshotProtocol): boolean {
  return !recordsToken(p) && !isProduct(p);
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

/**
 * One category's peer evidence: how many token-bearing peers priced it, the shrunk multiple it
 * is priced at, and the shrunk 25th/75th percentile multiples that bound its honest range.
 */
export interface CategoryMultiple {
  category: string;
  peers: number;
  raw_median: number | null;
  multiple: number;
  p25: number;
  p75: number;
}

/** The peer table the model prices from: every category's shrunk market-cap-to-TVL multiples. */
export function peerMultiples(snapshot: Snapshot): {
  global: number;
  globalP25: number;
  globalP75: number;
  peersPriced: number;
  byCategory: Map<string, CategoryMultiple>;
} {
  const rawByCategory = new Map<string, number[]>();
  const allRaw: number[] = [];
  for (const p of snapshot.protocols) {
    if (!recordsToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    allRaw.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = rawByCategory.get(key) ?? [];
    list.push(ratio);
    rawByCategory.set(key, list);
  }
  // Winsorize at the universe's 90th percentile: the wildest prints cap the anchor, never set it.
  const sortedAll = [...allRaw].sort((x, y) => x - y);
  const cap = sortedAll.length > 0 ? sortedAll[Math.floor(0.9 * (sortedAll.length - 1))]! : 3;
  const winsor = (r: number): number => Math.min(r, cap);
  const all = allRaw.map(winsor);
  const global = all.length > 0 ? median(all) : 0.2;
  const globalP25 = all.length > 0 ? quantile(all, 0.25) : 0.05;
  const globalP75 = all.length > 0 ? quantile(all, 0.75) : 0.6;
  // One statistic of a peer set, shrunk toward the same statistic of the universe by the peer
  // count and capped like the central multiple: the quartiles get the median's own treatment,
  // so a thin category's range is pulled toward the universe's spread, never invented.
  const shrink = (n: number, value: number, universe: number): number =>
    Math.min((n * value + MODEL.peer_shrink_k * universe) / (n + MODEL.peer_shrink_k), 3);
  const byCategory = new Map<string, CategoryMultiple>();
  for (const [category, rawRatios] of rawByCategory) {
    const ratios = rawRatios.map(winsor);
    byCategory.set(category, {
      category,
      peers: ratios.length,
      raw_median: median(ratios),
      multiple: shrink(ratios.length, median(ratios), global),
      p25: shrink(ratios.length, quantile(ratios, 0.25), globalP25),
      p75: shrink(ratios.length, quantile(ratios, 0.75), globalP75),
    });
  }
  return { global, globalP25, globalP75, peersPriced: all.length, byCategory };
}

/** The peer set one protocol is priced from: its category's, or the universe's when it has none. */
interface PeerSet {
  global: number;
  globalP25: number;
  globalP75: number;
  byCategory: Map<string, CategoryMultiple>;
}

/** The multiple one protocol is priced at: its category's shrunk peer multiple, or the global one. */
function multipleFor(p: SnapshotProtocol, peers: PeerSet): CategoryMultiple {
  const found = peers.byCategory.get(p.category ?? 'Uncategorised');
  if (found !== undefined) return found;
  return { category: p.category ?? 'Uncategorised', peers: 0, raw_median: null, multiple: peers.global, p25: peers.globalP25, p75: peers.globalP75 };
}

/** How much peer evidence stands behind a multiple, graded for the reader. */
export type Evidence = 'deep' | 'fair' | 'thin' | 'universe';

/** The evidence grade for a peer count: 8+ prints is a market, 1-2 is an anecdote with shrinkage. */
export function evidenceFor(peerCount: number): Evidence {
  if (peerCount >= 8) return 'deep';
  if (peerCount >= 3) return 'fair';
  if (peerCount >= 1) return 'thin';
  return 'universe';
}

/** The three adjustments and the implied value one protocol gets, with every figure exposed. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  peers: PeerSet,
): {
  implied: number;
  impliedLow: number;
  impliedHigh: number;
  peer: CategoryMultiple;
  momentumMult: number;
  maturityMult: number;
  footprintMult: number;
  age: number | null;
  growthPct: number;
} {
  const peer = multipleFor(p, peers);
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const growthPct = Math.min(MODEL.momentum_cap_pct, Math.max(MODEL.momentum_floor_pct, rawGrowth));
  const momentumMult = Math.max(MODEL.momentum_min_mult, 1 + (growthPct / 100) * MODEL.momentum_weight);
  const ageForModel = age ?? MODEL.unknown_age_days;
  const maturityMult = MODEL.maturity_base + (Math.min(Math.max(ageForModel, 0), MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
  const extraChains = Math.min(Math.max(p.chains.length - 1, 0), MODEL.footprint_max_extra_chains);
  const footprintMult = 1 + MODEL.footprint_per_chain * extraChains;
  const rest = momentumMult * maturityMult * footprintMult;
  const implied = Math.max(1, Math.round(p.tvl_usd * peer.multiple * rest));
  // The same claim at the category's shrunk quartile multiples: the range the peer evidence
  // supports, clamped around the central value so rounding can never invert it.
  const impliedLow = Math.max(1, Math.min(implied, Math.round(p.tvl_usd * peer.p25 * rest)));
  const impliedHigh = Math.max(implied, Math.round(p.tvl_usd * peer.p75 * rest));
  return { implied, impliedLow, impliedHigh, peer, momentumMult, maturityMult, footprintMult, age, growthPct };
}

/**
 * The warnings one protocol's own record raises, in the order a reader should meet them.
 * Every flag is a threshold on a figure the row itself publishes; none names a protocol.
 */
export function flagsFor(
  p: SnapshotProtocol,
  v: { peer: CategoryMultiple; momentumMult: number; age: number | null },
): string[] {
  const flags: string[] = [];
  if (v.peer.peers === 0) flags.push('no-category-peers');
  else if (v.peer.peers <= 2) flags.push('thin-evidence');
  if (typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) && p.change_7d <= -15) flags.push('tvl-falling-fast');
  if (v.momentumMult >= 1.45) flags.push('one-hot-week');
  if (v.age === null) flags.push('age-unrecorded');
  else if (v.age < 180) flags.push('young');
  if (p.chains.length <= 1) flags.push('single-chain');
  return flags;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * A 0-100 signal score for the reader's eye, separate from the ranking: how much of the board's
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

/** One row of board.json: the ranked board's row, its arithmetic and its farm plan. */
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
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  evidence: Evidence;
  flags: string[];
  conviction: number;
  model: {
    peer_multiple: number;
    peer_multiple_p25: number;
    peer_multiple_p75: number;
    peer_count: number;
    global_multiple: number;
    momentum_multiplier: number;
    maturity_multiplier: number;
    footprint_multiplier: number;
  };
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

/** Everything the dashboard renders: the board, the live set, the peer table and the model. */
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
    token_bearing: number;
    peers_priced: number;
    aggregate_implied_usd: number;
    global_multiple: number;
  };
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

// ---- Farm plans -----------------------------------------------------------------------------

/** What one transaction costs on a chain, in the words of a plan: the chain sets the gas bill. */
function gasProfile(chain: string): { perTx: string; weekly: string } {
  if (chain === 'Ethereum') return { perTx: 'about $12-30 of mainnet gas per transaction at typical fees', weekly: 'about $15-35 of mainnet gas a week' };
  if (chain === 'Solana') return { perTx: 'well under $0.05 of network fees per transaction', weekly: 'under $1 of network fees a week' };
  const cheap = ['Arbitrum', 'Base', 'Optimism', 'zkSync Era', 'Linea', 'Scroll', 'Mantle', 'Blast', 'Mode', 'Polygon', 'BSC', 'Avalanche', 'Fantom', 'Sonic', 'Berachain', 'Monad', 'Hyperliquid L1'];
  if (cheap.includes(chain)) return { perTx: 'about $0.10-$1 of gas per transaction', weekly: 'about $1-3 of gas a week' };
  return { perTx: 'about $0.10-$2 of gas per transaction', weekly: 'about $1-4 of gas a week' };
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

// ---- The board --------------------------------------------------------------------------------

/** The protocols the board ranks, strongest first, with ranks 1..n and every figure shown. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const peers = peerMultiples(snapshot);
  const watch = new Set(snapshot.watchlist);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const candidates = [...chosen.values()];
  const ages = new Map(candidates.map((p) => [p.slug, ageDays(snapshot.as_of, p.listed_at)]));
  const logTvls = candidates.map((p) => Math.log10(Math.max(p.tvl_usd, 1)));
  const logMin = Math.min(...logTvls);
  const logMax = Math.max(...logTvls);
  const scored = candidates.map((p) => {
    const v = impliedValue(p, snapshot.as_of, peers);
    return { p, v, signal: conviction(p, v.age, v.growthPct, logMin, logMax) };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
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
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    implied_low_usd: s.v.impliedLow,
    implied_high_usd: s.v.impliedHigh,
    evidence: evidenceFor(s.v.peer.peers),
    flags: flagsFor(s.p, s.v),
    conviction: s.signal,
    model: {
      peer_multiple: round4(s.v.peer.multiple),
      peer_multiple_p25: round4(s.v.peer.p25),
      peer_multiple_p75: round4(s.v.peer.p75),
      peer_count: s.v.peer.peers,
      global_multiple: round4(peers.global),
      momentum_multiplier: round4(s.v.momentumMult),
      maturity_multiplier: round4(s.v.maturityMult),
      footprint_multiplier: round4(s.v.footprintMult),
    },
    farm_steps: farmSteps(s.p, s.v.age),
  }));
}

/** The token-bearing protocols, by market cap, for the dashboard's already-launched view. */
export function liveRows(snapshot: Snapshot, limit = 30): LiveRow[] {
  return snapshot.protocols
    .filter((p) => recordsToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, limit)
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
  const peers = peerMultiples(snapshot);
  const live = liveRows(snapshot);
  const preToken = snapshot.protocols.filter((p) => !recordsToken(p)).length;
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
      live_size: snapshot.protocols.length - preToken,
      token_bearing: snapshot.protocols.length - preToken,
      peers_priced: peers.peersPriced,
      aggregate_implied_usd: board.reduce((sum, r) => sum + r.implied_value_usd, 0),
      global_multiple: round4(peers.global),
    },
    categories: [...peers.byCategory.values()]
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
