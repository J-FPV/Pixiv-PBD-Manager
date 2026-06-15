import { t } from "../../i18n";
import type { Language, LibraryFacets, LibraryFilters } from "../../types";
import type { FacetDimension } from "../../utils/libraryFacets";
import { LibraryFilterSection } from "./LibraryFilterSection";

const SECTIONS: { dim: FacetDimension; labelKey: Parameters<typeof t>[1] }[] = [
  { dim: "artists", labelKey: "artist" },
  { dim: "folders", labelKey: "folder" },
  { dim: "tags", labelKey: "tags" },
  { dim: "formats", labelKey: "format" },
  { dim: "orientations", labelKey: "orientation" },
  { dim: "resolutions", labelKey: "resolution" },
  { dim: "dates", labelKey: "dateYear" }
];

export function LibraryFilterSidebar({
  language,
  facets,
  filters,
  width,
  onToggle,
  onClear
}: {
  language: Language;
  facets: LibraryFacets;
  filters: LibraryFilters;
  width: number;
  onToggle: (dim: FacetDimension, value: string) => void;
  onClear: () => void;
}) {
  const hasActive = SECTIONS.some((section) => filters[section.dim].length);
  return (
    <aside className="libraryFilterSidebar" style={{ width, flexBasis: width }}>
      <div className="filterSidebarHead">
        <span>{t(language, "libraryFilters")}</span>
        {hasActive ? (
          <button type="button" className="filterClearButton" onClick={onClear}>
            {t(language, "clearFilters")}
          </button>
        ) : null}
      </div>
      {SECTIONS.map((section, index) => (
        <LibraryFilterSection
          key={section.dim}
          title={t(language, section.labelKey)}
          facets={facets[section.dim]}
          selected={filters[section.dim]}
          onToggle={(value) => onToggle(section.dim, value)}
          defaultOpen={index < 3}
        />
      ))}
    </aside>
  );
}
