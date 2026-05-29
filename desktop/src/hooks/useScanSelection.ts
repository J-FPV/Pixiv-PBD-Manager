import { useState } from "react";
import type { ScanChange, ScanChangeKind } from "../types";

// Default-on for additions, default-off for mutations of existing data — that
// preserves "rule A": never silently overwrite a manually-set name or path.
const defaultSelected = (kind: ScanChangeKind) => kind === "new_artist" || kind === "add_work_ids";

// Per-change checkbox selection for the scan preview, with group and bulk
// toggles. `accepted` is the subset the user has opted in to applying.
export function useScanSelection(changes: ScanChange[]) {
  const [selected, setSelected] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const change of changes) {
      init[change.id] = defaultSelected(change.kind);
    }
    return init;
  });

  const toggle = (id: string) => setSelected((current) => ({ ...current, [id]: !current[id] }));

  const setGroupSelected = (kind: ScanChangeKind, value: boolean) => {
    setSelected((current) => {
      const next = { ...current };
      for (const change of changes) {
        if (change.kind === kind) {
          next[change.id] = value;
        }
      }
      return next;
    });
  };

  const setAllSelected = (value: boolean) => {
    setSelected((current) => {
      const next: Record<string, boolean> = {};
      for (const key of Object.keys(current)) {
        next[key] = value;
      }
      return next;
    });
  };

  const accepted = changes.filter((change) => selected[change.id]);
  return { selected, toggle, setGroupSelected, setAllSelected, accepted };
}
