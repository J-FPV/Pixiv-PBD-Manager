import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import type { LibraryFacet } from "../../types";

const FACET_PAGE_SIZE = 80;

// One collapsible filter dimension: a header with the active-count badge and a
// wrap of selectable chips (value + count). Hidden entirely when no facets.
export function LibraryFilterSection({
  title,
  facets,
  selected,
  onToggle,
  defaultOpen = false,
  moreLabel
}: {
  title: string;
  facets: LibraryFacet[];
  selected: string[];
  onToggle: (value: string) => void;
  defaultOpen?: boolean;
  moreLabel: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [visibleLimit, setVisibleLimit] = useState(FACET_PAGE_SIZE);
  const visibleFacets = useMemo(() => {
    const leading = facets.slice(0, visibleLimit);
    if (!selected.length) {
      return leading;
    }
    const included = new Set(leading.map((facet) => facet.value));
    const selectedValues = new Set(selected);
    const result = [...leading];
    for (const facet of facets) {
      if (selectedValues.has(facet.value) && !included.has(facet.value)) {
        result.push(facet);
      }
    }
    return result;
  }, [facets, selected, visibleLimit]);
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
          {visibleFacets.map((facet) => (
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
          {visibleFacets.length < facets.length ? (
            <button
              type="button"
              className="filterMoreButton"
              onClick={() => setVisibleLimit((value) => Math.min(facets.length, value + FACET_PAGE_SIZE))}
            >
              {moreLabel} ({facets.length - visibleFacets.length})
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
