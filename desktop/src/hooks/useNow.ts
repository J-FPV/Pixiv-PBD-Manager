import { useEffect, useState } from "react";

// Ticks every ``intervalMs`` so relative-time labels ("3 分钟前") refresh while
// the view sits idle. The interval is torn down on unmount — switching away
// from the artists tab unmounts the table — so it only runs while a view
// actually shows relative times.
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
