import { useState } from "react";
import type { LibraryImage } from "../../types";
import { thumbUrl } from "../../utils/thumbUrl";

// One grid cell. The thumbnail is loaded by the WebView itself via the native
// `thumb://` scheme (decoded + disk-cached in Rust), so scrolling never spawns a
// per-image backend process and no base64 is held in JS.
export function LibraryTile({
  image,
  selected,
  onOpen
}: {
  image: LibraryImage;
  selected: boolean;
  onOpen: (path: string) => void;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <button
      type="button"
      className={`libraryTile${selected ? " selected" : ""}`}
      title={image.filename}
      onClick={() => onOpen(image.path)}
    >
      <span className="libraryTileImage">
        {failed ? (
          <span className="thumbnailPlaceholder">!</span>
        ) : (
          <img
            src={thumbUrl(image.path, image.mtime_ns, 256)}
            alt={image.filename}
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
          />
        )}
      </span>
      <span className="libraryTileLabel">{image.filename}</span>
    </button>
  );
}
