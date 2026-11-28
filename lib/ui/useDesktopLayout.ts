'use client';
import { useSyncExternalStore } from 'react';
function subscribe(listener: () => void) {
  const query = window.matchMedia('(min-width: 1024px)');
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
export function useDesktopLayout() {
  return useSyncExternalStore(subscribe, () => window.matchMedia('(min-width: 1024px)').matches, () => false);
}
