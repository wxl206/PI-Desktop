import { catalogs, resolveLocale } from "@pi-desktop/i18n";
import type { AccountWindowLabels } from "./windows";

/** Main-owned account windows use the same shipped locale catalog as the shell. */
export function accountWindowLabels(locale: string): AccountWindowLabels {
  const copy = catalogs[resolveLocale(locale)];
  return {
    login: copy.settings.iterateAccount,
    purchase: copy.settings.iteratePurchaseConfirmTitle,
    paymentOrigin: copy.settings.iteratePurchaseConfirmTitle,
    open: copy.common.open,
    cancel: copy.common.cancel,
    connecting: copy.settings.iterateConnecting,
  };
}
