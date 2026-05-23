import type { LogEntry } from "../types";

export function LogsView({ logs }: { logs: LogEntry[] }) {
  return (
    <section className="panel logPanel">
      {logs.map((entry) => (
        <div className={`logLine ${entry.level}`} key={entry.id}>
          {entry.message}
        </div>
      ))}
    </section>
  );
}
