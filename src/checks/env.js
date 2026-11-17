'use strict';
const { isTestFile } = require('../context');
// .env files that git would publish, and secrets given a "public" prefix that bundlers ship to the browser.

const PUBLIC_PREFIX = /\b(NEXT_PUBLIC_|VITE_|EXPO_PUBLIC_|REACT_APP_|PUBLIC_|NUXT_PUBLIC_|GATSBY_)([A-Z0-9_]*(SECRET|SERVICE_ROLE|PRIVATE|OPENAI|ANTHROPIC|STRIPE_SECRET|SK_LIVE|PASSWORD|ADMIN_KEY)[A-Z0-9_]*)\b/g;

module.exports = function env(ctx) {
  const out = [];
  const envFiles = ctx.files.filter((f) => /(^|\/)\.env(\.[\w-]+)?$/.test(f) && !/\.(example|sample|template)$/.test(f));
  const gi = ctx.has('.gitignore') ? ctx.read('.gitignore') : '';
  const ignoresEnv = /(^|\n)\s*\/?\.env(\*|\.\*|\.local)?\s*(\n|$)/.test(gi) || /(^|\n)\s*\*\.env/.test(gi);
  for (const f of envFiles) {
    if (ctx.tracked && ctx.tracked.has(f)) {
      const names = [...ctx.read(f).matchAll(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=/gm)].map((m) => m[1]);
      const onlyPublic = names.length > 0 && names.every((n) => /^(NEXT_PUBLIC_|VITE_|EXPO_PUBLIC_|REACT_APP_|PUBLIC_|NUXT_PUBLIC_|GATSBY_)/.test(n) && !/SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|OPENAI|ANTHROPIC|STRIPE_SECRET|SK_LIVE|ADMIN/.test(n));
      out.push({
        id: 'env-tracked', severity: onlyPublic ? 'low' : 'critical', file: f,
        title: f + ' is committed to git',
        detail: onlyPublic
          ? 'Today it only holds values that are public anyway (browser-prefixed URLs and anon/publishable keys). The risk is the next secret someone adds to it.'
          : 'Every value in it is in your repository history, and public if the repo is public.',
        fix: 'Run `git rm --cached ' + f + '` and add `.env*` to .gitignore' + (onlyPublic ? '.' : ', then rotate every key that was in the file (deleting it now does not remove it from history).')
      });
    } else if (!ctx.tracked && !ignoresEnv) {
      out.push({
        id: 'env-not-ignored', severity: 'high', file: f,
        title: f + ' is not covered by .gitignore',
        detail: 'The next `git add .` would publish it.',
        fix: 'Add a line `.env*` (and `!.env.example` if you keep one) to .gitignore.'
      });
    }
  }
  for (const f of ctx.files) {
    if (/\.(example|sample|template)$/.test(f) || /\.md$/.test(f) || isTestFile(f)) continue;
    const text = ctx.read(f);
    PUBLIC_PREFIX.lastIndex = 0;
    let m;
    const seen = new Set();
    while ((m = PUBLIC_PREFIX.exec(text))) {
      if (/ANON|PUBLISHABLE|PUBLIC_KEY|_URL$/.test(m[2]) || seen.has(m[0])) continue;
      seen.add(m[0]);
      out.push({
        id: 'env-public-prefix', severity: 'critical', file: f, line: ctx.lineOf(text, m.index),
        title: 'Secret exposed through a public env prefix: ' + m[0],
        detail: 'Bundlers copy every `' + m[1] + '*` variable into the JavaScript sent to the browser, so this value is readable by every visitor.',
        fix: 'Rename it without the `' + m[1] + '` prefix, read it only in server code (API route, Edge Function), and rotate the current value.'
      });
    }
  }
  return out;
};
