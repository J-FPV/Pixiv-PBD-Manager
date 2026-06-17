import { CheckSquare } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { ConfirmState, Language, PromptState, ScanChange, ScanPreviewPayload } from "../../types";
import { ConfirmModal } from "../ConfirmModal";
import { DisclaimerModal } from "../DisclaimerModal";
import { PromptModal } from "../PromptModal";
import { ScanPreviewModal } from "../ScanPreviewModal";

export function AppModals({
  language,
  prompt,
  setPrompt,
  confirm,
  setConfirm,
  disclaimer,
  setDisclaimer,
  acceptDisclaimer,
  scanPreview,
  scanPreviewOpen,
  setScanPreviewOpen,
  applyScanChanges,
  openArtist,
  toastMessage
}: {
  language: Language;
  prompt: PromptState | null;
  setPrompt: Dispatch<SetStateAction<PromptState | null>>;
  confirm: ConfirmState | null;
  setConfirm: Dispatch<SetStateAction<ConfirmState | null>>;
  disclaimer: "accept" | "view" | null;
  setDisclaimer: Dispatch<SetStateAction<"accept" | "view" | null>>;
  acceptDisclaimer: () => void;
  scanPreview: ScanPreviewPayload | null;
  scanPreviewOpen: boolean;
  setScanPreviewOpen: Dispatch<SetStateAction<boolean>>;
  applyScanChanges: (operations: ScanChange[]) => Promise<void>;
  openArtist: (id: string) => Promise<void>;
  toastMessage: string;
}) {
  return (
    <>
      {prompt ? <PromptModal language={language} state={prompt} onClose={() => setPrompt(null)} /> : null}
      {confirm ? <ConfirmModal language={language} state={confirm} onClose={() => setConfirm(null)} /> : null}
      {disclaimer ? (
        <DisclaimerModal
          language={language}
          mode={disclaimer}
          onAccept={acceptDisclaimer}
          onClose={() => setDisclaimer(null)}
        />
      ) : null}
      {scanPreview && scanPreviewOpen ? (
        <ScanPreviewModal
          language={language}
          preview={scanPreview}
          onApply={applyScanChanges}
          onCancel={() => setScanPreviewOpen(false)}
          openArtist={openArtist}
        />
      ) : null}
      {toastMessage ? (
        <div className="toast" role="status">
          <CheckSquare size={17} />
          <span>{toastMessage}</span>
        </div>
      ) : null}
    </>
  );
}
