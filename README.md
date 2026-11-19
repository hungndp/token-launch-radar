# Token Launch Radar

A radar for pre-token protocols, priced by a model the data itself chooses.

Most launch dashboards rank by raw TVL or raw hype. This one asks a
different question: *given what comparable traded protocols are worth,
what would this protocol's token plausibly price at — how sure are we,
and is it worth farming?*

## How it works (radar-4)

- Starts from a sealed DefiLlama snapshot of **758 protocols** and a
  40-protocol watchlist. Every protocol is accounted for: **198 ranked**,
  **416 already launched** (shown in full), **144 set aside** — each with
  its reason printed next to it.
- **A model contest, not a model claim.** Five candidate pricing models
  (flat universe multiple, category medians, adjustment-tested category
  medians, a log-log size curve, and the curve plus category offsets) are
  fitted to the 128 traded protocols that carry both a market cap and a
  TVL, then tested **leave-one-out**: each must predict a held-out peer's
  recorded market cap. The winner — a size curve, median |log₁₀ error|
  0.5498 against the category model's 0.7310 — prices the board. The full
  contest table is published on the dashboard's method page.
- **Ranges from 200 bootstrap refits** of the winning model (seeded, so
  the board is byte-for-byte reproducible): every row carries a value
  range and a rank range, not a bare number.
- **Three comparable lenses per row** — its category's peers, its main
  chain's peers, and peers within 3× of its TVL — with the largest traded
  protocols behind each lens **named on the row's page**, and a 0–100
  confidence score from how many distinct peers stand behind the row
  (79 on average) and how closely the lenses agree.
- **Farm plans, netted.** Each row's plan is priced in dollars at its
  chain's gas estimates and verdicted **farm / thin / skip** against
  stated thresholds (6 / 154 / 38 on the current board).
- Every row also carries an evidence grade, risk flags, and a written
  "what could make this estimate wrong" section.
- Fully deterministic: the same snapshot always produces the same board,
  the same dossier, the same screenshots.

## Run it

```
node main.ts
```

Reads the snapshot from `/input/snapshot.json` (or `--input <file|dir>`),
writes `board.json`, `data.js`, the dashboard and `dossier.json` to the
output directory. Node 22, standard library only.

## Layout

- `main.ts` — the program: snapshot in, board + dashboard + dossier out.
- `lib/model.ts` — the model: peer universe, the five candidates, the
  leave-one-out contest, bootstrap ranges, the three lenses, farm plans.
- `dashboard/` — the static page the dossier carries (board, launched
  set, set-aside annex, method & validation, per-protocol detail).
- `screenshots/` — the three dossier images, rendered from the dashboard.
- `vendor/` — the competition kit's board library, byte for byte.

Built as an entry to make.fun's token-radar-01 bounty.
