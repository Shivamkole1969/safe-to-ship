'use strict';
const { isTestFile } = require('../context');
// Supabase Row Level Security and Firebase rules: the most common way AI-built apps leak user data.

const SENSITIVE = /user|profile|account|order|payment|message|customer|invoice|address|email|phone|subscri|chat|note|document|file|secret|token|session/i;

function norm(name) {
  const parts = name.replace(/"/g, '').toLowerCase().split('.');
  return parts.length === 2 ? { schema: parts[0], table: parts[1] } : { schema: 'public', table: parts[0] };
}

function supabase(ctx) {
  const out = [];
  const usesSupabase = ctx.deps.has('@supabase/supabase-js') || ctx.deps.has('@supabase/ssr') || ctx.has('supabase/config.toml') ||
    ctx.files.some((f) => /\.(js|ts|jsx|tsx)$/.test(f) && !isTestFile(f) && /supabase\.co\b/.test(ctx.read(f)));
  const sqlFiles = ctx.files.filter((f) => f.endsWith('.sql'));
  if (!sqlFiles.length) {
    if (usesSupabase) {
      out.push({
        id: 'supabase-rls-unverified', severity: 'medium', file: null,
        title: 'Supabase is used, but no SQL migrations are in the repo',
        detail: 'Row Level Security can only be checked from code when the schema lives in the repo. Tables made in the dashboard are often left with RLS off, which lets anyone holding your public anon key read or change them.',
        fix: 'Open Supabase Dashboard > Advisors > Security Advisor and fix every "RLS disabled in public" item. Then run `supabase db pull` so the schema is versioned and this tool can check it.'
      });
    }
    return out;
  }
  const tables = new Map();
  const rls = new Set();
  const policies = [];
  for (const f of sqlFiles) {
    const text = ctx.read(f).replace(/--[^\n]*/g, (s) => ' '.repeat(s.length));
    let m;
    const ct = /create\s+table\s+(?:if\s+not\s+exists\s+)?((?:"?\w+"?\.)?"?\w+"?)/gi;
    while ((m = ct.exec(text))) {
      const n = norm(m[1]);
      if (n.schema === 'public' && !tables.has(n.table)) tables.set(n.table, { file: f, line: ctx.lineOf(text, m.index) });
    }
    const dt = /drop\s+table\s+(?:if\s+exists\s+)?((?:"?\w+"?\.)?"?\w+"?)/gi;
    while ((m = dt.exec(text))) { const n = norm(m[1]); if (n.schema === 'public') tables.delete(n.table); }
    const er = /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?((?:"?\w+"?\.)?"?\w+"?)\s+enable\s+row\s+level\s+security/gi;
    while ((m = er.exec(text))) rls.add(norm(m[1]).table);
    const cp = /create\s+policy\s+("[^"]+"|\w+)\s+on\s+((?:"?\w+"?\.)?"?\w+"?)([\s\S]*?);/gi;
    while ((m = cp.exec(text))) policies.push({ name: m[1], table: norm(m[2]).table, body: m[3], file: f, line: ctx.lineOf(text, m.index) });
    const cv = /create\s+(?:or\s+replace\s+)?view\s+((?:"?\w+"?\.)?"?\w+"?)([\s\S]*?)\bas\b/gi;
    while ((m = cv.exec(text))) {
      const n = norm(m[1]);
      if (n.schema === 'public' && !/security_invoker/i.test(m[2])) {
        out.push({
          id: 'supabase-view-definer', severity: 'medium', file: f, line: ctx.lineOf(text, m.index),
          title: 'View public.' + n.table + ' runs with its owner\'s rights',
          detail: 'Views in the public schema ignore the Row Level Security of the tables they read, unless created with security_invoker.',
          fix: 'Recreate it as `create view public.' + n.table + ' with (security_invoker = on) as ...` (Postgres 15+), or move it out of the exposed schema.'
        });
      }
    }
    const bk = /insert\s+into\s+storage\.buckets[\s\S]*?;/gi;
    while ((m = bk.exec(text))) {
      if (/\btrue\b/i.test(m[0]) && /public/i.test(m[0])) {
        out.push({
          id: 'supabase-public-bucket', severity: 'medium', file: f, line: ctx.lineOf(text, m.index),
          title: 'A public Supabase Storage bucket is created',
          detail: 'Every file in a public bucket can be downloaded by anyone who has or guesses its URL.',
          fix: 'Keep user uploads in a private bucket and serve them with signed URLs (`createSignedUrl`). Public buckets are only for files meant for everyone.'
        });
      }
    }
  }
  for (const [t, at] of tables) {
    if (rls.has(t)) continue;
    out.push({
      id: 'supabase-rls-off', severity: 'critical', file: at.file, line: at.line,
      title: 'Table public.' + t + ' has Row Level Security off',
      detail: 'Anyone with your anon key (it is in your website\'s JavaScript) can read, insert, update and delete every row through the Supabase API.',
      fix: 'Add `alter table public.' + t + ' enable row level security;` and then a policy per action, for example:\n`create policy "own rows" on public.' + t + ' for select using (auth.uid() = user_id);`'
    });
  }
  for (const p of policies) {
    const cmd = (/\bfor\s+(select|insert|update|delete|all)\b/i.exec(p.body) || [, 'all'])[1].toLowerCase();
    const open = /using\s*\(\s*true\s*\)/i.test(p.body) || /with\s+check\s*\(\s*true\s*\)/i.test(p.body);
    if (!open) continue;
    if (cmd === 'select') {
      out.push({
        id: 'supabase-policy-public-read', severity: SENSITIVE.test(p.table) ? 'high' : 'low', file: p.file, line: p.line,
        title: 'Policy ' + p.name + ' lets anyone read every row of ' + p.table,
        detail: '`using (true)` on select makes the whole table public. Fine for truly public data (a product list), a leak for anything personal.',
        fix: 'Limit it, for example `using (auth.uid() = user_id)`, or `to authenticated` if only logged-in users may read.'
      });
    } else {
      out.push({
        id: 'supabase-policy-open-write', severity: 'high', file: p.file, line: p.line,
        title: 'Policy ' + p.name + ' lets anyone ' + (cmd === 'all' ? 'read and change' : cmd) + ' rows of ' + p.table,
        detail: '`true` as the condition means no check at all for this action.',
        fix: 'Tie writes to the user, for example `with check (auth.uid() = user_id)`, and add `to authenticated`.'
      });
    }
  }
  return out;
}

function firebase(ctx) {
  const out = [];
  for (const f of ctx.files.filter((x) => /(^|\/)(firestore|storage)\.rules$/.test(x))) {
    const text = ctx.read(f);
    let m;
    const testMode = /request\.time\s*<\s*timestamp\.date\(/g;
    if ((m = testMode.exec(text))) {
      out.push({
        id: 'firebase-test-mode', severity: 'critical', file: f, line: ctx.lineOf(text, m.index),
        title: f + ' is still in test mode',
        detail: 'Test-mode rules let anyone read and write everything until the date runs out, and then lock your own app out.',
        fix: 'Replace them with per-user rules, for example `allow read, write: if request.auth != null && request.auth.uid == userId;` under `match /users/{userId}`.'
      });
    }
    const allow = /allow\s+([\w ,]+?)\s*(?::\s*if\s+true\s*)?;/g;
    while ((m = allow.exec(text))) {
      const whole = m[0];
      if (!/if\s+true|^allow\s+[\w ,]+;$/.test(whole.trim())) continue;
      const write = /write|create|update|delete/.test(m[1]);
      out.push({
        id: 'firebase-open-rule', severity: write ? 'critical' : 'high', file: f, line: ctx.lineOf(text, m.index),
        title: 'Open Firebase rule: `' + whole.trim() + '`',
        detail: write ? 'Anyone on the internet can write or delete data here.' : 'Anyone on the internet can read this data.',
        fix: 'Require sign-in and ownership, for example `allow ' + m[1].trim() + ': if request.auth != null && request.auth.uid == resource.data.owner;`'
      });
    }
  }
  for (const f of ctx.files.filter((x) => /(^|\/)database\.rules\.json$/.test(x))) {
    const text = ctx.read(f);
    const m = /"\.(read|write)"\s*:\s*(true|"true")/.exec(text);
    if (m) {
      out.push({
        id: 'firebase-rtdb-open', severity: m[1] === 'write' ? 'critical' : 'high', file: f, line: ctx.lineOf(text, m.index),
        title: 'Realtime Database rule "' + m[0].trim() + '"',
        detail: 'This opens the database at that path to everyone.',
        fix: 'Use `"auth != null && auth.uid === $uid"` under a `$uid` key instead of true.'
      });
    }
  }
  return out;
}

module.exports = function database(ctx) { return supabase(ctx).concat(firebase(ctx)); };
