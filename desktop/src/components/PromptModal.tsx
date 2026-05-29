import { useState } from "react";
import { browsePath } from "../api";
import { t } from "../i18n";
import type { Language, PromptState } from "../types";
import { Button } from "./Button";
import { ModalOverlay } from "./ModalOverlay";

export function PromptModal({
  language,
  state,
  onClose
}: {
  language: Language;
  state: PromptState;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(state.fields.map((field) => [field.key, field.value]))
  );

  const submit = () => {
    state.onSubmit(values);
    onClose();
  };

  return (
    <ModalOverlay onClose={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h3>{state.title}</h3>
        {state.fields.map((field, index) => (
          <label key={field.key}>
            <span>{field.label}</span>
            <div className={field.browse ? "pathRow" : undefined}>
              <input
                autoFocus={index === 0}
                value={values[field.key] ?? ""}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    submit();
                  }
                }}
              />
              {field.browse ? (
                <button
                  type="button"
                  className="button browseButton"
                  onClick={async () => {
                    const picked = await browsePath(field.browse!);
                    if (picked) {
                      setValues((current) => ({ ...current, [field.key]: picked }));
                    }
                  }}
                >
                  {t(language, "browse")}
                </button>
              ) : null}
            </div>
          </label>
        ))}
        <div className="modalActions">
          <Button onClick={onClose}>{t(language, "cancel")}</Button>
          <Button variant="primary" onClick={submit}>
            {t(language, "ok")}
          </Button>
        </div>
      </div>
    </ModalOverlay>
  );
}
