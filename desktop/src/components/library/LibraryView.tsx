import { useEffect, useRef, useState } from "react";
import { EMPTY_LIBRARY_FILTERS } from "../../constants";
import { t } from "../../i18n";
import type { Language, LibraryFilters, LibraryImage } from "../../types";
import type { FacetDimension } from "../../utils/libraryFacets";
import { useLibraryFilter } from "../../hooks/useLibraryFilter";
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
  revealFile: (path: string) => void;
}

export function LibraryView(props: LibraryViewProps) {
  const { language, images, loaded, needsScan, busy, selectedPath, setSelectedPath, loadLibrary } = props;
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_LIBRARY_FILTERS);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const requested = useRef(false);
  const { visibleImages, facets } = useLibraryFilter(images, filters, language);

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
    return (
      <section className="panel libraryPanel">
        <div className="emptyState libraryEmpty">
          <p>{t(language, "noLibraryYet")}</p>
          <p className="muted">{t(language, "noLibraryHint")}</p>
          <Button variant="primary" onClick={props.scanLibrary} disabled={busy}>{t(language, "scanLibrary")}</Button>
        </div>
      </section>
    );
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
        toggleSidebar={() => setSidebarOpen((value) => !value)}
      />
      <div className="libraryBody">
        {sidebarOpen ? (
          <LibraryFilterSidebar
            language={language}
            facets={facets}
            filters={filters}
            onToggle={toggleFilter}
            onClear={() => setFilters((current) => ({ ...EMPTY_LIBRARY_FILTERS, keyword: current.keyword }))}
          />
        ) : null}
        <LibraryGrid language={language} images={visibleImages} selectedPath={selectedPath} onOpen={setSelectedPath} />
      </div>
      {selectedImage ? (
        <LibraryDetailModal
          language={language}
          image={selectedImage}
          images={visibleImages.length ? visibleImages : images}
          onPathChange={setSelectedPath}
          onClose={() => setSelectedPath(null)}
          revealFile={props.revealFile}
          setImageTags={props.setImageTags}
        />
      ) : null}
    </section>
  );
}
