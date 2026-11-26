import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  audienceLabel,
  categoryMeta,
  formatRelativeTime,
  mergeInbox,
  resolveNotificationTarget,
  validateComposer,
  type ComposerInput,
  type InboxItem,
} from './shared';

const base: ComposerInput = {
  title: 'Halo',
  body: 'Isi',
  category: 'info',
  imageUrl: '',
  actionUrl: '/',
  audience: 'all',
  targetRole: 'user',
};

test('resolveNotificationTarget maps app paths to tabs', () => {
  assert.deepEqual(resolveNotificationTarget('/'), { kind: 'tab', tab: 'home' });
  assert.deepEqual(resolveNotificationTarget('/explore'), { kind: 'tab', tab: 'search' });
  assert.deepEqual(resolveNotificationTarget('/?tab=charts'), { kind: 'tab', tab: 'charts' });
  assert.deepEqual(resolveNotificationTarget('/library/'), { kind: 'tab', tab: 'library' });
  assert.deepEqual(resolveNotificationTarget('/login?x=1'), { kind: 'path', path: '/login?x=1' });
  assert.deepEqual(resolveNotificationTarget('https://example.com/a'), { kind: 'external', url: 'https://example.com/a' });
});

test('resolveNotificationTarget rejects unsafe values', () => {
  assert.equal(resolveNotificationTarget('').kind, 'none');
  assert.equal(resolveNotificationTarget('javascript:alert(1)').kind, 'none');
  assert.equal(resolveNotificationTarget('//evil.example').kind, 'none');
  assert.equal(resolveNotificationTarget('http://insecure.example').kind, 'none');
});

test('validateComposer accepts a valid broadcast and trims', () => {
  const r = validateComposer({ ...base, title: '  Rilis baru  ', category: 'music', imageUrl: 'https://x.y/a.jpg' });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.title, 'Rilis baru');
    assert.equal(r.value.image_url, 'https://x.y/a.jpg');
    assert.equal(r.value.target_role, null);
  }
});

test('validateComposer mirrors DB constraints', () => {
  const r = validateComposer({
    ...base,
    title: '',
    body: 'x'.repeat(2001),
    category: 'spam',
    imageUrl: 'http://x.y/a.jpg',
    actionUrl: 'javascript:alert(1)',
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.title);
    assert.ok(r.errors.body);
    assert.ok(r.errors.category);
    assert.ok(r.errors.imageUrl);
    assert.ok(r.errors.actionUrl);
  }
});

test('validateComposer requires a role for role audience', () => {
  const bad = validateComposer({ ...base, audience: 'role', targetRole: '' });
  assert.equal(bad.ok, false);
  const good = validateComposer({ ...base, audience: 'role', targetRole: 'developer' });
  assert.equal(good.ok, true);
  if (good.ok) assert.equal(good.value.target_role, 'developer');
});

test('labels', () => {
  assert.equal(categoryMeta('music').label, 'Rilis Baru');
  assert.equal(categoryMeta('unknown').id, 'info');
  assert.equal(audienceLabel('role', 'admin'), 'Role: Admin');
  assert.equal(audienceLabel('logged_in'), 'Pengguna login');
});

test('formatRelativeTime', () => {
  const now = Date.parse('2026-11-27T12:00:00Z');
  assert.equal(formatRelativeTime('2026-11-27T11:59:30Z', now), 'baru saja');
  assert.equal(formatRelativeTime('2026-11-27T11:55:00Z', now), '5 mnt lalu');
  assert.equal(formatRelativeTime('2026-11-27T09:00:00Z', now), '3 jam lalu');
  assert.equal(formatRelativeTime('2026-11-25T12:00:00Z', now), '2 hari lalu');
  assert.equal(formatRelativeTime('nope', now), '');
});

test('mergeInbox dedupes, sorts newest first and keeps read state', () => {
  const item = (id: string, at: string, read: string | null = null): InboxItem => ({
    id,
    title: id,
    body: '',
    category: 'info',
    image_url: null,
    action_url: null,
    created_at: at,
    read_at: read,
  });
  const merged = mergeInbox(
    [item('a', '2026-11-27T10:00:00Z', '2026-11-27T10:05:00Z')],
    [item('b', '2026-11-27T11:00:00Z'), item('a', '2026-11-27T10:00:00Z')]
  );
  assert.deepEqual(merged.map((m) => m.id), ['b', 'a']);
  assert.equal(merged[1].read_at, '2026-11-27T10:05:00Z');
});
