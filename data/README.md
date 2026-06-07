# Rules knowledge base

This directory is the durable core of the product: a structured, versioned,
date-stamped record of what each prop firm's rulebook actually says, per
account plan / size / phase. Everything else (comparison view, future
per-account tracker) is a query or a computation over this data — no firm's
rules live anywhere else, and no UI should hardcode a number that belongs here.

## Layout

```
data/
  firms.json           registry of firms (identity, links, status) — see schema/firm.schema.json
  rules/
    <firm_id>.json     array of versioned rule records for that firm — see schema/firm-account-rules.schema.json
```

Each record in `rules/<firm_id>.json` is one immutable, dated snapshot of the
rules that apply to a single (firm, plan, account size, phase) combination.
`firms.json` only carries identity/links — rebrands, URL changes, and status
flips never require touching historical rule data.

## The two rules this model is built around

1. **Version every record with dates — apply the rule live at trade time.**
   A rule record is a fact about a *time interval*, not a fact about "now".
   `effective_from` / `effective_to` define that interval; `version` numbers
   the lineage; `status` tracks human verification. To evaluate a trade (or
   render "what applies today"), pick the record in the lineage where
   `effective_from <= as_of_date < effective_to (or effective_to is null)`.
   Records are **append-only**: a rule change produces a *new* record with
   `version = previous + 1`, and the act of publishing it sets the *previous*
   record's `effective_to` to the new one's `effective_from`. Never edit a
   published record's terms in place — that destroys the ability to correctly
   judge a trade that happened under the old rule, and silently corrupts any
   "as of" comparison a user runs against a past date.

2. **Enums + structured params over prose — the value is computation.**
   Every field that a computation depends on (distance-to-breach, consistency
   math, payout eligibility, "is this allowed") is an enum or a typed
   parameter object, never a free string to be parsed at read time. Free text
   (`notes`, `*_definition`, `change_notes`) exists only to carry
   human-readable caveats *alongside* the structured value — it should never
   be the only place a fact that drives a decision is recorded. If you find
   yourself wanting to express a rule only in prose, that's a signal the
   schema is missing a field; extend the schema (bump `schema_version`)
   rather than smuggling computation-relevant facts into `notes`.

## Record lineage and `record_id`

`record_id` is `<firm_id>-<plan-slug>-<account-size>-<phase>--v<version>`,
e.g. `apex-static-50k-evaluation--v1`. The portion before `--v` is the
**lineage key** — group on it and sort by `version` to reconstruct a rule's
full history. `firm_id` + `plan_name` + `account_size` + `phase` together
must uniquely resolve to exactly one *currently effective* record at any
given date; if two records in the same lineage would both be effective on
the same date, that's a data bug (close the gap/overlap before publishing).

## Status values and what they mean for consumers

- `draft` — entered from a secondary/inferred source (forum posts, third-party
  trackers, archived pages) and **not yet confirmed against the firm's own
  rulebook**. The UI must show a visible "needs verification" badge and link
  `source_url`. Treat numeric values in `draft` records as best-effort
  estimates, not facts to act on.
- `verified` — a human checked every field against `source_url` on
  `last_verified_on`. This is the bar for "safe to compute breach distances
  against" in the future tracker.
- `superseded` — `effective_to` has passed; a newer version is now current.
  Kept for history/audit and for evaluating past trades; excluded from
  "current rules" views by default.

## Updating a record (the only sanctioned workflow)

1. Confirm the change against the firm's own source (not a third-party
   aggregator) and capture the new `source_url`.
2. Append a **new** record to `rules/<firm_id>.json` with
   `version = old.version + 1`, a fresh `record_id`, the new
   `effective_from`, `effective_to: null`, `status: "draft"` until verified,
   and a `change_notes` line describing exactly what changed and why.
3. Set the **old** record's `effective_to` to the new record's
   `effective_from` and flip its `status` to `"superseded"`.
4. Never delete a record. Defunct firms/plans get `status: "defunct"` on the
   firm registry entry and their lineages simply stop receiving new versions.

## Seed data status

The seed records under `rules/` were compiled from the firms' own published
rules pages plus, where official pages were unreachable or ambiguous,
cross-checked third-party trackers — every such gap is called out in that
record's `notes`/`change_notes` and its `status` is left as `draft` pending
the operator's firsthand verification against `source_url`. **Do not treat
seed numbers as launch-ready facts** — that verification pass is a
prerequisite for showing this data to end users as authoritative.
