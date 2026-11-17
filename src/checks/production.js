'use strict';
// Running in production: will you find out when it breaks, and can you rebuild it?
const { execFileSync } = require('child_process');

module.exports = function production(ctx, opts) {
  const out = [];
  if (!ctx.pkg) return out;
  const deps = [...ctx.deps];
  const isApp = ctx.pkg.scripts && (ctx.pkg.scripts.build || ctx.pkg.scripts.start || ctx.pkg.scripts.dev);
  if (!isApp) return out;
  if (!deps.some((d) => /^@sentry\/|^posthog|logrocket|bugsnag|@highlight-run|@datadog\/browser|rollbar|honeybadger|@axiomhq/.test(d))) {
    out.push({ id: 'prod-no-error-tracking', severity: 'low', file: 'package.json', title: 'No error tracking', detail: 'When something breaks for a user you will not know unless they tell you, and most will just leave.', fix: 'Add Sentry (free tier: `npx @sentry/wizard@latest -i nextjs`, or the React/Vite guide) or PostHog error tracking.' });
  }
  if (!deps.some((d) => /posthog|plausible|@vercel\/analytics|umami|goatcounter|mixpanel|amplitude|react-ga|@next\/third-parties|fathom|segment/.test(d)) && !ctx.files.some((f) => /\.(html|tsx|jsx|astro)$/.test(f) && /googletagmanager|gtag\(|plausible\.io|goatcounter|umami|posthog/.test(ctx.read(f)))) {
    out.push({ id: 'prod-no-analytics', severity: 'info', file: null, title: 'No analytics found', detail: 'After launch you will not know how many people came, from where, or where they dropped off.', fix: 'Add a privacy-friendly counter (GoatCounter or Plausible) or PostHog; a few lines in your HTML head.' });
  }
  if (!['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock'].some((l) => ctx.has(l))) {
    out.push({ id: 'prod-no-lockfile', severity: 'low', file: 'package.json', title: 'No lockfile', detail: 'Every install can pull different package versions, so a build that works today can break tomorrow.', fix: 'Run `npm install` and commit package-lock.json (or your package manager\'s lockfile).' });
  }
  if (opts && opts.audit && ctx.has('package-lock.json')) {
    try {
      let raw;
      try { raw = execFileSync('npm', ['audit', '--json', '--omit=dev'], { cwd: ctx.root, stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 }).toString(); }
      catch (e) { raw = e.stdout ? e.stdout.toString() : ''; }
      const v = (JSON.parse(raw).metadata || {}).vulnerabilities || {};
      if ((v.critical || 0) + (v.high || 0) > 0) {
        out.push({ id: 'prod-vulnerable-deps', severity: v.critical ? 'high' : 'medium', file: 'package-lock.json', title: (v.critical || 0) + ' critical and ' + (v.high || 0) + ' high vulnerabilities in dependencies', detail: 'Reported by `npm audit` for production dependencies.', fix: 'Run `npm audit fix`, then update the remaining packages by hand and re-test.' });
      }
    } catch {}
  }
  return out;
};
