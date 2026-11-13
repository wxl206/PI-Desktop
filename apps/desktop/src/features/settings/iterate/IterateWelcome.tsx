import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppSettings } from "@pi-desktop/shared";
import { api } from "../../../lib/api";
import { useAppStore } from "../../../stores/app-store";
import { IconCheck, IconCreditCard } from "../../../components/icons";
import { Button } from "../../../components/ui";
import { activateIterateConnection } from "./activate";
import { failureKey } from "./failure";
import { IteratePurchaseDialog } from "./IteratePurchaseDialog";

/**
 * First-run guide on the empty chat home. It disappears once account, key and
 * model setup complete or the user chooses "later"; both outcomes persist.
 */
export function IterateWelcome() {
  const { t } = useTranslation();
  const settings = useAppStore((state) => state.settings);
  const setPage = useAppStore((state) => state.setPage);
  const setSettingsTab = useAppStore((state) => state.setSettingsTab);
  const showToast = useAppStore((state) => state.showToast);
  const [visible, setVisible] = useState(false);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState("");
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const alive = useRef(true);

  const persist = async (patch: Partial<AppSettings>) => {
    const current = useAppStore.getState().settings;
    if (!current) return;
    const next = { ...current, ...patch };
    useAppStore.setState({ settings: next });
    await api.setSettings(next).catch(() => undefined);
  };
  const report = (error: unknown) =>
    showToast(t(`settings.iterateError.${failureKey(error)}`), { variant: "error" });

  useEffect(() => {
    alive.current = true;
    if (settings?.iterateWelcomeDismissed === true) return () => { alive.current = false; };
    void api.iterateOverview().then((overview) => {
      if (!alive.current) return;
      if (overview.user) setConnected(true);
      setVisible(true);
    }).catch(() => { if (alive.current) setVisible(true); });
    return () => { alive.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async () => {
    if (busy) return;
    setBusy("connect");
    try {
      let overview = await api.iterateOverview();
      if (!overview.user) {
        await api.iterateLogin();
        overview = await api.iterateOverview();
      }
      if (!overview.user) {
        throw Object.assign(new Error("Iterate login did not return an account"), {
          code: "LOGIN_REQUIRED",
        });
      }
      setConnected(true);
      const group = overview.groups[0];
      if (!group) {
        showToast(t("settings.iterateNoGroups"), { variant: "error" });
        return;
      }
      const discovered = await api.iterateDiscover(group.id);
      const model = discovered.models.find((entry) => entry.styles.length > 0);
      if (!model) {
        showToast(t("settings.iterateNoModels"), { variant: "error" });
        return;
      }
      const connection = await api.iterateConnect(group.id, model.id);
      await activateIterateConnection(connection);
      setVisible(false);
      await persist({ iterateWelcomeDismissed: true });
      showToast(t("settings.iterateConnected"), { variant: "success" });
    } catch (error) {
      report(error);
    } finally {
      if (alive.current) setBusy("");
    }
  };

  const openModels = () => {
    setSettingsTab("iterate");
    setPage("settings");
  };

  if (!visible) return null;

  const step = (done: boolean) => (
    <span
      className={`flex h-4.5 w-4.5 flex-none items-center justify-center rounded-full border ${
        done ? "border-success bg-success/15 text-success" : "border-border-strong text-transparent"
      }`}
      aria-hidden
    >
      <IconCheck size={10} />
    </span>
  );

  return (
    <div
      className="home-onboarding-checklist mx-auto w-full max-w-[560px] rounded-lg-plus border border-border-subtle bg-bg-elevated-opaque p-4 text-left shadow-none"
      data-testid="iterate-welcome"
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-md-plus font-medium text-text-primary">
          {t("settings.iterateWelcomeTitle")}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="rounded-md px-1.5 py-0.5 text-xs-plus text-text-muted hover:bg-bg-hover hover:text-text-primary"
          onClick={() => { setVisible(false); void persist({ iterateWelcomeDismissed: true }); }}
        >
          {t("settings.iterateWelcomeLater")}
        </Button>
      </div>
      <p className="mb-2 text-sm text-text-secondary">{t("settings.iterateWelcomeHint")}</p>
      <ul className="flex flex-col gap-1.5">
        <li>
          <Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={() => void connect()}
            className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-md ${
              connected
                ? "text-text-primary hover:bg-bg-hover"
                : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
            }`}>
            {step(connected)}
            {busy === "connect"
              ? t("settings.iterateWorking")
              : t(connected ? "settings.iterateWelcomeFinish" : "settings.iterateWelcomeConnect")}
          </Button>
        </li>
        <li>
          <Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={() => setPurchaseOpen(true)}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-md text-text-secondary hover:bg-bg-hover hover:text-text-primary">
            <IconCreditCard size={16} aria-hidden />
            {t("settings.iterateWelcomeRecharge")}
          </Button>
        </li>
        <li>
          <Button type="button" variant="ghost" onClick={openModels}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-md text-text-secondary hover:bg-bg-hover hover:text-text-primary">
            {step(false)}
            {t("settings.iterateWelcomeModels")}
          </Button>
        </li>
      </ul>
      {purchaseOpen ? (
        <IteratePurchaseDialog onClose={() => setPurchaseOpen(false)} onError={report} />
      ) : null}
    </div>
  );
}
