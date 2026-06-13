import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { LibraryFacet } from "../../types";

// One collapsible filter dimension: a header with the active-count badge and a
// wrap of selectable chips (value + count). Hidden entirely when no facets.
export function LibraryFilterSection({
  title,
  facets,
  selected,
  onToggle,
  defaultOpen = false
}: {
  title: string;
  facets: LibraryFacet[];
  selected: string[];
  onToggle: (value: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!facets.length) {
    return null;
  }
  return (
    <div className="filterSection">
      <button type="button" className="filterSectionTitle" onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{title}</span>
        {selected.length ? <span className="filterSectionActive">{selected.length}</span> : null}
      </button>
      {open ? (
        <div className="filterChips">
          {facets.map((facet) => (
            <button
              key={facet.value}
              type="button"
              className={`filterChip${selected.includes(facet.value) ? " active" : ""}`}
              onClick={() => onToggle(facet.value)}
              title={facet.label}
            >
              <span className="filterChipName">{facet.label}</span>
              <span className="filterChipCount">{facet.count}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
