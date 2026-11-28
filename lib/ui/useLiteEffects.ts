'use client';
import { useSyncExternalStore } from 'react';
import { getLiteEffects } from './effects';

function subscribe(listener: () => void) {
  const queries = [window.matchMedia('(max-width: 767px), (pointer: coarse)'), window.matchMedia('(prefers-reduced-motion: reduce)')];
  queries.forEach(query => query.addEventListener('change', listener));
  const connection = (navigator as Navigator & { connection?: EventTarget }).connection;
  connection?.addEventListener('change', listener);
  return () => {
    queries.forEach(query => query.removeEventListener('change', listener));
    connection?.removeEventListener('change', listener);
  };
}
export function useLiteEffects() {
  return useSyncExternalStore(subscribe, getLiteEffects, () => true);
}

export function usePageVisible() {
  return useSyncExternalStore(
    subscribeVisibility,
    () => !document.hidden,
    () => false,
  );
}
function subscribeVisibility(listener: () => void) {
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
}
