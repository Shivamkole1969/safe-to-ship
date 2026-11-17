'use strict';
// Builds small fake projects in a temp folder and checks what the scanner reports.
// Fake keys are assembled at runtime so this file never contains a real-looking secret.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { scan } = require('../src/index');

function project(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-'));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (role) => b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ iss: 'supabase', role, ref: 'abcdefghijklmnop' }) + '.' + 'x'.repeat(43);
const ids = (r) => r.findings.map((f) => f.id);

const OPENAI = 'sk-' + 'proj-' + 'A1b2C3d4'.repeat(5);
const STRIPE = 'sk_' + 'live_' + 'Z9y8X7w6'.repeat(4);

test('flags a service_role key and an AI key in browser code, ignores the anon key', () => {
  const dir = project({
    'package.json': JSON.stringify({ scripts: { dev: 'vite', build: 'vite build' }, dependencies: { '@supabase/supabase-js': '2', vite: '5' } }),
    'src/lib/supabase.ts': `export const a = createClient(url, "${jwt('anon')}");\nexport const admin = createClient(url, "${jwt('service_role')}");\n`,
    'src/ai.ts': `const key = "${OPENAI}";\n`,
    'src/pay.ts': `const s = "${STRIPE}";\n`
  });
  const r = scan(dir);
  const sr = r.findings.filter((f) => f.id === 'secret-supabase-service-role');
  assert.strictEqual(sr.length, 1);
  assert.strictEqual(sr[0].severity, 'critical');
  assert.strictEqual(sr[0].line, 2);
  assert.ok(ids(r).includes('secret-openai'));
  assert.ok(ids(r).includes('secret-stripe-live'));
  assert.strictEqual(r.verdict, 'NOT SAFE TO SHIP');
  assert.ok(!JSON.stringify(r).includes(OPENAI), 'the full key must never be printed');
});

test('finds tables without RLS, open write policies and public buckets', () => {
  const dir = project({
    'package.json': JSON.stringify({ dependencies: { '@supabase/supabase-js': '2' } }),
    'supabase/migrations/001.sql': [
      'create table public.profiles (id uuid primary key, user_id uuid);',
      'alter table public.profiles enable row level security;',
      'create table if not exists orders (id bigint);',
      'create table products (id bigint);',
      'alter table products enable row level security;',
      'create policy "anyone writes" on public.profiles for insert with check (true);',
      'create policy "public read" on products for select using (true);',
      "insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true);",
      'create view public.order_totals as select 1;'
    ].join('\n')
  });
  const r = scan(dir);
  const off = r.findings.filter((f) => f.id === 'supabase-rls-off');
  assert.deepStrictEqual(off.map((f) => f.title), ['Table public.orders has Row Level Security off']);
  assert.ok(ids(r).includes('supabase-policy-open-write'));
  const read = r.findings.find((f) => f.id === 'supabase-policy-public-read');
  assert.strictEqual(read.severity, 'low', 'a public product list is not sensitive');
  assert.ok(ids(r).includes('supabase-public-bucket'));
  assert.ok(ids(r).includes('supabase-view-definer'));
});

test('warns when Supabase is used but no schema is in the repo', () => {
  const dir = project({ 'package.json': JSON.stringify({ dependencies: { '@supabase/supabase-js': '2' } }), 'src/a.js': 'x' });
  assert.ok(ids(scan(dir)).includes('supabase-rls-unverified'));
});

test('Firebase test-mode and open rules', () => {
  const dir = project({
    'firestore.rules': "rules_version = '2';\nservice cloud.firestore {\n match /databases/{d}/documents {\n  match /{doc=**} {\n   allow read, write: if request.time < timestamp.date(2026, 12, 1);\n  }\n  match /posts/{p} { allow read: if true; }\n }\n}\n",
    'database.rules.json': '{ "rules": { ".read": true, ".write": "auth != null" } }'
  });
  const r = scan(dir);
  assert.ok(ids(r).includes('firebase-test-mode'));
  assert.ok(r.findings.some((f) => f.id === 'firebase-open-rule' && f.severity === 'high'));
  assert.ok(r.findings.some((f) => f.id === 'firebase-rtdb-open' && f.severity === 'high'));
});

test('secret behind a public env prefix, and a committed .env file', () => {
  const dir = project({
    '.env': 'VITE_SUPABASE_URL=https://x.supabase.co\nVITE_SUPABASE_ANON_KEY=abc\nVITE_OPENAI_API_KEY=abc\n',
    '.gitignore': 'node_modules\n',
    'src/a.ts': 'fetch(u, { headers: { k: import.meta.env.VITE_OPENAI_API_KEY } })'
  });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', '.'], { cwd: dir });
  const r = scan(dir);
  assert.ok(ids(r).includes('env-tracked'));
  const pub = r.findings.filter((f) => f.id === 'env-public-prefix').map((f) => f.title);
  assert.ok(pub.some((t) => t.includes('VITE_OPENAI_API_KEY')));
  assert.ok(!pub.some((t) => t.includes('ANON')), 'anon/publishable keys are meant to be public');
});

test('an untracked .env with keys is only a reminder', () => {
  const dir = project({ '.env': 'OPENAI_API_KEY=' + OPENAI + '\n', '.gitignore': '.env*\n', 'a.js': '1' });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const r = scan(dir);
  const f = r.findings.find((x) => x.id === 'secret-openai');
  assert.strictEqual(f.severity, 'low');
  assert.ok(!ids(r).includes('env-not-ignored'));
});

test('AI route without auth or rate limit', () => {
  const dir = project({
    'app/api/chat/route.ts': "import OpenAI from 'openai';\nexport async function POST(req) { const o = new OpenAI(); return Response.json(await o.chat.completions.create({})); }\n",
    'app/api/safe/route.ts': "import OpenAI from 'openai';\nimport { Ratelimit } from '@upstash/ratelimit';\nexport async function POST(req) { const { data: { user } } = await supabase.auth.getUser(); }\n"
  });
  const r = scan(dir).findings.filter((f) => f.area === 'Paid AI endpoints');
  assert.deepStrictEqual(r.map((f) => f.id), ['api-ai-no-auth']);
  assert.strictEqual(r[0].file, 'app/api/chat/route.ts');
});

test('template title, missing basics and privacy policy for a data-collecting app', () => {
  const dir = project({
    'package.json': JSON.stringify({ scripts: { dev: 'vite', build: 'vite build' }, dependencies: { vite: '5', '@supabase/supabase-js': '2' } }),
    'index.html': '<!doctype html><html><head><link rel="icon" href="/vite.svg"><title>Vite + React + TS</title></head><body></body></html>'
  });
  const got = ids(scan(dir));
  for (const id of ['web-default-title', 'web-no-description', 'web-no-og-image', 'web-default-favicon', 'web-no-robots', 'web-no-sitemap', 'web-no-lang', 'web-no-security-headers', 'web-no-privacy-policy', 'prod-no-error-tracking', 'prod-no-lockfile']) {
    assert.ok(got.includes(id), 'expected ' + id);
  }
});

test('a tidy site scores as ready', () => {
  const dir = project({
    'package.json': JSON.stringify({ scripts: { build: 'vite build' }, dependencies: { vite: '5', '@sentry/react': '8' } }),
    'package-lock.json': '{}',
    'index.html': '<!doctype html><html lang="en"><head><title>Receipt Scanner – expenses in one tap</title><meta name="description" content="x"><meta property="og:image" content="/og.png"><script src="https://gc.zgo.at/count.js" data-goatcounter="https://x.goatcounter.com/count"></script></head></html>',
    'public/robots.txt': 'User-agent: *', 'public/sitemap.xml': '<urlset/>',
    'public/_headers': '/*\n  X-Frame-Options: DENY\n  X-Content-Type-Options: nosniff\n'
  });
  const r = scan(dir);
  assert.deepStrictEqual(r.findings.filter((f) => f.severity !== 'info').map((f) => f.id), []);
  assert.strictEqual(r.verdict, 'LOOKS READY');
});

test('Android target SDK below the Play requirement', () => {
  const dir = project({ 'android/app/build.gradle': 'android {\n  defaultConfig {\n    targetSdkVersion 34\n  }\n}\n', 'android/app/src/main/AndroidManifest.xml': '<application android:usesCleartextTraffic="true"/>' });
  const r = scan(dir);
  assert.ok(ids(r).includes('android-target-sdk'));
  assert.ok(ids(r).includes('android-cleartext'));
});

test('CLI exit codes and report file', () => {
  const dir = project({ 'src/a.js': `const k = "${STRIPE}";` });
  const cli = path.join(__dirname, '..', 'bin', 'cli.js');
  let code = 0;
  try { execFileSync('node', [cli, dir, '--no-color', '--report', path.join(dir, 'r.md')], { stdio: 'pipe' }); } catch (e) { code = e.status; }
  assert.strictEqual(code, 1);
  const md = fs.readFileSync(path.join(dir, 'r.md'), 'utf8');
  assert.ok(md.includes('NOT SAFE TO SHIP'));
  assert.ok(!md.includes(STRIPE));
  const clean = project({ 'README.md': '# hi' });
  assert.strictEqual(execFileSync('node', [cli, clean, '--no-color']).toString().includes('LOOKS READY'), true);
});
