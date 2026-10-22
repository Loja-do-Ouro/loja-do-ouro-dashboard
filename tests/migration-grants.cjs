const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// From 30-10-2026 Supabase no longer grants the Data API roles (anon, authenticated, service_role) access to new
// tables in public. Each migration that creates a table or view in public must therefore say, in the same file,
// who may use it: enable RLS (tables) and an explicit revoke/grant. The dashboard reaches the data only through
// the ldo_* security definer functions, so the usual answer is "revoke all ... from anon, authenticated".
const dir = path.join(__dirname, "..", "supabase", "migrations");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

// Statements without comments, in lowercase, with whitespace collapsed.
function statements(sql) {
  return sql.replace(/--[^\n]*/g, "").toLowerCase().split(";").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}

const mentions = (stmt, name) => new RegExp(`\\bpublic\\.${name}\\b`).test(stmt);

test("Every new table or view in public has RLS and explicit privileges in the same migration", () => {
  const problems = [];
  for (const file of files) {
    const stmts = statements(fs.readFileSync(path.join(dir, file), "utf8"));
    for (const s of stmts) {
      const m = /^create (?:or replace )?(table|view|materialized view)(?: if not exists)? public\.([a-z0-9_]+)/.exec(s);
      if (!m) continue;
      const [, kind, name] = m;
      if (kind === "table" && !stmts.some((t) => new RegExp(`^alter table (?:only )?public\\.${name} enable row level security`).test(t)))
        problems.push(`${file}: public.${name} without "enable row level security"`);
      if (!stmts.some((t) => /^(revoke|grant) /.test(t) && / on (?:table )?/.test(t) && mentions(t, name)))
        problems.push(`${file}: public.${name} without an explicit revoke/grant`);
    }
  }
  assert.deepEqual(problems, []);
});

test("No migration restores the automatic grants on every table or sequence of public", () => {
  for (const file of files) {
    for (const s of statements(fs.readFileSync(path.join(dir, file), "utf8"))) {
      assert.ok(!/^grant .* on all (tables|sequences) in schema public/.test(s), `${file}: ${s.slice(0, 120)}`);
      assert.ok(!/^alter default privileges .* in schema public grant /.test(s), `${file}: ${s.slice(0, 120)}`);
    }
  }
});
