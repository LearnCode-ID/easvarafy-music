'use client';

import { useEffect } from 'react';

/** Deep-link alias used by notifications: /explore -> player shell, Search tab. */
export default function ExploreRedirect() {
  useEffect(() => {
    window.location.replace('/?tab=search');
  }, []);
  return null;
}
