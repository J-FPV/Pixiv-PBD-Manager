import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { LIBRARY_TILE_WIDTH } from "../../constants";
import { t } from "../../i18n";
import type { Language, LibraryImage } from "../../types";
import { LibraryTile } from "./LibraryTile";

const ROW_HEIGHT = 200;

// Width-measured virtualized grid: columns are derived from the container width
// and we virtualize *rows* of N tiles (the project only ships a row virtualizer).
export function LibraryGrid({
  language,
  images,
  selectedPath,
  selectedPaths,
  loading,
  onOpen,
  onToggleSelected
}: {
  language: Language;
  images: LibraryImage[];
  selectedPath: string | null;
  selectedPaths: Set<string>;
  loading: boolean;
  onOpen: (path: string) => void;
  onToggleSelected: (path: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = parentRef.current;
    if (!element) {
      return;
    }
    setWidth(element.clientWidth);
    const observer = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const cols = Math.max(1, Math.floor((width || LIBRARY_TILE_WIDTH) / LIBRARY_TILE_WIDTH));
  const rowCount = Math.ceil(images.length / cols);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6
  });

  return (
    <div className="libraryGridScroll" ref={parentRef}>
      {images.length ? (
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((row) => {
            const start = row.index * cols;
            return (
              <div
                key={row.key}
                className="libraryGridRow"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${row.start}px)`,
                  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`
                }}
              >
                {images.slice(start, start + cols).map((image) => (
                  <LibraryTile
                    key={image.path}
                    language={language}
                    image={image}
                    selected={image.path === selectedPath}
                    checked={selectedPaths.has(image.path)}
                    onOpen={onOpen}
                    onToggleSelected={onToggleSelected}
                  />
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="emptyState">{t(language, loading ? "loadingLibrary" : "noMatches")}</div>
      )}
    </div>
  );
}
