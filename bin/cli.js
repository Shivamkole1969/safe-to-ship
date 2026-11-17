#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { scan, ORDER } = require('../src/index');
const report = require('../src/report');

const HELP = `safe-to-ship: is your AI-built app safe to ship?

Usage
  npx github:Shivamkole1969/safe-to-ship [folder] [options]

Options
  --report [file]   also write a Markdown report with every fix (default: safe-to-ship-report.md)
  --json            print the results as JSON
  --audit           also run "npm audit" on production dependencies (needs internet)
  --fail-on <level> exit with code 1 if anything at this level or worse is found
                    (critical | high | medium | low; default: critical)
  --no-color        plain output
  -h, --help        show this help

It reads only the files in the folder you point it at. Nothing is uploaded.`;

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) { console.log(HELP); return 0; }
  const opts = { audit: args.includes('--audit') };
  let folder = '.';
  let reportFile = null;
  let failOn = 'critical';
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--report') {
      reportFile = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'safe-to-ship-report.md';
    } else if (a === '--fail-on') {
      failOn = (args[++i] || '').toLowerCase();
      if (!(failOn in ORDER) || failOn === 'info') { console.error('--fail-on must be critical, high, medium or low'); return 2; }
    } else if (!a.startsWith('--')) folder = a;
  }
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) { console.error('Not a folder: ' + folder); return 2; }
  const r = scan(folder, opts);
  if (args.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else console.log(report.terminal(r, !args.includes('--no-color') && process.stdout.isTTY && !process.env.NO_COLOR));
  if (reportFile) {
    const target = path.isAbsolute(reportFile) ? reportFile : path.join(process.cwd(), reportFile);
    fs.writeFileSync(target, report.markdown(r));
    if (!args.includes('--json')) console.log('  Report written to ' + path.relative(process.cwd(), target) + '\n');
  }
  return r.findings.some((f) => ORDER[f.severity] <= ORDER[failOn]) ? 1 : 0;
}

process.exitCode = main(process.argv);
