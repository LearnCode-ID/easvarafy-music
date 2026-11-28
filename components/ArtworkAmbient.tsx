'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useLiteEffects, usePageVisible } from '@/lib/ui/useLiteEffects';
import { useMusic } from './MusicProvider';
import { paletteFromPixels, type ArtworkPalette } from '@/lib/liquid-glass/palette';

const paletteCache = new Map<string, ArtworkPalette>();

/** One shared, inert ambient layer. No proxy, credentials, or per-card canvas. */
export function ArtworkAmbient() {
  const lite = useLiteEffects();
  const visible = usePageVisible();
  const { currentTrack, isPlaying, settings, isNowPlayingOpen } = useMusic();
  const source = currentTrack?.thumbnail || '';
  const [sample, setSample] = useState<{ source: string; palette: ArtworkPalette } | null>(null);
  const palette = sample?.source === source ? sample.palette : undefined;

  useEffect(() => {
    if (!source || !settings.dynamicColor) return;
    let cancelled = false;
    const cached = paletteCache.get(source);
    if (cached) {
      queueMicrotask(() => { if (!cancelled) setSample({ source, palette: cached }); });
      return () => { cancelled = true; };
    }
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.referrerPolicy = 'no-referrer';
    image.decoding = 'async';
    image.onload = () => {
      if (cancelled) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 32;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return;
        context.drawImage(image, 0, 0, 32, 32);
        const colors = paletteFromPixels(context.getImageData(0, 0, 32, 32).data);
        if (!colors) return;
        if (paletteCache.size >= 32) paletteCache.delete(paletteCache.keys().next().value!);
        paletteCache.set(source, colors);
        setSample({ source, palette: colors });
      } catch {
        // CORS-tainted artwork remains usable as the visual fallback below.
      }
    };
    image.src = source;
    return () => { cancelled = true; image.onload = null; image.onerror = null; image.src = ''; };
  }, [source, settings.dynamicColor]);

  useEffect(() => {
    // The full-screen player inherits the same palette, including when its own
    // background style is changed. Never replace the user's foreground accent.
    const root = document.documentElement;
    const names = ['--ambient-a', '--ambient-b', '--ambient-c'];
    names.forEach((name, i) => {
      if (palette && settings.dynamicColor) root.style.setProperty(name, palette[i]);
      else root.style.removeProperty(name);
    });
    return () => names.forEach((name) => root.style.removeProperty(name));
  }, [palette, settings.dynamicColor]);

  const artworkFallback = source && settings.dynamicColor && !palette;
  return (
    <div className="glass-ambient" hidden={settings.theme === 'dark' && settings.pureBlack} aria-hidden="true" data-testid="artwork-ambient" data-palette-source={palette && settings.dynamicColor ? 'pixels' : artworkFallback ? 'artwork-fallback' : 'theme'}>
      <div className="glass-ambient-mesh" style={{
        animationPlayState: isPlaying && visible && !isNowPlayingOpen && !lite ? 'running' : 'paused',
        ...(artworkFallback && !lite ? { backgroundImage: `url(${JSON.stringify(source)})`, backgroundSize: 'cover', backgroundPosition: 'center', filter: 'blur(60px)' } : {}),
      } as CSSProperties} />
    </div>
  );
}
