import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BACK_PRIORITY_OVERLAY,
  BACK_PRIORITY_PAGE,
  backHandlerCount,
  handleBackPress,
  registerBackHandler,
} from './backButton';

type FakeWindow = {
  location: { pathname: string; replace: (u: string) => void };
  history: { length: number; back: () => void };
};

function withWindow(pathname: string, historyLength: number, fn: (log: string[]) => void) {
  const log: string[] = [];
  const g = globalThis as unknown as { window?: FakeWindow };
  const prev = g.window;
  g.window = {
    location: { pathname, replace: (u) => log.push(`replace:${u}`) },
    history: { length: historyLength, back: () => log.push('history.back') },
  };
  try {
    fn(log);
  } finally {
    g.window = prev;
  }
}

test('back closes the most recently opened overlay first (LIFO)', () => {
  const log: string[] = [];
  const offPlayer = registerBackHandler(() => void log.push('player'));
  const offSheet = registerBackHandler(() => void log.push('sleep-sheet'));
  assert.equal(handleBackPress(), true);
  assert.deepEqual(log, ['sleep-sheet']);
  offSheet();
  assert.equal(handleBackPress(), true);
  assert.deepEqual(log, ['sleep-sheet', 'player']);
  offPlayer();
  assert.equal(backHandlerCount(), 0);
});

test('overlays win over page-level handlers regardless of order', () => {
  const log: string[] = [];
  const offOverlay = registerBackHandler(() => void log.push('dialog'), BACK_PRIORITY_OVERLAY);
  const offPage = registerBackHandler(() => void log.push('tab->home'), BACK_PRIORITY_PAGE);
  handleBackPress();
  assert.deepEqual(log, ['dialog']);
  offOverlay();
  handleBackPress();
  assert.deepEqual(log, ['dialog', 'tab->home']);
  offPage();
});

test('a handler returning false (or throwing) passes the press down', () => {
  const log: string[] = [];
  const offBase = registerBackHandler(() => {
    log.push('base');
    return true;
  }, BACK_PRIORITY_PAGE);
  const offIdle = registerBackHandler(() => {
    log.push('idle');
    return false;
  }, BACK_PRIORITY_PAGE);
  const offBroken = registerBackHandler(() => {
    throw new Error('boom');
  });
  assert.equal(handleBackPress(), true);
  assert.deepEqual(log, ['idle', 'base']);
  offBase();
  offIdle();
  offBroken();
});

test('home root with nothing open -> leave the app (false)', () => {
  withWindow('/', 5, (log) => {
    const offIdle = registerBackHandler(() => false, BACK_PRIORITY_PAGE);
    assert.equal(handleBackPress(true), false);
    assert.deepEqual(log, []);
    offIdle();
  });
});

test('other routes go back in history, or to / when there is none', () => {
  withWindow('/admin/dashboard', 3, (log) => {
    assert.equal(handleBackPress(true), true);
    assert.deepEqual(log, ['history.back']);
  });
  withWindow('/login/', 1, (log) => {
    assert.equal(handleBackPress(false), true);
    assert.deepEqual(log, ['replace:/']);
  });
  withWindow('/admin/users', 4, (log) => {
    // No native hint -> history.length decides.
    assert.equal(handleBackPress(), true);
    assert.deepEqual(log, ['history.back']);
  });
});
