'use strict';
const { createContext } = require('./context');

const CHECKS = [
  ['Secrets and keys', require('./checks/secrets')],
  ['Environment files', require('./checks/env')],
  ['Database access (Supabase / Firebase)', require('./checks/database')],
  ['Paid AI endpoints', require('./checks/api')],
  ['Launch basics (web)', require('./checks/web')],
  ['App stores (mobile)', require('./checks/mobile')],
  ['Running in production', require('./checks/production')]
];
const ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const PENALTY = { critical: 25, high: 10, medium: 4, low: 1, info: 0 };

function scan(root, opts = {}) {
  const ctx = createContext(root);
  const findings = [];
  for (const [area, check] of CHECKS) {
    for (const f of check(ctx, opts)) findings.push(Object.assign({ area }, f));
  }
  findings.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || String(a.file).localeCompare(String(b.file)));
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  const score = Math.max(0, 100 - findings.reduce((s, f) => s + PENALTY[f.severity], 0));
  const verdict = counts.critical ? 'NOT SAFE TO SHIP' : counts.high ? 'SHIP AFTER FIXES' : counts.medium ? 'ALMOST READY' : 'LOOKS READY';
  return { root: ctx.root, filesScanned: ctx.files.length, findings, counts, score, verdict };
}

module.exports = { scan, ORDER };
