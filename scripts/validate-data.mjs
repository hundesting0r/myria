#!/usr/bin/env node
// Validates every record under data/rules/*.json against the rule-record
// schema, and data/firms.json against the firm-registry schema. Also checks
// cross-cutting invariants the JSON Schema can't express on its own
// (lineage versioning, effective-date coverage, firm_id references).
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);

async function loadJson(relPath) {
  return JSON.parse(await readFile(join(root, relPath), "utf8"));
}

const ruleSchema = await loadJson("schema/firm-account-rules.schema.json");
const firmSchema = await loadJson("schema/firm.schema.json");
const validateRule = ajv.compile(ruleSchema);
const validateFirm = ajv.compile(firmSchema);

let failures = 0;
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  failures++;
};
const pass = (msg) => console.log(`✓ ${msg}`);

// 1. Firm registry
const firms = await loadJson("data/firms.json");
for (const firm of firms) {
  if (validateFirm(firm)) pass(`firms.json: '${firm.firm_id}' conforms to firm.schema.json`);
  else fail(`firms.json: '${firm.firm_id ?? "?"}' — ${ajv.errorsText(validateFirm.errors)}`);
}
const firmIds = new Set(firms.map((f) => f.firm_id));

// 2. Rule records
const rulesDir = join(root, "data", "rules");
const files = (await readdir(rulesDir)).filter((f) => f.endsWith(".json"));
if (files.length === 0) fail("data/rules/ contains no record files");

for (const file of files) {
  const records = await loadJson(`data/rules/${file}`);
  if (!Array.isArray(records)) {
    fail(`${file}: expected an array of records`);
    continue;
  }

  const lineages = new Map(); // lineage key -> [records]
  for (const record of records) {
    const label = record.record_id ?? "(missing record_id)";

    if (validateRule(record)) pass(`${file}: ${label} conforms to firm-account-rules.schema.json`);
    else fail(`${file}: ${label} — ${ajv.errorsText(validateRule.errors)}`);

    if (record.firm_id && !firmIds.has(record.firm_id)) {
      fail(`${file}: ${label} references unknown firm_id '${record.firm_id}' (not in firms.json)`);
    }
    if (file !== `${record.firm_id}.json`) {
      fail(`${file}: ${label} has firm_id '${record.firm_id}' but lives in ${file} — one file per firm_id is the convention`);
    }

    const lineageKey = (record.record_id ?? "").replace(/--v\d+$/, "");
    if (!lineages.has(lineageKey)) lineages.set(lineageKey, []);
    lineages.get(lineageKey).push(record);
  }

  // Lineage invariants: versions are sequential from 1, and at most one
  // record in a lineage may be "open" (effective_to: null) at a time, with
  // no overlapping/gapped effective ranges.
  for (const [lineageKey, group] of lineages) {
    const sorted = [...group].sort((a, b) => a.version - b.version);
    sorted.forEach((record, i) => {
      if (record.version !== i + 1) {
        fail(`${file}: lineage '${lineageKey}' — expected version ${i + 1} but found ${record.version} on ${record.record_id}`);
      }
      if (record.record_id !== `${lineageKey}--v${record.version}`) {
        fail(`${file}: record_id '${record.record_id}' doesn't match its own lineage key '${lineageKey}' + version`);
      }
    });
    const open = sorted.filter((r) => r.effective_to === null);
    if (open.length > 1) {
      fail(`${file}: lineage '${lineageKey}' has ${open.length} open-ended records (effective_to: null) — only the current version may be open`);
    }
    for (let i = 0; i < sorted.length - 1; i++) {
      const [current, next] = [sorted[i], sorted[i + 1]];
      if (current.effective_to !== next.effective_from) {
        fail(`${file}: lineage '${lineageKey}' — ${current.record_id}.effective_to (${current.effective_to}) must equal ${next.record_id}.effective_from (${next.effective_from}); versions must tile the timeline with no gap or overlap`);
      }
    }
    pass(`${file}: lineage '${lineageKey}' — ${sorted.length} version(s), timeline is contiguous`);
  }
}

console.log(`\n${failures === 0 ? "All checks passed" : `${failures} check(s) failed`}.`);
process.exit(failures === 0 ? 0 : 1);
