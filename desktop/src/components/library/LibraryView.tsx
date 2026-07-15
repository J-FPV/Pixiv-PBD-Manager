import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { EMPTY_LIBRARY_FILTERS, LIBRARY_SIDEBAR_WIDTH_KEY } from "../../constants";
import { t } from "../../i18n";
import type {
  DoctorReport,
  Language,
  LibraryFilters,
  LibraryImage,
  LibraryIndexStatus,
  LibraryMetadataPatch
} from "../../types";
import type { FacetDimension } from "../../utils/libraryFacets";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useLibraryFilter } from "../../hooks/useLibraryFilter";
import { useLibrarySelection } from "../../hooks/useLibrarySelection";
import { useResizablePanel } from "../../hooks/useResizablePanel";
import { Button } from "../Button";
import { LibraryDetailModal } from "./LibraryDetailModal";
import { LibraryBatchModal } from "./LibraryBatchModal";
import { LibraryDoctorView } from "./LibraryDoctorView";
import { LibraryFilterSidebar } from "./LibraryFilterSidebar";
import { LibraryGrid } from "./LibraryGrid";
import { LibrarySelectionBar } from "./LibrarySelectionBar";
import { LibraryToolbar } from "./LibraryToolbar";

export interface LibraryViewProps {
  language: Language;
  images: LibraryImage[];
  loaded: boolean;
  needsScan: boolean;
  indexStatus: LibraryIndexStatus | null;
  busy: boolean;
  doctor: DoctorReport | null;
  doctorBusy: boolean;
  selectedPath: string | null;
  setSelectedPath: (path: string | null) => void;
  loadLibrary: () => Promise<void>;
  scanLibrary: () => void;
  runDoctor: () => void;
  setImageTags: (path: string, tags: string[]) => void | Promise<void>;
  updateImageMetadata: (paths: string[], patch: LibraryMetadataPatch) => Promise<number>;
  exportLibrary: (paths: string[]) => Promise<void>;
  fetchTags: (paths: string[]) => void;
  revealFile: (path: string) => void;
}

function useDeferredLibraryFilters(filters: LibraryFilters): LibraryFilters {
  const debouncedKeyword = useDebouncedValue(filters.keyword, 200);
  const effectiveFilters = useMemo<LibraryFilters>(
    () => ({
      keyword: debouncedKeyword,
      artists: filters.artists,
      folders: filters.folders,
      tags: filters.tags,
      favorites: filters.favorites,
      ratings: filters.ratings,
      markers: filters.markers,
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
      filters.favorites,
      filters.ratings,
      filters.markers,
      filters.formats,
      filters.orientations,
      filters.resolutions,
      filters.dates
    ]
  );
  return useDeferredValue(effectiveFilters);
}

function LibraryEmptyState({
  language,
  busy,
  onScan,
  onDoctor
}: {
  language: Language;
  busy: boolean;
  onScan: () => void;
  onDoctor: () => void;
}) {
  return (
    <section className="panel libraryPanel">
      <div className="emptyState libraryEmpty">
        <p>{t(language, "noLibraryYet")}</p>
        <p className="muted">{t(language, "noLibraryHint")}</p>
        <Button variant="primary" onClick={onScan} disabled={busy}>{t(language, "scanLibrary")}</Button>
        <Button onClick={onDoctor}>{t(language, "libraryDoctor")}</Button>
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

function LibraryOverlays({
  props,
  selectedImage,
  detailImages,
  selection
}: {
  props: LibraryViewProps;
  selectedImage: LibraryImage | null;
  detailImages: LibraryImage[];
  selection: ReturnType<typeof useLibrarySelection>;
}) {
  return (
    <>
      {selectedImage ? (
        <LibraryDetailModal
          language={props.language}
          image={selectedImage}
          images={detailImages}
          onPathChange={props.setSelectedPath}
          onClose={() => props.setSelectedPath(null)}
          revealFile={props.revealFile}
          setImageTags={props.setImageTags}
          updateImageMetadata={props.updateImageMetadata}
          onFetchTags={() => props.fetchTags([selectedImage.path])}
          busy={props.busy}
        />
      ) : null}
      {selection.batchOpen ? (
        <LibraryBatchModal
          language={props.language}
          count={selection.selectedImages.length}
          onClose={() => selection.setBatchOpen(false)}
          onApply={async (patch) => {
            await props.updateImageMetadata(selection.selectedImages.map((image) => image.path), patch);
          }}
        />
      ) : null}
    </>
  );
}

export function LibraryView(props: LibraryViewProps) {
  const { language, images, loaded, needsScan, busy, selectedPath, setSelectedPath, loadLibrary } = props;
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_LIBRARY_FILTERS);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [view, setView] = useState<"gallery" | "doctor">("gallery");
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
  // Keyword changes are deferred so large catalogs do not refilter per keypress.
  const deferredFilters = useDeferredLibraryFilters(filters);
  const { visibleImages, facets } = useLibraryFilter(images, deferredFilters, language);
  const selection = useLibrarySelection(images, visibleImages);

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

  const openDoctor = () => {
    setView("doctor");
    if (!props.doctor) void props.runDoctor();
  };

  if (view === "doctor") {
    return (
      <LibraryDoctorView
        language={language}
        report={props.doctor}
        busy={props.doctorBusy}
        onBack={() => setView("gallery")}
        onRun={props.runDoctor}
        revealFile={props.revealFile}
      />
    );
  }

  if (loaded && needsScan && !images.length) {
    return <LibraryEmptyState language={language} busy={busy} onScan={props.scanLibrary} onDoctor={openDoctor} />;
  }

  return (
    <section className="panel libraryPanel libraryManagerPanel">
      <LibraryToolbar
        language={language}
        keyword={filters.keyword}
        setKeyword={(keyword) => setFilters((current) => ({ ...current, keyword }))}
        count={visibleImages.length}
        busy={busy}
        needsScan={needsScan}
        indexStatus={props.indexStatus}
        onScan={props.scanLibrary}
        onFetchTags={() => props.fetchTags(visibleImages.map((image) => image.path))}
        fetchDisabled={!visibleImages.length}
        toggleSidebar={() => setSidebarOpen((value) => !value)}
        onDoctor={openDoctor}
      />
      <LibrarySelectionBar
        language={language}
        selectedCount={selection.selectedImages.length}
        visibleCount={visibleImages.length}
        allVisibleSelected={selection.allVisibleSelected}
        busy={busy}
        onToggleVisible={selection.toggleVisible}
        onClear={selection.clear}
        onBatchEdit={() => selection.setBatchOpen(true)}
        onExport={() => void props.exportLibrary(
          (selection.selectedImages.length ? selection.selectedImages : visibleImages).map((image) => image.path)
        )}
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
          selectedPaths={selection.selectedPaths}
          loading={!loaded}
          onOpen={setSelectedPath}
          onToggleSelected={selection.togglePath}
        />
      </div>
      {sidebar.resizing ? <div className="panelResizeOverlay" /> : null}
      <LibraryOverlays
        props={props}
        selectedImage={selectedImage}
        detailImages={visibleImages.length ? visibleImages : images}
        selection={selection}
      />
    </section>
  );
}
