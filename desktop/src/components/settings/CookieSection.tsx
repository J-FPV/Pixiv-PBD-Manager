import { useState } from "react";
import { t } from "../../i18n";
import type { Language } from "../../types";

export function CookieSection({
  language,
  cookieConsent,
  onToggleConsent,
  viewDisclaimer,
  pixivCookie,
  setPixivCookie
}: {
  language: Language;
  cookieConsent: boolean;
  onToggleConsent: (next: boolean) => void;
  viewDisclaimer: () => void;
  pixivCookie: string;
  setPixivCookie: (value: string) => void;
}) {
  const [showCookie, setShowCookie] = useState(false);

  return (
    <div className="settingsGroup">
      <h3>{t(language, "secCookie")}</h3>
      <div className="consentRow">
        <label className="checkLine">
          <input type="checkbox" checked={cookieConsent} onChange={(event) => onToggleConsent(event.target.checked)} />
          <span>{t(language, "cookieConsent")}</span>
        </label>
        <button type="button" className="button browseButton" onClick={viewDisclaimer}>
          {t(language, "viewDisclaimer")}
        </button>
      </div>
      <p className="fieldHint">{t(language, "cookieHint")}</p>
      <div className="fieldGrid">
        <label className="full">
          <span>{t(language, "pixivCookie")}</span>
          <div className="pathRow">
            <input
              value={pixivCookie}
              type={showCookie ? "text" : "password"}
              onChange={(event) => setPixivCookie(event.target.value)}
              disabled={!cookieConsent}
            />
            <button
              type="button"
              className="button browseButton"
              disabled={!cookieConsent}
              onClick={() => setShowCookie((value) => !value)}
            >
              {t(language, showCookie ? "hideCookie" : "showCookie")}
            </button>
          </div>
        </label>
      </div>
    </div>
  );
}
