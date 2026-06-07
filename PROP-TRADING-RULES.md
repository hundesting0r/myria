# Cross-firm prop trading rules intelligence — v1

A read-only product for futures prop traders running accounts across multiple
firms (Apex, Take Profit Trader, Tradeify, etc.) at once. The defensible core
is **rules intelligence**: encoding each firm's rulebook in a structured,
versioned, queryable form, normalizing across firms, and surfacing exactly
where they disagree — *not* live risk/drawdown monitoring (Tradovate Prop
already ships that for free; this product is not in that business).

> Note: this lives alongside this repo's unrelated Myria-node scheduler
> content (`README.md`, `schedule-node.sh`) — a separate tool that happens to
> share this repo. Nothing here depends on or modifies that.

## What's here (v1, in build order)

1. **Rules knowledge base** — `schema/` + `data/`
   The durable core asset. A versioned, date-stamped, source-linked record of
   each firm's rules per account plan/size/phase, modeled with enums and
   structured params (not prose) wherever a value drives computation —
   because the whole point is to compute distance-to-breach, consistency math,
   and payout eligibility correctly per firm. See `data/README.md` for the
   data model's two governing rules (version everything with dates; enums
   over prose) and the record-update workflow.

   Seeded with **3 firms × 2 phases each** (Apex, Take Profit Trader,
   Tradeify — evaluation + funded, all at $50K for apples-to-apples
   comparison). Every seed record is marked `status: "draft"` with a
   `source_url` and a `change_notes` field calling out exactly what's
   confirmed vs. estimated — **these need a human verification pass against
   each firm's live rulebook before they're shown to end users as fact.**

2. **Cross-firm comparison view** — `app/`
   The headline feature and free-tier marketing surface: pick any combination
   of (firm, plan, size, phase) and see every normalized rule side by side,
   with disagreements flagged automatically (`◆ differs`). It is *only* a
   query across the knowledge base — no account data, no backend computation,
   works at zero cost to a visitor. Static HTML/CSS/vanilla JS, fetches the
   JSON straight from `/data/*` (the same files the validator and the future
   tracker read), zero build step.

3. **Per-account tracker** — not built yet (needs Tradovate read-only data).
   The data model is already shaped for it: `effective_from`/`effective_to`
   let it resolve "which rule applied to this trade", and `drawdown.type` +
   `drawdown.calculation_basis` + `drawdown.amount` + `drawdown.lock` are
   exactly the structured inputs a distance-to-breach calculator needs per
   firm. When this gets built, the data source (Tradovate or otherwise)
   should be a swappable adapter behind that same rules engine — not the
   other way around.

## Running it

```bash
npm install          # one-time
npm run validate     # checks every record against the schema + lineage invariants
npm run dev          # serves the comparison view at http://localhost:4321/
```

`npm run dev` starts a small zero-dependency static server (`app/server.mjs`)
that serves the whole repo root, so the app can `fetch()` `/data/firms.json`
and `/data/rules/<firm_id>.json` directly — no copying, no build step, and
the UI can never drift from the data the validator checks.

## Layout

```
schema/
  firm-account-rules.schema.json   the rule-record shape (the core data model)
  firm.schema.json                 the firm-registry shape
data/
  README.md                        data model explainer + update workflow
  firms.json                       firm registry (identity, links, status)
  rules/<firm_id>.json             versioned rule records per firm
app/
  index.html, app.js, styles.css   the comparison view (static, no backend)
  server.mjs                       dev server (serves repo root)
scripts/
  validate-data.mjs                schema + cross-record invariant checks
```

## Extending the knowledge base

Add a firm by appending to `data/firms.json` and creating
`data/rules/<firm_id>.json`; add a rule version by following the append-only
workflow in `data/README.md`. Run `npm run validate` before committing —
it checks every record against the schema *and* checks that each lineage's
`effective_from`/`effective_to` ranges tile the timeline with no gaps or
overlaps (a defect the schema alone can't express). The comparison view picks
up new firms/records automatically; nothing in `app/` needs to change.
