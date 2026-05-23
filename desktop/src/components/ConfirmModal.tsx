import { t } from "../i18n";
import type { ConfirmState, Language } from "../types";
import { Button } from "./Button";

export function ConfirmModal({
  language,
  state,
  onClose
}: {
  language: Language;
  state: ConfirmState;
  onClose: () => void;
}) {
  const confirm = () => {
    onClose();
    void state.onConfirm();
  };

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modal confirmModal" onClick={(event) => event.stopPropagation()}>
        <h3>{state.title}</h3>
        <div className="confirmBody">{state.body}</div>
        <div className="modalActions">
          <Button onClick={onClose}>{t(language, "cancel")}</Button>
          <Button variant="danger" onClick={confirm}>
            {state.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
