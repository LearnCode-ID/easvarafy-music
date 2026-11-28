export interface DeviceHints {
  mobile?: boolean;
  reducedMotion?: boolean;
  saveData?: boolean;
  memoryGB?: number;
  cores?: number;
}

/** Conservative default: phones and constrained/unknown-hardware phones use
 * lightweight CSS glass, without changing playback or the user's color theme. */
export function shouldUseLiteEffects(hints: DeviceHints): boolean {
  return Boolean(hints.mobile || hints.reducedMotion || hints.saveData ||
    (hints.memoryGB !== undefined && hints.memoryGB <= 4) ||
    (hints.cores !== undefined && hints.cores <= 4));
}

export function getLiteEffects(): boolean {
  if (typeof window === 'undefined') return true;
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return shouldUseLiteEffects({
    mobile: window.matchMedia('(max-width: 767px), (pointer: coarse)').matches,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    memoryGB: nav.deviceMemory,
    cores: nav.hardwareConcurrency,
    saveData: nav.connection?.saveData,
  });
}
