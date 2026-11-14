import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../components/ui";
import { useAppStore } from "../../../stores/app-store";
import { useIterateBalance, useIterateBalancePolling } from "./balance";
import { failureKey } from "./failure";
import { IteratePurchaseDialog } from "./IteratePurchaseDialog";

/**
 * A persistent compact balance entry above the composer. The welcome guide is
 * dismissable and the low-balance reminder only appears when money runs short,
 * so this stays visible in every chat state to keep recharging one click away.
 */
export function IterateQuickRecharge() {
  const { t } = useTranslation();
  const setPage = useAppStore((state) => state.setPage);
  const setSettingsTab = useAppStore((state) => state.setSettingsTab);
  const showToast = useAppStore((state) => state.showToast);
  const balance = useIterateBalance();
  useIterateBalancePolling();
  const [purchaseOpen, setPurchaseOpen] = useState(false);

  // Stay hidden until the first overview check lands so the pill never
  // flashes "connect account" while the session is actually signed in.
  if (balance.checkedAt === 0) return null;

  const report = (error: unknown) =>
    showToast(t(`settings.iterateError.${failureKey(error)}`), { variant: "error" });

  const openAccount = () => {
    setSettingsTab("iterate");
    setPage("settings");
  };

  return (
    <div className="iterate-quick" data-testid="iterate-quick-recharge">
      {balance.signedIn ? (
        <>
          <span className="iterate-quick-balance">
            {balance.balance
              ? t("settings.iterateQuickBalance", {
                  amount: balance.balance.amount.toLocaleString(),
                  unit: balance.balance.unit,
                })
              : t("settings.iterateUnknown")}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setPurchaseOpen(true)}>
            {t("settings.iterateQuickRecharge")}
          </Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" onClick={openAccount}>
          {t("settings.iterateQuickSignIn")}
        </Button>
      )}
      {purchaseOpen ? <IteratePurchaseDialog onClose={() => setPurchaseOpen(false)} onError={report} /> : null}
    </div>
  );
}
