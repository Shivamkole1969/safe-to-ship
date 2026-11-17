'use strict';
// Launch basics: page title and description, share preview, robots/sitemap, security headers, privacy policy.

const DEFAULT_TITLES = /^(vite \+ react(?: \+ ts)?|vite app|react app|create next app|create react app|lovable app|lovable generated project|my app|my v0 project|v0 app|bolt app|new project|untitled|document|home|nuxt app|svelte app|sveltekit app|expo app)$/i;

function htmlEntries(ctx) {
  const candidates = ['index.html', 'public/index.html', 'src/index.html', 'src/app.html', 'app/layout.tsx', 'app/layout.jsx', 'app/layout.js', 'src/app/layout.tsx', 'src/app/layout.jsx', 'pages/_document.tsx', 'pages/_document.js', 'src/pages/_document.tsx', 'nuxt.config.ts', 'app.config.ts', 'src/layouts/Layout.astro', 'src/routes/+layout.svelte'];
  const found = candidates.filter((c) => ctx.has(c));
  if (found.length) return found;
  // Plain static sites often keep their pages in a subfolder (site/, docs/, www/): use the shallowest index.html files.
  const idx = ctx.files.filter((f) => /(^|\/)index\.html?$/.test(f) && f.split('/').length <= 3);
  const depth = Math.min(...idx.map((f) => f.split('/').length));
  return idx.filter((f) => f.split('/').length === depth).slice(0, 3);
}

function isWebApp(ctx) {
  return htmlEntries(ctx).length > 0 || ['next', 'vite', 'react-scripts', 'nuxt', '@sveltejs/kit', 'astro', 'gatsby', '@remix-run/react'].some((d) => ctx.deps.has(d));
}

module.exports = function web(ctx) {
  const out = [];
  if (!isWebApp(ctx)) return out;
  const entries = htmlEntries(ctx);
  const allHead = entries.map((e) => ctx.read(e)).join('\n');
  const all = allHead + '\n' + ctx.files.filter((f) => /(layout|head|seo|meta|_app|root)\.(tsx|jsx|ts|js|vue|svelte|astro)$/i.test(f)).map((f) => ctx.read(f)).join('\n');

  const titleM = /<title[^>]*>([^<]*)<\/title>/i.exec(all) || /title\s*:\s*['"`]([^'"`]+)['"`]/.exec(all);
  const title = titleM ? titleM[1].trim() : '';
  if (!title || DEFAULT_TITLES.test(title)) {
    out.push({
      id: 'web-default-title', severity: 'medium', file: entries[0] || null,
      title: title ? 'The page title is still the template default: "' + title + '"' : 'No page title found',
      detail: 'The title is what Google shows and what people see in their tab and in shared links. A template title tells visitors and search engines the app is unfinished.',
      fix: 'Write a title of 50-60 characters that says what the app does for whom, for example "<title>InvoiceBot – send GST invoices from WhatsApp</title>".'
    });
  }
  if (!/<meta[^>]+name=["']description["']/i.test(all) && !/description\s*:\s*['"`]/.test(all)) {
    out.push({
      id: 'web-no-description', severity: 'low', file: entries[0] || null,
      title: 'No meta description',
      detail: 'Google then picks random text from the page for its result snippet.',
      fix: 'Add `<meta name="description" content="One or two sentences, about 150 characters, on what the app does.">` (Next.js: `export const metadata = { description: "..." }`).'
    });
  }
  if (!/og:image|openGraph\s*:\s*{[\s\S]*images/i.test(all) && !ctx.files.some((f) => /opengraph-image\.(png|jpg|tsx|jsx|js|ts)$/.test(f))) {
    out.push({
      id: 'web-no-og-image', severity: 'low', file: entries[0] || null,
      title: 'No share preview image (og:image)',
      detail: 'Links shared on WhatsApp, X, LinkedIn or Slack show up as plain text with no picture, which gets far fewer clicks.',
      fix: 'Add a 1200×630 image and `<meta property="og:image" content="https://yourdomain/og.png">` plus `og:title` and `og:description`.'
    });
  }
  if (/<link[^>]+href=["'][^"']*vite\.svg["']/i.test(all) || ctx.has('public/vite.svg') && /vite\.svg/.test(all)) {
    out.push({
      id: 'web-default-favicon', severity: 'low', file: entries[0] || null,
      title: 'The favicon is still the Vite logo',
      detail: 'The browser tab and bookmarks show Vite\'s icon instead of yours.',
      fix: 'Replace public/vite.svg with your own icon and update the <link rel="icon"> tag.'
    });
  }
  if (!ctx.files.some((f) => /(^|\/)robots\.(txt|ts|js)$/.test(f)) && !ctx.deps.has('next-sitemap')) {
    out.push({ id: 'web-no-robots', severity: 'low', file: null, title: 'No robots.txt', detail: 'Search engines look for it first; it is also where you point them to your sitemap.', fix: 'Add public/robots.txt with `User-agent: *`, `Allow: /` and `Sitemap: https://yourdomain/sitemap.xml`.' });
  }
  if (!ctx.files.some((f) => /(^|\/)sitemap(\.xml|\.ts|\.js|-index\.xml)$/.test(f)) && !ctx.deps.has('next-sitemap') && !ctx.deps.has('@astrojs/sitemap')) {
    out.push({ id: 'web-no-sitemap', severity: 'low', file: null, title: 'No sitemap', detail: 'A sitemap helps Google find every public page of a new site, which matters most in the first weeks.', fix: 'Add public/sitemap.xml (or app/sitemap.ts in Next.js) listing your public pages, then submit it in Google Search Console.' });
  }
  if (entries.some((e) => e.endsWith('.html')) && !/<html[^>]+lang=/i.test(allHead)) {
    out.push({ id: 'web-no-lang', severity: 'low', file: entries.find((e) => e.endsWith('.html')), title: 'The <html> tag has no lang attribute', detail: 'Screen readers and search engines use it to know the page language.', fix: 'Use `<html lang="en">` (or your language code).' });
  }

  const hostCfg = ['vercel.json', 'netlify.toml', 'public/_headers', '_headers', 'firebase.json', 'next.config.js', 'next.config.mjs', 'next.config.ts', 'middleware.ts', 'middleware.js', 'src/middleware.ts', 'staticwebapp.config.json'].filter((c) => ctx.has(c));
  const cfgText = hostCfg.map((c) => ctx.read(c)).join('\n');
  const missing = ['Content-Security-Policy', 'Strict-Transport-Security', 'X-Content-Type-Options'].filter((h) => !new RegExp(h, 'i').test(cfgText));
  const frameOk = /X-Frame-Options|frame-ancestors/i.test(cfgText);
  if (missing.length === 3 && !frameOk && !/http-equiv=["']Content-Security-Policy/i.test(allHead)) {
    out.push({
      id: 'web-no-security-headers', severity: hostCfg.length ? 'medium' : 'low', file: hostCfg[0] || null,
      title: 'No security headers are configured',
      detail: 'Without them, other sites can frame your app (clickjacking) and injected scripts run unchecked.' + (hostCfg.length ? '' : ' No host config file is in the repo, so your host may add some itself: check your live URL at securityheaders.com.'),
      fix: 'Add headers in your host config. Netlify/Cloudflare Pages `_headers`:\n`/*\n  X-Frame-Options: DENY\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Strict-Transport-Security: max-age=31536000`\nVercel: the same keys in vercel.json "headers". GitHub Pages cannot set headers: add `<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; ...">` to each page, or move to Cloudflare Pages (free). Add a Content-Security-Policy once you know which domains you load scripts from.'
    });
  }
  if (/productionBrowserSourceMaps\s*:\s*true/.test(cfgText) || ctx.files.some((f) => /^vite\.config\.(js|ts|mjs)$/.test(f) && /sourcemap\s*:\s*true/.test(ctx.read(f)))) {
    out.push({ id: 'web-public-sourcemaps', severity: 'low', file: null, title: 'Source maps are published in production', detail: 'Anyone can read your original source code in the browser\'s dev tools.', fix: 'Turn production source maps off, or upload them privately to your error tracker (Sentry) instead.' });
  }

  const collectsData = ctx.deps.has('@supabase/supabase-js') || ctx.deps.has('firebase') || [...ctx.deps].some((d) => /auth|clerk|stripe|lemonsqueezy|paddle|razorpay/i.test(d)) || /<form|<input[^>]+type=["']email/i.test(all);
  const hasPrivacy = ctx.files.some((f) => /privacy|datenschutz|politique-de-confidentialite/i.test(f)) || /href=["'][^"']*privacy/i.test(all);
  const hasTerms = ctx.files.some((f) => /(^|\/|-)(terms|tos)([./-]|$)|terms-of-(service|use)|agb|impressum/i.test(f)) || /href=["'][^"']*terms/i.test(all);
  if (collectsData && !hasPrivacy) {
    out.push({
      id: 'web-no-privacy-policy', severity: 'medium', file: null,
      title: 'The app collects data but has no privacy policy page',
      detail: 'Google Play and the App Store reject apps without one, Google sign-in requires one, and laws such as the GDPR (EU) and India\'s DPDP Act expect users to be told what you collect.',
      fix: 'Add a /privacy page: what you collect (email, uploads, payments), why, which services process it (e.g. Supabase, Stripe), how long you keep it, and a contact email for deletion requests. Link it in the footer and in your store listings.'
    });
  }
  if (collectsData && !hasTerms) {
    out.push({ id: 'web-no-terms', severity: 'low', file: null, title: 'No terms of service page', detail: 'Payment providers and app stores often ask for one, and it is where you limit your liability.', fix: 'Add a /terms page and link it next to the privacy policy.' });
  }
  return out;
};
