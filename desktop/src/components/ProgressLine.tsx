import type { ProgressLineState } from "../types";
import { formatBytes } from "../utils/format";

export function ProgressLine({
  line,
  showPercent
}: {
  line: ProgressLineState;
  showPercent: boolean;
}) {
  const percent = line.total > 0 ? Math.max(0, Math.min(100, (line.current / line.total) * 100)) : 0;
  const percentText = showPercent && !line.indeterminate && line.total > 0 ? `${percent.toFixed(0)}%` : "";
  const speedText = line.speedBps && line.speedBps > 0 ? `${formatBytes(line.speedBps)}/s` : "";
  const meterText = [percentText, speedText].filter(Boolean).join(" · ");
  const fullText = meterText ? `${line.label} (${meterText})` : line.label;
  return (
    <div className="progressLine">
      <span className="progressLabel" title={fullText}>
        {line.label}
      </span>
      <div className={`progressTrack ${line.indeterminate ? "indeterminate" : ""}`}>
        <div className="progressFill" style={{ width: line.indeterminate ? undefined : `${percent}%` }} />
      </div>
      <span className="progressMeter" title={meterText}>
        {meterText}
      </span>
    </div>
  );
}
