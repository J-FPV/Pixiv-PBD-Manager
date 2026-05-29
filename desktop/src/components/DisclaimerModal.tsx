import { t } from "../i18n";
import type { Language } from "../types";
import { Button } from "./Button";
import { ModalOverlay } from "./ModalOverlay";

export function DisclaimerModal({
  language,
  mode,
  onAccept,
  onClose
}: {
  language: Language;
  mode: "accept" | "view";
  onAccept: () => void;
  onClose: () => void;
}) {
  return (
    <ModalOverlay onClose={onClose}>
      <div className="modal disclaimerModal" onClick={(event) => event.stopPropagation()}>
        <h3>{t(language, "disclaimerTitle")}</h3>
        <div className="disclaimerBody">{t(language, "disclaimerBody")}</div>
        <div className="modalActions">
          {mode === "accept" ? (
            <>
              <Button onClick={onClose}>{t(language, "cancel")}</Button>
              <Button variant="primary" onClick={onAccept}>
                {t(language, "accept")}
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={onClose}>
              {t(language, "close")}
            </Button>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}
