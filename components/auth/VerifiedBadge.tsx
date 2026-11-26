'use client';

import React, { useId } from 'react';
import type { UserRole } from '@/lib/auth/types';
import { cn } from '@/lib/utils';

type BadgeSize = 'xs' | 'sm' | 'md' | 'lg' | number;

const SIZE_MAP: Record<'xs' | 'sm' | 'md' | 'lg', number> = {
  xs: 13,
  sm: 15,
  md: 17,
  lg: 21,
};

interface VerifiedBadgeProps {
  role?: UserRole | string | null;
  size?: BadgeSize;
  className?: string;
  showText?: boolean;
}

/**
 * Verified checkmark badge:
 * - Centang Biru (#1D9BF0): "Akun Terverifikasi" (never labelled as admin)
 * - Centang Kuning/Oranye (#F59E0B -> #EA580C): Developer Terverifikasi
 */
export function VerifiedBadge({
  role,
  size = 16,
  className,
  showText = false,
}: VerifiedBadgeProps) {
  const gradId = useId();
  if (role !== 'admin' && role !== 'developer') return null;

  const pxSize = typeof size === 'number' ? size : SIZE_MAP[size] ?? 16;

  const isDev = role === 'developer';
  const label = isDev ? 'Developer Terverifikasi' : 'Akun Terverifikasi';
  const shortLabel = isDev ? 'Developer' : 'Terverifikasi';

  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex items-center gap-1 shrink-0 align-middle select-none',
        className
      )}
    >
      <svg
        width={pxSize}
        height={pxSize}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0 drop-shadow-[0_1px_2px_rgba(0,0,0,0.2)]"
        aria-hidden="true"
      >
        {isDev ? (
          <defs>
            <linearGradient id={gradId} x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#FBBF24" />
              <stop offset="55%" stopColor="#F59E0B" />
              <stop offset="100%" stopColor="#EA580C" />
            </linearGradient>
          </defs>
        ) : null}
        {/* Scalloped verified seal */}
        <path
          d="M12 1.75L14.68 3.65L17.95 3.35L19.03 6.45L21.9 8.05L21.24 11.27L22.75 14.2L20.42 16.53L20.32 19.82L17.1 20.48L15.17 23.15L12 21.95L8.83 23.15L6.9 20.48L3.68 19.82L3.58 16.53L1.25 14.2L2.76 11.27L2.1 8.05L4.97 6.45L6.05 3.35L9.32 3.65L12 1.75Z"
          fill={isDev ? `url(#${gradId})` : '#1D9BF0'}
        />
        <path
          d="M8.6 12.2L10.85 14.45L15.65 9.65"
          stroke="#FFFFFF"
          strokeWidth="2.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {showText && (
        <span
          className={cn(
            'text-[11px] font-semibold leading-none',
            isDev
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-sky-600 dark:text-sky-400'
          )}
        >
          {shortLabel}
        </span>
      )}
    </span>
  );
}
