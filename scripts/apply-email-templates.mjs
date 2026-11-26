#!/usr/bin/env node
/**
 * Applies the Indonesian Easvarafy email templates in
 * docs/supabase-email-templates/ to Supabase Auth via the Management API.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/apply-email-templates.mjs
 *   node scripts/apply-email-templates.mjs --check      # validate only
 *   node scripts/apply-email-templates.mjs --dry-run    # print the payload keys
 *
 * Options: --project <ref> (default from templates.json), --no-notifications
 *
 * Get a personal access token at https://supabase.com/dashboard/account/tokens
 * (it is only used for this request and never stored).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dir = path.join(root, 'docs', 'supabase-email-templates');
const manifest = JSON.parse(readFileSync(path.join(dir, 'templates.json'), 'utf8'));
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

/** Variables each template must contain (Supabase Go-template syntax). */
const REQUIRED = {
  confirmation: ['{{ .ConfirmationURL }}'],
  invite: ['{{ .ConfirmationURL }}'],
  magic_link: ['{{ .ConfirmationURL }}', '{{ .Token }}'],
  reauthentication: ['{{ .Token }}'],
  recovery: ['{{ .ConfirmationURL }}'],
  email_change: ['{{ .ConfirmationURL }}', '{{ .NewEmail }}'],
  password_changed: ['{{ .Email }}'],
  email_changed: ['{{ .Email }}', '{{ .OldEmail }}'],
  identity_linked: ['{{ .Provider }}'],
  identity_unlinked: ['{{ .Provider }}'],
  mfa_factor_enrolled: ['{{ .FactorType }}'],
  mfa_factor_unenrolled: ['{{ .FactorType }}'],
};

const includeNotifications = !has('--no-notifications');
const payload = {};
const problems = [];

for (const t of manifest.templates) {
  if (t.kind === 'notification' && !includeNotifications) continue;
  const html = readFileSync(path.join(dir, t.file), 'utf8');
  for (const v of REQUIRED[t.key] ?? []) {
    if (!html.includes(v)) problems.push(`${t.file}: missing ${v}`);
  }
  if (!html.includes('#7C5CFF')) problems.push(`${t.file}: missing accent #7C5CFF`);
  if (!/lang="id"/.test(html)) problems.push(`${t.file}: missing lang="id"`);
  if (html.length > 100_000) problems.push(`${t.file}: too large`);

  if (t.kind === 'auth') {
    payload[`mailer_subjects_${t.key}`] = t.subject;
    payload[`mailer_templates_${t.key}_content`] = html;
  } else {
    payload[`mailer_notifications_${t.key}_enabled`] = true;
    payload[`mailer_subjects_${t.key}_notification`] = t.subject;
    payload[`mailer_templates_${t.key}_notification_content`] = html;
  }
}

if (problems.length) {
  console.error('✗ Template problems:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`✓ ${manifest.templates.length} templates valid`);
if (has('--check')) process.exit(0);

if (has('--dry-run')) {
  for (const [k, v] of Object.entries(payload)) {
    console.log(`  ${k} = ${typeof v === 'string' ? `${v.slice(0, 60).replace(/\s+/g, ' ')}${v.length > 60 ? '…' : ''}` : v}`);
  }
  process.exit(0);
}

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = argValue('--project') || process.env.SUPABASE_PROJECT_REF || manifest.project_ref;
if (!token) {
  console.error('✗ Set SUPABASE_ACCESS_TOKEN (https://supabase.com/dashboard/account/tokens)');
  process.exit(1);
}
if (!/^[a-z0-9]{20}$/.test(ref ?? '')) {
  console.error(`✗ Invalid project ref: ${ref}`);
  process.exit(1);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
const text = await res.text();
if (!res.ok) {
  console.error(`✗ Supabase API ${res.status}: ${text.slice(0, 600)}`);
  process.exit(1);
}
const applied = JSON.parse(text);
const check = (k) => (applied[k] === payload[k] ? '✓' : '·');
for (const t of manifest.templates) {
  const key = t.kind === 'auth' ? `mailer_subjects_${t.key}` : `mailer_subjects_${t.key}_notification`;
  if (key in payload) console.log(`${check(key)} ${t.key}: "${t.subject}"`);
}
console.log(`✓ Applied to project ${ref}`);
