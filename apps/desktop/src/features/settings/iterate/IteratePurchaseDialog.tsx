import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../../lib/api";
import { useBlockingOverlay } from "../../../lib/blocking-overlay";
import { portalToBody } from "../../../lib/portal-visibility";
import { Button, OverlayBackdrop } from "../../../components/ui";
import { IconCreditCard } from "../../../components/icons";

/**
 * Recharge is an explicit hand-off to a third-party shop: the app never
 * charges or redeems on its own, so the user confirms the door it opens.
 */
export function IteratePurchaseDialog({ onClose, onError }: {
  onClose: () => void;
  onError: (error: unknown) => void;
}) {
  useBlockingOverlay();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => dialogRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) { event.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [onClose]);

  const confirm = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await api.iteratePurchase();
      onClose();
    } catch (error) {
      onError(error);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
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
        aria-labelledby="iterate-purchase-dialog-title"
        aria-describedby="iterate-purchase-dialog-body"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="project-instructions-dialog-head">
          <h2 id="iterate-purchase-dialog-title" className="project-instructions-dialog-title">
            <IconCreditCard size={17} aria-hidden />
            {t("settings.iteratePurchaseConfirmTitle")}
          </h2>
        </div>
        <div className="project-delete-dialog-body">
          <p id="iterate-purchase-dialog-body" className="project-memory-dialog-description">
            {t("settings.iteratePurchaseConfirmBody")}
          </p>
        </div>
        <div className="project-instructions-dialog-actions">
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            {t("settings.iteratePurchaseCancel")}
          </Button>
          <Button type="button" variant="primary" disabled={busy} onClick={() => void confirm()}>
            {busy ? t("settings.iterateWorking") : t("settings.iteratePurchaseConfirmAction")}
          </Button>
        </div>
      </div>
    </OverlayBackdrop>
  );
  return typeof document === "undefined" ? dialog : portalToBody(dialog);
}
