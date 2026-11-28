export interface OverlayRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export interface OverlayViewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Right-align to a trigger, flip above when needed, and stay inside the visual viewport. */
export function positionTrackMenu(
  anchor: OverlayRect,
  size: { width: number; height: number },
  viewport: OverlayViewport
) {
  const margin = 12;
  const gap = 6;
  const width = Math.min(size.width, Math.max(0, viewport.width - margin * 2));
  const height = Math.min(
    size.height,
    Math.max(0, viewport.height - margin * 2)
  );
  const minX = viewport.left + margin;
  const minY = viewport.top + margin;
  const maxY = viewport.top + viewport.height - margin;
  const below = maxY - anchor.bottom - gap;
  const above = anchor.top - minY - gap;
  const preferAbove = below < height && above > below;
  return {
    left: Math.max(
      minX,
      Math.min(
        anchor.right - width,
        viewport.left + viewport.width - margin - width
      )
    ),
    top: Math.max(
      minY,
      Math.min(
        preferAbove ? anchor.top - gap - height : anchor.bottom + gap,
        maxY - height
      )
    ),
    width,
    maxHeight: Math.max(0, viewport.height - margin * 2),
  };
}
