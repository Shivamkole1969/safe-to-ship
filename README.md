# safe-to-ship

**Is your AI-built app safe to ship?** One command checks a Lovable, Bolt, Cursor, Replit, v0 or Claude Code project for the mistakes that leak user data, burn your API credit or get you rejected by the app stores. Every finding comes with the exact fix.

```bash
npx github:Shivamkole1969/safe-to-ship
```

Run it in your project folder. Nothing to install, no account, nothing uploaded. It only reads the files on your machine. Node 18+.

```
safe-to-ship  demo-app  (5 files)

  ✖ CRITICAL Supabase service_role key in browser code  src/supabase.ts:3
      Fix: Rotate the JWT secret / service key in Supabase (Project Settings > API), use only the anon key in the …
  ✖ CRITICAL Table public.orders has Row Level Security off  supabase/migrations/001_init.sql:4
      Fix: Add `alter table public.orders enable row level security;` and then a policy per action, for example:
  ▲ HIGH     Paid AI route has no login check  app/api/chat/route.ts:1
      Fix: Check the user at the top of the route (for Supabase: `const { data: { user } } = await …
  ▲ HIGH     Policy "anyone can update" lets anyone update rows of profiles  supabase/migrations/001_init.sql:3
      Fix: Tie writes to the user, for example `with check (auth.uid() = user_id)`, and add `to authenticated`.
  ● MEDIUM   The page title is still the template default: "Vite + React + TS"  index.html
  ...
  Score 12/100  NOT SAFE TO SHIP   2 critical · 2 high · 2 medium · 10 low
```

## Why this exists

AI builders make it easy to ship an app in an afternoon. They don't make it easy to ship a *safe* one.
- **Escape.tech** scanned about 5,600 public vibe-coded apps and found more than 2,000 high-impact vulnerabilities and more than 400 exposed secrets ([methodology](https://escape.tech/blog/methodology-how-we-discovered-vulnerabilities-apps-built-with-vibe-coding/)).
- **Symbiotic** found issues in 98% of 1,072 Supabase-backed apps it scanned ([report](https://www.symbioticsec.ai/blog/we-scanned-1-072-vibe-coded-apps-98-had-security-flaws)).

The usual causes are a handful of repeatable mistakes. This tool looks for exactly those.

## What it checks

| Area | Checks |
|---|---|
| **Secrets and keys** | Supabase `service_role` keys, OpenAI / Anthropic / Stripe live / AWS / GitHub / Resend / Slack keys, private keys. It tells you whether the file ships to the browser. Keys are masked in all output. |
| **Environment files** | `.env` committed to git or not covered by `.gitignore`; secrets given a browser prefix (`VITE_`, `NEXT_PUBLIC_`, `EXPO_PUBLIC_`, `REACT_APP_` …) that bundlers copy into public JavaScript |
| **Supabase** | Tables with Row Level Security off, policies with `using (true)` / `with check (true)` on writes, public read of personal tables, public storage buckets, views that bypass RLS. If your schema isn't in the repo, it tells you where to check instead |
| **Firebase** | Firestore and Storage rules still in test mode, `allow read, write: if true`, open Realtime Database rules |
| **Paid AI endpoints** | Server routes that call OpenAI, Anthropic, Gemini, Groq, Replicate and others without a login check or rate limit, so strangers can't run up your bill |
| **Launch basics** | Template page titles ("Vite + React", "Lovable App", "Create Next App"), meta description, share image (og:image), default favicon, robots.txt, sitemap, `lang`, security headers, public source maps, privacy policy and terms for apps that collect data |
| **App stores** | Android `targetSdk` below Google Play's current requirement (API 36 since 31 Aug 2026), debuggable builds, cleartext traffic, restricted permissions, vague iOS permission texts, Expo package names, the 12-tester closed-test reminder |
| **Production** | Error tracking, analytics, lockfile, and `npm audit` for production dependencies (with `--audit`) |

Severity: **critical** (fix before anyone uses it) · **high** · **medium** · **low** · **info**. The score starts at 100 and drops with each finding.

## Options

```bash
npx github:Shivamkole1969/safe-to-ship [folder] [options]

  --report [file]   write a Markdown report with every fix (default: safe-to-ship-report.md)
  --json            print the results as JSON
  --audit           also run "npm audit" on production dependencies
  --fail-on <level> exit 1 if anything at this level or worse is found (default: critical)
  --no-color        plain output
```

## Run it on every pull request (GitHub Actions)

```yaml
# .github/workflows/safe-to-ship.yml
name: safe-to-ship
on: [pull_request, push]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Shivamkole1969/safe-to-ship@v0
        with:
          fail-on: critical
```

The full report appears in the job summary.

## Ask your AI to fix it

The Markdown report is written to be pasted into Lovable, Bolt, Cursor or Claude Code:

> Here is a safe-to-ship report for this project. Fix every critical and high finding exactly as described, without changing unrelated code, then list what you changed.

Then run `safe-to-ship` again until the critical and high findings are gone.

## What it is not

- **Not a penetration test.** It reads your code. It does not attack your live app.
- **No proof of safety.** A clean result means these checks passed, not that the app is secure.
- **Heuristics can be wrong.** Some checks (for example "no login check") are best guesses and say so; confirm before changing code.
- **Only your own code.** It reads only the folder you point it at. Use it on projects you own or are allowed to review.

## Launch checklist

The companion page [Launch checklist for AI-built apps](https://shivamkole1969.github.io/safe-to-ship/) covers what a code scan can't check, such as Supabase Security Advisor, spending caps, backups, store listings and the first 100 users.

## Contributing

Found a false alarm, or a mistake it should catch? [Open an issue](https://github.com/Shivamkole1969/safe-to-ship/issues) with a minimal example. Tests: `npm test`.

MIT licence.
