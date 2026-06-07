// Cross-firm rules comparison view.
//
// This is deliberately "just a query across the knowledge base": it fetches
// firms.json + each firm's rules/<firm_id>.json straight from /data — the
// same files scripts/validate-data.mjs checks and the future tracker will
// read — picks the record that is CURRENTLY EFFECTIVE for each (firm, plan,
// size, phase) combination, and renders the normalized fields side by side.
// No server-side computation, no account data: this view works at zero cost
// to a visitor with no Tradovate connection, which is the point.

const TODAY = new Date().toISOString().slice(0, 10);

const PHASE_LABELS = { evaluation: "Evaluation", funded: "Funded" };

const DRAWDOWN_TYPE_LABELS = {
  EOD_trailing: "End-of-day trailing",
  intraday_trailing: "Intraday (real-time) trailing",
  static: "Static (fixed floor)",
};

const CALC_BASIS_LABELS = {
  balance: "Closed-trade balance (EOD/realized)",
  equity: "Equity (incl. open-position P&L)",
};

const LOCK_TRIGGER_PHRASES = {
  balance_reaches_starting_balance: "once balance reaches the starting balance",
  unrealized_profit_reaches_threshold: "once unrealized profit reaches a threshold",
  profit_target_reached: "once the profit target is reached",
  never: "never — keeps trailing for the account's lifetime",
  not_applicable: "not applicable",
};

const CONSISTENCY_BASIS_LABELS = {
  best_day_share_of_total_profit: "Best day ÷ all-time cumulative profit",
  best_day_share_of_payout_eligible_profit: "Best day ÷ profit since last payout",
  none: "No consistency rule",
};

const CONSISTENCY_APPLIES_LABELS = {
  evaluation: "Evaluation",
  funded: "Funded",
  payout_calculation: "Payout calculation",
};

const CADENCE_LABELS = {
  on_demand: "On demand",
  weekly: "Weekly",
  biweekly: "Every two weeks",
  monthly: "Monthly",
  first_payout_then_on_demand: "First payout scheduled, then on demand",
  other: "Cycle-based (see notes)",
  not_applicable: "Not applicable",
};

const STATUS_META = {
  prohibited: { label: "Prohibited", cls: "status-bad" },
  restricted: { label: "Restricted", cls: "status-warn" },
  allowed: { label: "Allowed", cls: "status-good" },
  not_addressed: { label: "Not addressed", cls: "status-unknown" },
};

const COPY_SCOPE_META = {
  prohibited: { label: "Prohibited", cls: "status-bad" },
  own_accounts_only: { label: "Own accounts only", cls: "status-ok" },
  unrestricted: { label: "Unrestricted", cls: "status-good" },
  not_addressed: { label: "Not addressed", cls: "status-unknown" },
};

const RECORD_STATUS_META = {
  draft: { label: "Draft — needs verification", cls: "status-warn" },
  verified: { label: "Verified", cls: "status-good" },
  superseded: { label: "Superseded", cls: "status-unknown" },
};

// ---------------------------------------------------------------------------
// Tiny DOM helper — keeps rendering free of innerHTML/string concatenation so
// nothing from the data layer can be interpreted as markup.
// ---------------------------------------------------------------------------
function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else node.setAttribute(key, value === true ? "" : value);
    }
  }
  for (const child of [].concat(children ?? [])) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
function fmtUSD(amount) {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtMoneyOrPercent(value, accountSize) {
  if (value == null) return null;
  if (value.kind === "fixed_dollar") return fmtUSD(value.value);
  const resolved = accountSize != null ? fmtUSD((value.value / 100) * accountSize) : null;
  return resolved ? `${value.value}% (≈ ${resolved} on this account size)` : `${value.value}%`;
}

function truncate(text, maxLen = 70) {
  if (!text) return text;
  return text.length > maxLen ? `${text.slice(0, maxLen - 1).trimEnd()}…` : text;
}

function lockSummary(lock, accountSize) {
  if (!lock.locks) return "Never locks — " + (LOCK_TRIGGER_PHRASES[lock.trigger] ?? lock.trigger);
  const level = lock.locked_level ? fmtMoneyOrPercent(lock.locked_level, accountSize) : "an undisclosed level";
  const trigger = LOCK_TRIGGER_PHRASES[lock.trigger] ?? lock.trigger;
  return `Freezes at ${level} (${trigger})`;
}

// ---------------------------------------------------------------------------
// Loading the knowledge base — plain fetch() against the JSON files. Firms
// with no rules file yet (or a 404) are skipped silently: the view always
// reflects exactly what's in data/, nothing hardcoded here.
// ---------------------------------------------------------------------------
async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

async function loadKnowledgeBase() {
  const firms = await fetchJson("/data/firms.json");
  const recordsByFirm = new Map();
  await Promise.all(
    firms.map(async (firm) => {
      try {
        recordsByFirm.set(firm.firm_id, await fetchJson(`/data/rules/${firm.firm_id}.json`));
      } catch {
        recordsByFirm.set(firm.firm_id, []);
      }
    })
  );
  return { firms, recordsByFirm };
}

function isCurrentlyEffective(record, asOfDate) {
  if (record.status === "superseded") return false;
  if (record.effective_from > asOfDate) return false;
  if (record.effective_to !== null && asOfDate >= record.effective_to) return false;
  return true;
}

// One "entry" = the currently-effective record for one (firm, plan, size,
// phase) lineage — exactly what a visitor picking accounts to compare thinks
// of as a single option.
function buildEntries(firms, recordsByFirm) {
  const entries = [];
  for (const firm of firms) {
    for (const record of recordsByFirm.get(firm.firm_id) ?? []) {
      if (isCurrentlyEffective(record, TODAY)) entries.push({ firm, record });
    }
  }
  entries.sort((a, b) => {
    const byFirm = a.firm.display_name.localeCompare(b.firm.display_name);
    if (byFirm !== 0) return byFirm;
    const byPhase = a.record.phase.localeCompare(b.record.phase);
    if (byPhase !== 0) return byPhase;
    return a.record.account_size - b.record.account_size;
  });
  return entries;
}

function entryLabel({ record }) {
  return `${record.phase_label || PHASE_LABELS[record.phase]} — ${record.plan_name} — ${fmtUSD(record.account_size)}`;
}

// ---------------------------------------------------------------------------
// Picker — checkboxes grouped by firm, driving which columns appear.
// ---------------------------------------------------------------------------
function renderPicker(container, entries, selected, onChange) {
  container.replaceChildren();
  container.append(el("h2", { text: "1. Choose accounts to compare" }));
  container.append(
    el("p", { class: "hint", text: "Pick two or more to see them side by side. Cells where the selected accounts disagree are marked so the differences jump out." })
  );

  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.firm.firm_id)) groups.set(entry.firm.firm_id, []);
    groups.get(entry.firm.firm_id).push(entry);
  }

  const groupsEl = el("div", { class: "picker-groups" });
  for (const [, groupEntries] of groups) {
    const firm = groupEntries[0].firm;
    const fieldset = el("fieldset", { class: "picker-group" });
    fieldset.append(el("legend", { text: firm.display_name }));
    for (const entry of groupEntries) {
      const id = `pick-${entry.record.record_id}`;
      const checkbox = el("input", {
        type: "checkbox",
        id,
        checked: selected.has(entry.record.record_id) || undefined,
      });
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(entry.record.record_id);
        else selected.delete(entry.record.record_id);
        onChange();
      });
      const label = el("label", { for: id }, [checkbox, " ", entryLabel(entry)]);
      fieldset.append(label);
    }
    groupsEl.append(fieldset);
  }
  container.append(groupsEl);
}

// ---------------------------------------------------------------------------
// Comparison table — one column per selected entry, one row per normalized
// rule dimension, grouped into the sections the schema itself is organized
// around (so the table is a direct reflection of the data model, not a
// separate view-layer taxonomy that can drift from it).
// ---------------------------------------------------------------------------
function cellContent({ text, notes, href, statusCls }) {
  const wrap = el("div", { class: "cell" });
  if (statusCls) wrap.append(el("span", { class: `badge ${statusCls}`, text: text ?? "—" }));
  else if (href) wrap.append(el("a", { href, target: "_blank", rel: "noopener noreferrer", text: text ?? "View source" }));
  else wrap.append(el("span", { class: "cell-text", text: text ?? "—" }));
  if (notes) wrap.append(el("span", { class: "info-icon", title: notes, "aria-label": `Details: ${notes}` }, "ⓘ"));
  return wrap;
}

function behaviorCell(policy, metaTable = STATUS_META) {
  const meta = metaTable[policy.status ?? policy.scope] ?? { label: policy.status ?? policy.scope, cls: "status-unknown" };
  return { text: meta.label, statusCls: meta.cls, notes: policy.notes || null };
}

const SECTIONS = [
  {
    title: "Identity & verification",
    rows: [
      { label: "Firm", render: (r, f) => ({ text: f.display_name, href: f.website_url }) },
      { label: "Plan", render: (r) => ({ text: r.plan_name }) },
      { label: "Account size", render: (r) => ({ text: fmtUSD(r.account_size) }) },
      { label: "Phase", render: (r) => ({ text: r.phase_label || PHASE_LABELS[r.phase] }) },
      {
        label: "Record status",
        render: (r) => {
          const meta = RECORD_STATUS_META[r.status] ?? { label: r.status, cls: "status-unknown" };
          return { text: meta.label, statusCls: meta.cls, notes: r.change_notes || null };
        },
      },
      {
        label: "Source",
        render: (r) => ({ text: "View rulebook ↗", href: r.source_url, notes: `Last checked ${r.last_verified_on}. Effective from ${r.effective_from}${r.effective_to ? ` to ${r.effective_to}` : " (current)"}.` }),
      },
    ],
  },
  {
    title: "Drawdown — distance to breach",
    rows: [
      { label: "Type", render: (r) => ({ text: DRAWDOWN_TYPE_LABELS[r.drawdown.type] ?? r.drawdown.type, notes: r.drawdown.notes || null }) },
      { label: "Calculated against", render: (r) => ({ text: CALC_BASIS_LABELS[r.drawdown.calculation_basis] ?? r.drawdown.calculation_basis }) },
      { label: "Drawdown amount", render: (r) => ({ text: fmtMoneyOrPercent(r.drawdown.amount, r.account_size) }) },
      { label: "Lock behavior", render: (r) => ({ text: lockSummary(r.drawdown.lock, r.account_size), notes: r.drawdown.lock.notes || null }) },
    ],
  },
  {
    title: "Consistency rule",
    rows: [
      {
        label: "Cap",
        render: (r) => ({ text: r.consistency_rule.cap_percentage === 0 ? "No cap" : `Best day ≤ ${r.consistency_rule.cap_percentage}% of total profit` }),
      },
      {
        label: "How it's measured",
        render: (r) => ({ text: CONSISTENCY_BASIS_LABELS[r.consistency_rule.basis] ?? r.consistency_rule.basis, notes: r.consistency_rule.basis_definition || null }),
      },
      {
        label: "Enforced at",
        render: (r) => ({
          text: r.consistency_rule.applies_at.length
            ? r.consistency_rule.applies_at.map((p) => CONSISTENCY_APPLIES_LABELS[p] ?? p).join(", ")
            : "Not enforced",
        }),
      },
      {
        label: "On breach",
        render: (r) => {
          const consequence = r.consistency_rule.violation_consequence;
          return consequence ? { text: truncate(consequence), notes: consequence } : { text: "—" };
        },
      },
    ],
  },
  {
    title: "Targets & qualifying days",
    rows: [
      { label: "Profit target", render: (r) => ({ text: fmtMoneyOrPercent(r.targets_and_days.profit_target, r.account_size) ?? "None" }) },
      { label: "Min. trading days", render: (r) => ({ text: r.targets_and_days.min_trading_days === 0 ? "None" : String(r.targets_and_days.min_trading_days), notes: r.targets_and_days.notes || null }) },
      { label: "Min. $ for a qualifying day", render: (r) => ({ text: fmtMoneyOrPercent(r.targets_and_days.min_qualifying_day_amount, r.account_size) ?? "No minimum" }) },
    ],
  },
  {
    title: "Payout",
    rows: [
      {
        label: "Eligible to withdraw",
        render: (r) => ({ text: r.payout.eligible ? "Yes" : "No", statusCls: r.payout.eligible ? "status-good" : "status-unknown", notes: r.payout.eligibility_notes || null }),
      },
      { label: "Min payout", render: (r) => ({ text: fmtMoneyOrPercent(r.payout.min_amount, r.account_size) ?? "—" }) },
      { label: "Max payout", render: (r) => ({ text: fmtMoneyOrPercent(r.payout.max_amount, r.account_size) ?? "—" }) },
      { label: "Cadence", render: (r) => ({ text: CADENCE_LABELS[r.payout.cadence] ?? r.payout.cadence, notes: r.payout.cadence_notes || null }) },
      {
        label: "Activation fee before 1st withdrawal",
        render: (r) => ({
          text: r.payout.activation_fee.required ? (fmtMoneyOrPercent(r.payout.activation_fee.amount, r.account_size) ?? "Yes (amount undisclosed)") : "None",
          statusCls: r.payout.activation_fee.required ? "status-warn" : "status-good",
        }),
      },
      {
        label: "Profit split to trader",
        render: (r) => ({ text: r.payout.profit_split_to_trader_percentage != null ? `${r.payout.profit_split_to_trader_percentage}%` : "—" }),
      },
    ],
  },
  {
    title: "Prohibited & restricted behaviors",
    rows: [
      { label: "Automated / bot trading", render: (r) => behaviorCell(r.prohibited_behaviors.automated_trading) },
      { label: "Cross-account hedging", render: (r) => behaviorCell(r.prohibited_behaviors.cross_account_hedging) },
      { label: "DCA / martingale", render: (r) => behaviorCell(r.prohibited_behaviors.dca_or_martingale) },
      { label: "News trading", render: (r) => behaviorCell(r.prohibited_behaviors.news_trading) },
      { label: "VPN / VPS usage", render: (r) => behaviorCell(r.prohibited_behaviors.vpn_usage) },
      { label: "Copy trading", render: (r) => behaviorCell(r.prohibited_behaviors.copy_trading, COPY_SCOPE_META) },
    ],
  },
];

function normalizeForComparison(text) {
  return (text ?? "").trim().toLowerCase();
}

function renderComparison(container, entries, selected) {
  container.replaceChildren();
  container.append(el("h2", { text: "2. Compare side by side" }));

  const chosen = entries.filter((e) => selected.has(e.record.record_id));

  if (chosen.length === 0) {
    container.append(el("p", { class: "hint", text: "Select at least one account above to see its rules here." }));
    return;
  }
  if (chosen.length === 1) {
    container.append(el("p", { class: "hint", text: "Select a second account to compare it against — differences will be highlighted automatically." }));
  } else {
    container.append(el("p", { class: "hint" }, [
      "Rows marked ",
      el("span", { class: "differs-flag", text: "◆ differs" }),
      " are where these accounts disagree — exactly the kind of gap that gets accounts disabled when a trader assumes one firm's rule applies everywhere.",
    ]));
  }

  const table = el("table", { class: "comparison" });
  const thead = el("thead");
  const headRow = el("tr");
  headRow.append(el("th", { class: "row-label-col", scope: "col", text: "" }));
  for (const entry of chosen) {
    headRow.append(
      el("th", { scope: "col" }, [
        el("div", { class: "col-firm", text: entry.firm.display_name }),
        el("div", { class: "col-plan", text: entryLabel(entry) }),
      ])
    );
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = el("tbody");
  for (const section of SECTIONS) {
    tbody.append(
      el("tr", { class: "section-row" }, [el("th", { colspan: String(chosen.length + 1), scope: "colgroup", text: section.title })])
    );
    for (const row of section.rows) {
      const rendered = chosen.map((entry) => row.render(entry.record, entry.firm));
      const distinctValues = new Set(rendered.map((r) => normalizeForComparison(r.text)));
      const differs = chosen.length > 1 && distinctValues.size > 1;

      const tr = el("tr", { class: differs ? "differs" : null });
      tr.append(
        el("th", { scope: "row" }, [row.label, differs ? el("span", { class: "differs-flag", text: " ◆ differs" }) : null])
      );
      for (const content of rendered) {
        tr.append(el("td", null, cellContent(content)));
      }
      tbody.append(tr);
    }
  }
  table.append(tbody);

  const scrollWrap = el("div", { class: "table-scroll" }, table);
  container.append(scrollWrap);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  const pickerEl = document.getElementById("picker");
  const comparisonEl = document.getElementById("comparison");

  try {
    const { firms, recordsByFirm } = await loadKnowledgeBase();
    const entries = buildEntries(firms, recordsByFirm);

    if (entries.length === 0) {
      pickerEl.append(el("p", { class: "hint", text: "No currently-effective rule records were found in the knowledge base." }));
      return;
    }

    // Default to the funded-phase accounts: that's where the sharpest,
    // highest-stakes divergence between firms shows up (consistency caps,
    // drawdown mechanics, copy-trading scope), and it's the strongest
    // first impression for a visitor who has never seen this product.
    const selected = new Set(entries.filter((e) => e.record.phase === "funded").map((e) => e.record.record_id));

    const rerender = () => renderComparison(comparisonEl, entries, selected);
    renderPicker(pickerEl, entries, selected, rerender);
    rerender();
  } catch (err) {
    pickerEl.append(
      el("p", { class: "hint error", text: `Couldn't load the knowledge base (${err.message}). Make sure you're running this through the dev server (npm run dev), not opening index.html directly — the data is fetched from /data/*.` })
    );
  }
}

main();
