'use strict';
// Server routes that call paid AI APIs with no login check or rate limit: strangers can run up your bill.

const ROUTE = /(^|\/)(pages\/api\/|app\/(.*\/)?route\.(js|ts)$|api\/[^/]+\.(js|ts|mjs)$|supabase\/functions\/|netlify\/functions\/|functions\/src\/|server\/(api|routes)\/)/;
const PAID = /(api\.openai\.com|from\s+['"]openai['"]|require\(['"]openai['"]\)|@anthropic-ai\/sdk|api\.anthropic\.com|generativelanguage\.googleapis\.com|@google\/generative-ai|@google\/genai|api\.replicate\.com|api\.elevenlabs\.io|api\.groq\.com|api\.mistral\.ai|openrouter\.ai|from\s+['"]ai['"]|@ai-sdk\/)/;
const AUTH = /(getUser\(|getSession\(|auth\(\)|getServerSession|currentUser\(|verifyIdToken|requireAuth|withAuth|clerkClient|getAuth\(|jwtVerify|jwt\.verify|Authorization|x-api-key|req\.user|ctx\.auth|supabase\.auth)/;
const LIMIT = /(ratelimit|rateLimit|rate-limit|@upstash\/ratelimit|express-rate-limit|limiter|slowDown|throttle|turnstile|recaptcha|hcaptcha)/i;

module.exports = function api(ctx) {
  const out = [];
  for (const f of ctx.files.filter((x) => ROUTE.test(x) && /\.(js|ts|mjs|jsx|tsx)$/.test(x))) {
    const text = ctx.read(f);
    const m = PAID.exec(text);
    if (!m) continue;
    const authed = AUTH.test(text);
    const limited = LIMIT.test(text);
    if (authed && limited) continue;
    out.push({
      id: authed ? 'api-ai-no-rate-limit' : 'api-ai-no-auth', severity: authed ? 'medium' : 'high', file: f, line: ctx.lineOf(text, m.index),
      title: authed ? 'Paid AI route has no rate limit' : 'Paid AI route has no login check',
      detail: authed
        ? 'A logged-in user (or a script using one account) can call this route in a loop and run up your AI bill.'
        : 'This route calls a paid AI API and does not appear to check who is calling. Anyone who finds the URL can use your API credit. (Heuristic: confirm by reading the route.)',
      fix: (authed ? '' : 'Check the user at the top of the route (for Supabase: `const { data: { user } } = await supabase.auth.getUser(); if (!user) return new Response("Unauthorized", { status: 401 });`). ') +
        'Add a per-user rate limit, for example @upstash/ratelimit (free tier) or a simple counter table, and set a monthly spend cap in the AI provider\'s dashboard.'
    });
  }
  return out;
};
