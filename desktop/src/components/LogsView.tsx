import { useLayoutEffect, useRef } from "react";
import type { LogEntry } from "../types";

// Terminal-style auto-scroll: new lines pin the view to the bottom unless the
// user has scrolled up to read older entries. Scrolling back to the bottom
// re-arms auto-scroll.
const STICK_THRESHOLD_PX = 4;

export function LogsView({ logs }: { logs: LogEntry[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.clientHeight - el.scrollTop;
    stickRef.current = distance <= STICK_THRESHOLD_PX;
  };

  useLayoutEffect(() => {
    if (!stickRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <section className="panel logPanel" ref={containerRef} onScroll={handleScroll}>
      {logs.map((entry) => (
        <div className={`logLine ${entry.level}`} key={entry.id}>
          {entry.message}
        </div>
      ))}
    </section>
  );
}
