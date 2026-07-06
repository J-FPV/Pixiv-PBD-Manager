import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { EMPTY_LIBRARY_FILTERS, LIBRARY_SIDEBAR_WIDTH_KEY } from "../../constants";
import { t } from "../../i18n";
import type { Language, LibraryFilters, LibraryImage } from "../../types";
import type { FacetDimension } from "../../utils/libraryFacets";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useLibraryFilter } from "../../hooks/useLibraryFilter";
import { useResizablePanel } from "../../hooks/useResizablePanel";
import { Button } from "../Button";
import { LibraryDetailModal } from "./LibraryDetailModal";
import { LibraryFilterSidebar } from "./LibraryFilterSidebar";
import { LibraryGrid } from "./LibraryGrid";
import { LibraryToolbar } from "./LibraryToolbar";

export interface LibraryViewProps {
  language: Language;
  images: LibraryImage[];
  loaded: boolean;
  needsScan: boolean;
  busy: boolean;
  selectedPath: string | null;
  setSelectedPath: (path: string | null) => void;
  loadLibrary: () => Promise<void>;
  scanLibrary: () => void;
  setImageTags: (path: string, tags: string[]) => void | Promise<void>;
  fetchTags: (paths: string[]) => void;
  revealFile: (path: string) => void;
}

function LibraryEmptyState({
  language,
  busy,
  onScan
}: {
  language: Language;
  busy: boolean;
  onScan: () => void;
}) {
  return (
    <section className="panel libraryPanel">
      <div className="emptyState libraryEmpty">
        <p>{t(language, "noLibraryYet")}</p>
        <p className="muted">{t(language, "noLibraryHint")}</p>
        <Button variant="primary" onClick={onScan} disabled={busy}>{t(language, "scanLibrary")}</Button>
      </div>
    </section>
  );
}

function LibraryFilterPane({
  language,
  facets,
  filters,
  sidebar,
  onToggle,
  onClear
}: {
  language: Language;
  facets: ReturnType<typeof useLibraryFilter>["facets"];
  filters: LibraryFilters;
  sidebar: ReturnType<typeof useResizablePanel>;
  onToggle: (dim: FacetDimension, value: string) => void;
  onClear: () => void;
}) {
  return (
    <>
      <LibraryFilterSidebar
        language={language}
        facets={facets}
        filters={filters}
        width={sidebar.width}
        onToggle={onToggle}
        onClear={onClear}
      />
      <div
        className="librarySidebarResizeHandle"
        role="separator"
        aria-orientation="vertical"
        aria-label={t(language, "resizeLibrarySidebar")}
        aria-valuemin={180}
        aria-valuemax={520}
        aria-valuenow={sidebar.width}
        tabIndex={0}
        title={t(language, "resizeLibrarySidebar")}
        {...sidebar.handleProps}
      />
    </>
  );
}

export function LibraryView(props: LibraryViewProps) {
  const { language, images, loaded, needsScan, busy, selectedPath, setSelectedPath, loadLibrary } = props;
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_LIBRARY_FILTERS);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const requested = useRef(false);
  const libraryBodyRef = useRef<HTMLDivElement>(null);
  const sidebar = useResizablePanel({
    storageKey: LIBRARY_SIDEBAR_WIDTH_KEY,
    containerRef: libraryBodyRef,
    defaultWidth: 240,
    minWidth: 180,
    maxWidth: 520,
    reservedWidth: 300
  });
  // Debounce only the keyword so typing doesn't refilter/facet 36k rows on every
  // keystroke; the chip dimensions apply immediately. Identity stays stable while
  // typing (deps are the individual array fields), so the heavy recompute waits.
  const debouncedKeyword = useDebouncedValue(filters.keyword, 200);
  const effectiveFilters = useMemo<LibraryFilters>(
    () => ({
      keyword: debouncedKeyword,
      artists: filters.artists,
      folders: filters.folders,
      tags: filters.tags,
      formats: filters.formats,
      orientations: filters.orientations,
      resolutions: filters.resolutions,
      dates: filters.dates
    }),
    [
      debouncedKeyword,
      filters.artists,
      filters.folders,
      filters.tags,
      filters.formats,
      filters.orientations,
      filters.resolutions,
      filters.dates
    ]
  );
  const deferredFilters = useDeferredValue(effectiveFilters);
  const { visibleImages, facets } = useLibraryFilter(images, deferredFilters, language);

  useEffect(() => {
    if (loaded || requested.current) {
      return;
    }
    requested.current = true;
    void loadLibrary();
  }, [loaded, loadLibrary]);

  const toggleFilter = (dim: FacetDimension, value: string) =>
    setFilters((current) => {
      const next = new Set(current[dim]);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return { ...current, [dim]: [...next] };
    });

  const selectedImage =
    visibleImages.find((image) => image.path === selectedPath) ||
    images.find((image) => image.path === selectedPath) ||
    null;

  if (loaded && needsScan && !images.length) {
    return <LibraryEmptyState language={language} busy={busy} onScan={props.scanLibrary} />;
  }

  return (
    <section className="panel libraryPanel">
      <LibraryToolbar
        language={language}
        keyword={filters.keyword}
        setKeyword={(keyword) => setFilters((current) => ({ ...current, keyword }))}
        count={visibleImages.length}
        busy={busy}
        needsScan={needsScan}
        onScan={props.scanLibrary}
        onFetchTags={() => props.fetchTags(visibleImages.map((image) => image.path))}
        fetchDisabled={!visibleImages.length}
        toggleSidebar={() => setSidebarOpen((value) => !value)}
      />
      <div className="libraryBody" ref={libraryBodyRef}>
        {sidebarOpen ? (
          <LibraryFilterPane
            language={language}
            facets={facets}
            filters={filters}
            sidebar={sidebar}
            onToggle={toggleFilter}
            onClear={() => setFilters((current) => ({ ...EMPTY_LIBRARY_FILTERS, keyword: current.keyword }))}
          />
        ) : null}
        <LibraryGrid
          language={language}
          images={visibleImages}
          selectedPath={selectedPath}
          loading={!loaded}
          onOpen={setSelectedPath}
        />
      </div>
      {sidebar.resizing ? <div className="panelResizeOverlay" /> : null}
      {selectedImage ? (
        <LibraryDetailModal
          language={language}
          image={selectedImage}
          images={visibleImages.length ? visibleImages : images}
          onPathChange={setSelectedPath}
          onClose={() => setSelectedPath(null)}
          revealFile={props.revealFile}
          setImageTags={props.setImageTags}
          onFetchTags={() => props.fetchTags([selectedImage.path])}
          busy={busy}
        />
      ) : null}
    </section>
  );
}
