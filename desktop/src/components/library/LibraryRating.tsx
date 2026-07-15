import { Star, X } from "lucide-react";
import { t } from "../../i18n";
import type { Language } from "../../types";

export function LibraryRating({
  language,
  rating,
  onChange,
  compact = false,
  disabled = false
}: {
  language: Language;
  rating: number;
  onChange: (rating: number) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className={`libraryRating${compact ? " compact" : ""}`} aria-label={t(language, "rating")}>
      {[1, 2, 3, 4, 5].map((value) => (
        <button
          type="button"
          className={value <= rating ? "active" : ""}
          key={value}
          title={t(language, "setRating").replace("{rating}", String(value))}
          aria-label={t(language, "setRating").replace("{rating}", String(value))}
          disabled={disabled}
          onClick={() => onChange(value)}
        >
          <Star size={compact ? 14 : 18} fill={value <= rating ? "currentColor" : "none"} />
        </button>
      ))}
      {rating > 0 ? (
        <button
          type="button"
          className="clear"
          title={t(language, "clearRating")}
          disabled={disabled}
          onClick={() => onChange(0)}
        >
          <X size={compact ? 13 : 15} />
        </button>
      ) : null}
    </div>
  );
}
