'use strict';
// Walks a project once and hands every check the same view of it.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.svelte-kit', '.output', 'coverage',
  '.vercel', '.netlify', 'out', '.expo', 'Pods', 'vendor', '__pycache__', '.venv', 'venv', '.turbo',
  '.cache', '.parcel-cache', '.gradle', 'DerivedData', '.idea', '.vscode', 'tmp', '.angular'
]);
const TEXT_EXT = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte', '.astro', '.html', '.htm', '.json',
  '.yml', '.yaml', '.toml', '.env', '.sql', '.rules', '.py', '.rb', '.go', '.php', '.java', '.kt',
  '.kts', '.gradle', '.xml', '.plist', '.md', '.txt', '.sh', '.cfg', '.ini', '.properties', '.swift',
  '.dart', '.graphql', '.prisma', '.css'
]);
const SKIP_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock']);
const MAX_BYTES = 1024 * 1024;
const MAX_FILES = 20000;

function isTextFile(name) {
  if (SKIP_FILES.has(name)) return false;
  if (name.startsWith('.env')) return true;
  if (/\.min\.(js|css)$/.test(name)) return false;
  return TEXT_EXT.has(path.extname(name).toLowerCase()) || ['Dockerfile', '_headers', '_redirects', '.gitignore'].includes(name);
}

function walk(root) {
  const out = [];
  const stack = [''];
  while (stack.length && out.length < MAX_FILES) {
    const rel = stack.pop();
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !(rel === 'android/app' && e.name === 'build')) stack.push(r);
      } else if (e.isFile() && isTextFile(e.name)) {
        let size = 0;
        try { size = fs.statSync(path.join(root, r)).size; } catch { continue; }
        if (size <= MAX_BYTES) out.push(r);
      }
    }
  }
  return out.sort();
}

function gitTracked(root) {
  if (!fs.existsSync(path.join(root, '.git'))) return null;
  try {
    const s = execFileSync('git', ['ls-files', '-z'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
    return new Set(s.toString('utf8').split('\0').filter(Boolean));
  } catch { return null; }
}

function createContext(root) {
  root = path.resolve(root);
  const files = walk(root);
  const cache = new Map();
  const read = (rel) => {
    if (!cache.has(rel)) {
      let t = '';
      try { t = fs.readFileSync(path.join(root, rel), 'utf8'); } catch {}
      cache.set(rel, t);
    }
    return cache.get(rel);
  };
  let pkg = null;
  try { pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch {}
  const deps = new Set(Object.keys(Object.assign({}, pkg && pkg.dependencies, pkg && pkg.devDependencies)));
  const has = (rel) => fs.existsSync(path.join(root, rel));
  const find = (re) => files.filter((f) => re.test(f));
  const lineOf = (text, index) => text.slice(0, index).split('\n').length;
  return { root, files, read, pkg, deps, has, find, lineOf, tracked: gitTracked(root) };
}

// Files that end up in the browser bundle (best effort across common frameworks).
function isClientFile(rel) {
  if (/(^|\/)(api|server|functions|supabase\/functions|netlify\/functions|backend|scripts|migrations)\//.test(rel)) return false;
  if (/\.server\.(js|ts|jsx|tsx)$/.test(rel)) return false;
  if (/(^|\/)app\/.*\/route\.(js|ts)$/.test(rel)) return false;
  return /\.(js|jsx|ts|tsx|mjs|vue|svelte|astro|html)$/.test(rel) && !/(^|\/)(test|tests|__tests__)\//.test(rel);
}

function isTestFile(rel) {
  return /(^|\/)(test|tests|__tests__|spec|e2e|fixtures|__mocks__)\//.test(rel) || /\.(test|spec)\.[jt]sx?$/.test(rel);
}

module.exports = { createContext, isClientFile, isTestFile };
