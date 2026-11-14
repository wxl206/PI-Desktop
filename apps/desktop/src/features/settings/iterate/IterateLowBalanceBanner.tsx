import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IconX } from "../../../components/icons";
import { Button } from "../../../components/ui";
import { useAppStore } from "../../../stores/app-store";
import { iterateLowBalanceWarning } from "@pi-desktop/shared";
import { failureKey } from "./failure";
import { useIterateBalance, useIterateBalancePolling } from "./balance";
import { IteratePurchaseDialog } from "./IteratePurchaseDialog";

/**
 * The in-chat low-balance reminder. It polls the account overview on a slow
 * interval, shows one quiet bar above the composer when runway runs short,
 * and stays dismissed until the balance picture actually changes again.
 */
export function IterateLowBalanceBanner() {
  const { t } = useTranslation();
  const showToast = useAppStore((state) => state.showToast);
  const balance = useIterateBalance();
  useIterateBalancePolling();
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const warning = iterateLowBalanceWarning({
    signedIn: balance.signedIn,
    remaining: balance.remainingMessages,
    balance: balance.balance,
  });
  const warningKey = warning === null
    ? null
    : warning.kind === "messages" ? `messages:${warning.remaining}` : `raw:${warning.amount}:${warning.unit}`;
  if (!warning || warningKey === null || dismissedKey === warningKey) return null;

  const report = (error: unknown) =>
    showToast(t(`settings.iterateError.${failureKey(error)}`), { variant: "error" });

  return (
    <div className="iterate-low-balance" role="status">
      <span className="iterate-low-balance-text">
        {warning.kind === "messages"
          ? t("settings.iterateLowBalanceBody", { count: warning.remaining })
          : t("settings.iterateLowBalanceRaw", { amount: warning.amount, unit: warning.unit })}
      </span>
      <span className="iterate-low-balance-actions">
        <Button size="sm" variant="primary" onClick={() => setPurchaseOpen(true)}>
          {t("settings.iterateLowBalanceRecharge")}
        </Button>
        <button
          type="button"
          className="iterate-low-balance-dismiss"
          aria-label={t("settings.iterateLowBalanceDismiss")}
          title={t("settings.iterateLowBalanceDismiss")}
          onClick={() => setDismissedKey(warningKey)}
        >
          <IconX size={14} />
        </button>
      </span>
      {purchaseOpen ? <IteratePurchaseDialog onClose={() => setPurchaseOpen(false)} onError={report} /> : null}
    </div>
  );
}
