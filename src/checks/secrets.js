'use strict';
// Hard-coded secrets and keys that give away paid accounts or full database access.
const { isClientFile } = require('../context');

const PATTERNS = [
  { id: 'stripe-live', re: /\b(sk|rk)_live_[0-9a-zA-Z]{20,}\b/g, name: 'Stripe live secret key', sev: 'critical', fix: 'Roll the key in the Stripe dashboard (Developers > API keys), then read it only on the server from an environment variable.' },
  { id: 'stripe-test', re: /\bsk_test_[0-9a-zA-Z]{20,}\b/g, name: 'Stripe test secret key', sev: 'medium', fix: 'Move it to a server-side environment variable; test keys still let anyone act on your test account.' },
  { id: 'anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, name: 'Anthropic API key', sev: 'critical', fix: 'Revoke it in the Anthropic console and call the API only from a server route that checks the user is logged in.' },
  { id: 'openai', re: /\bsk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b/g, name: 'OpenAI-style API key', sev: 'critical', fix: 'Revoke it in the provider dashboard and call the API only from a server route; anyone can spend your credit with this key.' },
  { id: 'aws', re: /\bAKIA[0-9A-Z]{16}\b/g, name: 'AWS access key ID', sev: 'critical', fix: 'Deactivate the key in AWS IAM, check CloudTrail for misuse, and use environment variables or IAM roles instead.' },
  { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, name: 'GitHub token', sev: 'critical', fix: 'Revoke it at github.com/settings/tokens and keep tokens in CI secrets.' },
  { id: 'slack', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, name: 'Slack token', sev: 'high', fix: 'Revoke it in your Slack app settings and keep it server-side.' },
  { id: 'resend', re: /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}\b/g, name: 'Resend API key', sev: 'high', fix: 'Revoke it in Resend and send email only from a server route, or anyone can send mail as you.' },
  { id: 'private-key', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g, name: 'Private key', sev: 'critical', fix: 'Remove the file from the repo and its git history, and issue a new key pair.' },
  { id: 'google-api', re: /\bAIza[0-9A-Za-z_-]{35}\b/g, name: 'Google API key', sev: 'medium', fix: 'Firebase web keys are meant to be public, but restrict every Google key by HTTP referrer or app in Google Cloud Console > Credentials, and limit it to the APIs you use.' }
];
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;

function mask(s) { return s.length <= 10 ? s.slice(0, 3) + '…' : s.slice(0, 8) + '…' + s.slice(-2); }

function jwtRole(token) {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(p, 'base64').toString('utf8')).role || null;
  } catch { return null; }
}

module.exports = function secrets(ctx) {
  const out = [];
  for (const f of ctx.files) {
    if (/(^|\/)\.env\.(example|sample|template)$/.test(f) || /safe-to-ship-report\.md$/.test(f)) continue;
    const text = ctx.read(f);
    const client = isClientFile(f);
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(text))) {
        let sev = p.sev;
        if (f.startsWith('.env') && sev === 'critical' && ctx.tracked && !ctx.tracked.has(f)) sev = 'low';
        out.push({
          id: 'secret-' + p.id, severity: sev, file: f, line: ctx.lineOf(text, m.index),
          title: p.name + ' in ' + (client ? 'browser code' : 'the code'),
          detail: 'Found `' + mask(m[0]) + '`.' + (client ? ' This file ships to the browser, so anyone who opens your site can read it.' : ' Anyone with access to the repository or its history can use it.') + (sev === 'low' ? ' The .env file is not tracked by git, so this is only a reminder to keep it that way.' : ''),
          fix: p.fix
        });
      }
    }
    JWT.lastIndex = 0;
    let m;
    while ((m = JWT.exec(text))) {
      if (jwtRole(m[0]) !== 'service_role') continue;
      if (f.startsWith('.env') && ctx.tracked && !ctx.tracked.has(f)) continue;
      out.push({
        id: 'secret-supabase-service-role', severity: 'critical', file: f, line: ctx.lineOf(text, m.index),
        title: 'Supabase service_role key ' + (client ? 'in browser code' : 'committed to the code'),
        detail: 'Found a JWT with role "service_role" (`' + mask(m[0]) + '`). It bypasses every Row Level Security policy: whoever has it can read, change or delete all your data.',
        fix: 'Rotate the JWT secret / service key in Supabase (Project Settings > API), use only the anon key in the browser, and keep service_role inside Edge Functions or server code via an environment variable.'
      });
    }
  }
  return out;
};
