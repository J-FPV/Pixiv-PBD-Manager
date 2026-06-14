import { useEffect, useState } from "react";

// Returns `value` delayed by `delayMs`; rapid changes (e.g. typing) collapse to
// the last one. Used so the library's 36k-row filter/facet recompute runs on a
// settled keyword, not on every keystroke.
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
