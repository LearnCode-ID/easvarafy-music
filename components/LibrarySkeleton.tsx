"use client";

/** Layout-only placeholders: no fake titles, covers, counters or interactions.
 * Uses the app's existing skeleton blocks with a scoped iOS-style soft shimmer. */
export function LibrarySkeleton({
  layout = "grid",
  toolbar = true,
  label = "Memuat library",
}: {
  layout?: "grid" | "list" | "blend";
  toolbar?: boolean;
  label?: string;
}) {
  const list = layout === "list";
  const blend = layout === "blend";
  return (
    <div
      className="library-skeleton space-y-5"
      role="status"
      aria-busy="true"
      aria-label={label}
      data-testid="library-skeleton"
    >
      <span className="sr-only">{label}…</span>
      <div aria-hidden="true" className="space-y-5">
        {toolbar && (
          <div className="flex items-center gap-3">
            <div className="skeleton-block h-10 flex-1 max-w-md rounded-full" />
            <div className="skeleton-block h-10 w-20 rounded-full shrink-0" />
          </div>
        )}
        <div
          className={
            list
              ? "metro-surface rounded-[26px] divide-y divide-[var(--m3-outline-variant)]"
              : blend
              ? "grid sm:grid-cols-2 gap-3"
              : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          }
        >
          {Array.from({ length: list ? 7 : blend ? 4 : 6 }, (_, index) => (
            <div
              key={index}
              className={
                list
                  ? "flex items-center gap-3 p-4"
                  : "metro-surface rounded-[26px] p-4 space-y-4"
              }
            >
              <div
                className={`flex items-center gap-3.5 ${
                  list ? "flex-1 min-w-0" : ""
                }`}
              >
                {blend ? (
                  <div className="flex -space-x-3 shrink-0">
                    <div className="skeleton-block h-11 w-11 rounded-full" />
                    <div className="skeleton-block h-11 w-11 rounded-full ring-2 ring-[var(--m3-surface)]" />
                  </div>
                ) : (
                  <div
                    className={`skeleton-block shrink-0 rounded-2xl ${
                      list ? "h-12 w-12" : "h-16 w-16"
                    }`}
                  />
                )}
                <div className="flex-1 min-w-0 space-y-2.5">
                  <div
                    className={`skeleton-block h-3.5 rounded-full ${
                      index % 2 ? "w-3/5" : "w-4/5"
                    }`}
                  />
                  <div className="skeleton-block h-2.5 w-2/5 rounded-full" />
                </div>
              </div>
              {!list && (
                <div className="flex gap-2">
                  <div className="skeleton-block h-7 w-20 rounded-full" />
                  <div className="skeleton-block h-7 w-14 rounded-full" />
                </div>
              )}
              {list && (
                <div className="skeleton-block h-7 w-7 rounded-full shrink-0" />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Small background-sync treatment; never hides already loaded collections. */
export function LibrarySyncIndicator({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-label="Sinkronisasi library"
      className={`library-skeleton inline-flex items-center gap-2 rounded-full metro-surface px-3 py-2 ${className}`}
      data-testid="library-sync-indicator"
    >
      <span className="sr-only">Menyinkronkan library…</span>
      <span
        aria-hidden="true"
        className="skeleton-block h-4 w-4 rounded-full"
      />
      <span
        aria-hidden="true"
        className="skeleton-block h-2 w-20 rounded-full"
      />
      <span
        aria-hidden="true"
        className="skeleton-block h-2 w-8 rounded-full"
      />
    </div>
  );
}
