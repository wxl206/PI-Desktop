import type { AppSettings } from "@pi-desktop/shared";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconCheck, IconCreditCard } from "../../../components/icons";
import { Button } from "../../../components/ui";
import { api } from "../../../lib/api";
import { useAppStore } from "../../../stores/app-store";
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
  const settingsReady = Boolean(settings);
  const dismissed = settings?.iterateWelcomeDismissed;
  const [visible, setVisible] = useState(false);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState("");
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const alive = useRef(true);
  const generation = useRef(0);

  const persist = async (patch: Partial<AppSettings>) => {
    const current = useAppStore.getState().settings;
    if (!current) {
      throw Object.assign(new Error("settings unavailable"), { code: "STORAGE" });
    }
    const next = { ...current, ...patch };
    useAppStore.setState({ settings: next });
    try {
      await api.setSettings(next);
    } catch (error) {
      if (useAppStore.getState().settings === next) {
        useAppStore.setState({ settings: current });
      }
      throw error;
    }
  };
  const report = (error: unknown) =>
    showToast(t(`settings.iterateError.${failureKey(error)}`), { variant: "error" });

  const initialize = async () => {
    const token = ++generation.current;
    setLoadingOverview(true);
    try {
      const overview = await api.iterateOverview();
      if (!alive.current || token !== generation.current) return;
      setLoadError(null);
      if (overview.user) setConnected(true);
      setVisible(true);
    } catch (error) {
      if (!alive.current || token !== generation.current) return;
      setLoadError(failureKey(error));
      setVisible(true);
    } finally {
      if (alive.current && token === generation.current) setLoadingOverview(false);
    }
  };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);

  useEffect(() => {
    if (!settingsReady) {
      generation.current++;
      setLoadingOverview(false);
      return () => { generation.current++; };
    }
    if (dismissed === true) {
      generation.current++;
      setVisible(false);
      setLoadingOverview(false);
      return () => { generation.current++; };
    }
    void initialize();
    return () => { generation.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissed, settingsReady]);

  const connect = async () => {
    if (busy) return;
    setBusy("connect");
    setLoadError(null);
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
      await persist({ iterateWelcomeDismissed: true });
      setVisible(false);
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
  const dismiss = async () => {
    if (busy) return;
    setBusy("later");
    try {
      await persist({ iterateWelcomeDismissed: true });
      setVisible(false);
    } catch (error) {
      report(error);
    } finally {
      if (alive.current) setBusy("");
    }
  };

  if (!visible) return null;

  if (loadError) {
    return (
      <div
        className="home-onboarding-checklist mx-auto w-full max-w-[560px] rounded-lg-plus border border-border-subtle bg-bg-elevated-opaque p-4 text-left shadow-none"
        data-testid="iterate-welcome-error"
      >
        <div className="mb-1 text-md-plus font-medium text-text-primary">
          {t("settings.iterateLoadErrorTitle")}
        </div>
        <p className="mb-3 text-sm text-text-secondary">
          {t(`settings.iterateError.${loadError}`)}
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="primary" size="sm" disabled={loadingOverview}
            onClick={() => void initialize()}>
            {loadingOverview ? t("settings.iterateWorking") : t("settings.iterateRefresh")}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={Boolean(busy) || !settingsReady}
            onClick={() => void dismiss()}>
            {busy === "later" ? t("settings.iterateWorking") : t("settings.iterateWelcomeLater")}
          </Button>
        </div>
      </div>
    );
  }

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
          disabled={Boolean(busy)}
          className="rounded-md px-1.5 py-0.5 text-xs-plus text-text-muted hover:bg-bg-hover hover:text-text-primary"
          onClick={() => void dismiss()}
        >
          {busy === "later" ? t("settings.iterateWorking") : t("settings.iterateWelcomeLater")}
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
