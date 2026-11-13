import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, OverlayBackdrop } from "../../../components/ui";
import { useBlockingOverlay } from "../../../lib/blocking-overlay";
import { portalToBody } from "../../../lib/portal-visibility";

export function IterateRebuildKeyDialog({ onClose, onConfirm, onError }: {
  onClose: () => void;
  onConfirm: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  useBlockingOverlay();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const alive = useRef(true);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    alive.current = true;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusFrame = requestAnimationFrame(() => dialogRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      alive.current = false;
      cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  const confirm = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await onConfirm();
    } catch (error) {
      busyRef.current = false;
      if (alive.current) {
        onError(error);
        setBusy(false);
      }
      return;
    }
    busyRef.current = false;
    if (!alive.current) return;
    setBusy(false);
    onClose();
  };

  const dialog = (
    <OverlayBackdrop
      className="overlay project-instructions-dialog-overlay"
      role="presentation"
      onClick={(event) => { if (event.target === event.currentTarget && !busyRef.current) onClose(); }}
    >
      <div
        ref={dialogRef}
        className="dialog project-instructions-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="iterate-rebuild-dialog-title"
        aria-describedby="iterate-rebuild-dialog-body"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="project-instructions-dialog-head">
          <h2 id="iterate-rebuild-dialog-title" className="project-instructions-dialog-title">
            {t("settings.iterateRebuildKeyTitle")}
          </h2>
        </div>
        <div className="project-delete-dialog-body">
          <p id="iterate-rebuild-dialog-body" className="project-memory-dialog-description">
            {t("settings.iterateRebuildKeyBody")}
          </p>
        </div>
        <div className="project-instructions-dialog-actions">
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="primary" disabled={busy} onClick={() => void confirm()}>
            {busy ? t("settings.iterateWorking") : t("settings.iterateRebuildKeyAction")}
          </Button>
        </div>
      </div>
    </OverlayBackdrop>
  );
  return typeof document === "undefined" ? dialog : portalToBody(dialog);
}
