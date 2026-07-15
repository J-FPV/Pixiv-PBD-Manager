import { CheckCircle2, Inbox, Sparkles, Star } from "lucide-react";
import { t } from "../../i18n";
import type { Language, LibraryImage, LibraryMarker, LibraryMetadataPatch } from "../../types";
import { LibraryRating } from "./LibraryRating";

const MARKERS: { id: LibraryMarker; icon: typeof Sparkles; label: "markerHighValue" | "markerUsed" | "markerToSort" }[] = [
  { id: "high_value", icon: Sparkles, label: "markerHighValue" },
  { id: "used", icon: CheckCircle2, label: "markerUsed" },
  { id: "to_sort", icon: Inbox, label: "markerToSort" }
];

export function LibraryMetadataControls({
  language,
  image,
  disabled,
  onUpdate
}: {
  language: Language;
  image: LibraryImage;
  disabled: boolean;
  onUpdate: (patch: LibraryMetadataPatch) => void;
}) {
  const toggleMarker = (marker: LibraryMarker) => {
    const next = new Set(image.markers);
    if (next.has(marker)) next.delete(marker);
    else next.add(marker);
    onUpdate({ markers: [...next].sort() as LibraryMarker[] });
  };

  return (
    <div className="libraryMetadataControls">
      <div className="libraryFavoriteRatingRow">
        <button
          type="button"
          className={`libraryFavoriteButton${image.favorite ? " active" : ""}`}
          disabled={disabled}
          onClick={() => onUpdate({ favorite: !image.favorite })}
        >
          <Star size={17} fill={image.favorite ? "currentColor" : "none"} />
          {t(language, image.favorite ? "favorited" : "markFavorite")}
        </button>
        <LibraryRating
          language={language}
          rating={image.rating}
          disabled={disabled}
          onChange={(rating) => onUpdate({ rating })}
        />
      </div>
      <div className="libraryMarkerButtons">
        {MARKERS.map(({ id, icon: Icon, label }) => (
          <button
            type="button"
            className={image.markers.includes(id) ? `active ${id}` : id}
            disabled={disabled}
            key={id}
            onClick={() => toggleMarker(id)}
          >
            <Icon size={15} />
            {t(language, label)}
          </button>
        ))}
      </div>
    </div>
  );
}
