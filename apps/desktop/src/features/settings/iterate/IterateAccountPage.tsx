import type { IterateModel, IterateOverview } from "@pi-desktop/shared";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsMenuSelect } from "../../../components/settings/SettingsMenuSelect";
import { Badge, Button, Input } from "../../../components/ui";
import { api } from "../../../lib/api";
import { useAppStore } from "../../../stores/app-store";
import { SettingsCard, SettingsRow } from "../primitives";
import { activateIterateConnection } from "./activate";
import { applyOverviewToBalance } from "./balance";
import { failureKey } from "./failure";
import { IteratePurchaseDialog } from "./IteratePurchaseDialog";
import { IterateRebuildKeyDialog } from "./IterateRebuildKeyDialog";
import { IterateUsagePanel } from "./IterateUsagePanel";

export function IterateAccountPage() {
  const { t } = useTranslation();
  const showToast = useAppStore((state) => state.showToast);
  const refreshProviders = useAppStore((state) => state.refreshProviders);
  const [overview, setOverview] = useState<IterateOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [group, setGroup] = useState("");
  const [models, setModels] = useState<IterateModel[]>([]);
  const [model, setModel] = useState("");
  const [code, setCode] = useState("");
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [rebuildOpen, setRebuildOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const tasksRunning = useAppStore((state) =>
    Object.values(state.runningSessions).some(Boolean),
  );
  const alive = useRef(true);
  const generation = useRef(0);
  const groupRef = useRef(group);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; generation.current++; };
  }, []);
  useEffect(() => { groupRef.current = group; }, [group]);
  const report = (error: unknown) => showToast(t(`settings.iterateError.${failureKey(error)}`), { variant: "error" });
  const load = async () => {
    const token = ++generation.current;
    setLoading(true);
    setLoadError(null);
    try {
      const value = await api.iterateOverview();
      if (!alive.current || token !== generation.current) return;
      setOverview(value);
      applyOverviewToBalance(value);
      if (!value.groups.some((entry) => entry.id === groupRef.current)) {
        setGroup(value.groups[0]?.id ?? ""); setModels([]); setModel("");
      }
    } catch (error) {
      if (alive.current && token === generation.current) {
        setLoadError(failureKey(error));
        report(error);
      }
    }
    finally {
      if (alive.current && token === generation.current) setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const action = async (name: string, work: () => Promise<void>) => {
    if (busy) return;
    generation.current++;
    setLoading(false);
    setBusy(name);
    try { await work(); }
    catch (error) { report(error); }
    finally { if (alive.current) setBusy(""); }
  };
  const login = () => action("login", async () => {
    await api.iterateLogin();
    await load();
    showToast(t("settings.iterateLoginSuccess"), { variant: "success" });
    try {
      await refreshProviders();
    } catch (error) {
      report(error);
    }
  });
  const discover = () => action("discover", async () => {
    const result = await api.iterateDiscover(group);
    const usable = result.models.filter((entry) => entry.styles.length > 0);
    setModels(usable); setModel(usable[0]?.id ?? "");
    setOverview((current) => current && !current.dedicatedKeyGroups.includes(group)
      ? { ...current, dedicatedKeyGroups: [...current.dedicatedKeyGroups, group] }
      : current);
    if (!usable.length) showToast(t("settings.iterateNoModels"), { variant: "error" });
  });
  const connect = () => action("connect", async () => {
    const connection = await api.iterateConnect(group, model);
    await activateIterateConnection(connection);
    setOverview((current) => current && !current.dedicatedKeyGroups.includes(group)
      ? { ...current, dedicatedKeyGroups: [...current.dedicatedKeyGroups, group] }
      : current);
    showToast(t("settings.iterateConnected"), { variant: "success" });
  });
  const redeem = () => action("redeem", async () => {
    await api.iterateRedeem(code);
    setCode(""); await load();
    showToast(t("settings.iterateRedeemed"), { variant: "success" });
  });
  const rebuildKey = async () => {
    if (busy) return;
    generation.current++;
    setLoading(false);
    setBusy("rebuild");
    try {
      const result = await api.iterateRebuildKey(group);
      const usable = result.models.filter((entry) => entry.styles.length > 0);
      setModels(usable);
      setModel((current) => usable.some((entry) => entry.id === current) ? current : usable[0]?.id ?? "");
      setOverview((current) => current && !current.dedicatedKeyGroups.includes(group)
        ? { ...current, dedicatedKeyGroups: [...current.dedicatedKeyGroups, group] }
        : current);
      showToast(t("settings.iterateRebuildKeySuccess"), { variant: "success" });
      try {
        await refreshProviders();
      } catch (error) {
        report(error);
      }
    } finally {
      if (alive.current) setBusy("");
    }
  };

  if (loading && !overview) return <div className="settings-stack" role="status">{t("common.loading")}</div>;
  if (!overview && loadError) return (
    <div className="settings-stack">
      <SettingsCard title={t("settings.iterateLoadErrorTitle")}
        caption={t(`settings.iterateError.${loadError}`)}>
        <SettingsRow title={t("settings.iterateTitle")}>
          <Button disabled={loading} onClick={() => void load()}>
            {loading ? t("settings.iterateWorking") : t("settings.iterateRefresh")}
          </Button>
        </SettingsRow>
      </SettingsCard>
    </div>
  );
  if (!overview?.user) return (
    <div className="settings-stack">
      <SettingsCard title={t("settings.iterateConnectTitle")} caption={t("settings.iterateConnectHint")}>
        <SettingsRow title={t("settings.iterateAccount")}>
          <Button variant="primary" disabled={Boolean(busy)} onClick={() => void login()}>
            {busy === "login" ? t("settings.iterateWorking") : t("settings.iterateLogin")}
          </Button>
        </SettingsRow>
      </SettingsCard>
    </div>
  );

  return (
    <div className="settings-stack">
      <SettingsCard title={overview.user.name} caption={t("settings.iterateSubtitle")}
        action={<Badge tone="success">{t("settings.iterateSignedIn")}</Badge>}>
        <div className="iterate-grid">
          <div><span className="settings-row-detail">{t("settings.iterateBalance")}</span>
            <strong>{overview.balance ? `${overview.balance.amount.toLocaleString()} ${overview.balance.unit}` : t("settings.iterateUnknown")}</strong>
            {overview.estimate ? (
              <span className="settings-row-detail" title={t("settings.iterateEstimateHint")}>
                {t("settings.iterateEstimate", { count: overview.estimate.remainingMessages ?? 0 })}
              </span>
            ) : (
              <span className="settings-row-detail">{t("settings.iterateEstimateNone")}</span>
            )}
          </div>
          <div><span className="settings-row-detail">{t("settings.iterateUpdated")}</span>
            <strong>{new Date(overview.updatedAt).toLocaleTimeString()}</strong></div>
        </div>
        <div className="settings-panel-actions iterate-actions">
          <Button disabled={Boolean(busy)} onClick={() => void load()}>{t("settings.iterateRefresh")}</Button>
          <Button variant="primary" disabled={Boolean(busy)} onClick={() => setPurchaseOpen(true)}>{t("settings.iteratePurchase")}</Button>
          <Button disabled={Boolean(busy)} onClick={() => action("console", () => api.iterateConsole().then(() => {}))}>{t("settings.iterateConsole")}</Button>
          <Button variant="ghost" disabled={Boolean(busy) || tasksRunning} onClick={() => action("logout", async () => {
            await api.iterateLogout();
            setOverview(null);
            setModels([]);
            await refreshProviders();
          })}>{t("settings.iterateLogout")}</Button>
        </div>
        {tasksRunning ? <p className="settings-row-detail">
          {t("settings.iterateError.TASKS_RUNNING")}
        </p> : null}
      </SettingsCard>
      <IterateUsagePanel overview={overview} />
      <SettingsCard title={t("settings.iterateRedeemTitle")} caption={t("settings.iterateRedeemHint")}>
        <div className="iterate-form">
          <Input value={code} onChange={(event) => setCode(event.target.value)} placeholder={t("settings.iterateCode")}
            autoComplete="off" aria-label={t("settings.iterateCode")} disabled={Boolean(busy) || overview.redemptionUncertain} />
          <Button variant="primary" disabled={Boolean(busy) || !code.trim() || !overview.redemptionEnabled || overview.redemptionUncertain}
            onClick={() => void redeem()}>{busy === "redeem" ? t("settings.iterateWorking") : t("settings.iterateRedeem")}</Button>
        </div>
        {!overview.redemptionEnabled ? <p className="settings-row-detail">{t("settings.iterateRedeemDisabled")}</p> : null}
        {overview.redemptionUncertain ? <div className="iterate-form">
          <p className="settings-row-detail">{t("settings.iterateRedeemUncertain")}</p>
          <Button onClick={() => action("ack", async () => {
            await api.iterateAcknowledgeRedemption(); await load();
          })}>{t("settings.iterateRedeemAcknowledge")}</Button></div> : null}
      </SettingsCard>
      <SettingsCard title={t("settings.iterateConnectTitle")} caption={t("settings.iterateConnectHint")}>
        <div className="iterate-form">
          <SettingsMenuSelect fullWidth label={t("settings.iterateGroup")} value={group}
            disabled={Boolean(busy)} options={overview.groups.map((entry) => ({
              id: entry.id,
              label: entry.ratio === null
                ? entry.description
                : `${entry.description} · ${t("settings.iterateGroupRatio", { ratio: entry.ratio })}`,
            }))}
            onChange={(value) => { setGroup(value); setModels([]); setModel(""); }} />
          <Button disabled={Boolean(busy) || !group} onClick={() => void discover()}>{t("settings.iterateDiscover")}</Button>
        </div>
        {!overview.groups.length ? <p className="settings-row-detail">{t("settings.iterateNoGroups")}</p> : null}
        {models.length ? <div className="iterate-form">
          <SettingsMenuSelect fullWidth label={t("settings.iterateModels")} value={model}
            disabled={Boolean(busy)} options={models.map((entry) => ({ id: entry.id, label: entry.id }))}
            onChange={setModel} />
          <Button variant="primary" disabled={Boolean(busy) || tasksRunning || !model} onClick={() => void connect()}>
            {busy === "connect" ? t("settings.iterateWorking") : t("settings.iterateConnect")}
          </Button>
        </div> : null}
        <div className="settings-panel-actions">
          <Button size="sm" disabled={Boolean(busy) || !group || !overview.dedicatedKeyGroups.includes(group)}
            onClick={() => action("copy", async () => {
            await api.iterateCopyKey(group); showToast(t("settings.iterateCopied"), { variant: "success" });
          })}>{t("settings.iterateCopyKey")}</Button>
          <Button size="sm" disabled={Boolean(busy) || !group || tasksRunning}
            onClick={() => setRebuildOpen(true)}>{t("settings.iterateRebuildKey")}</Button>
        </div>
      </SettingsCard>
      {purchaseOpen ? <IteratePurchaseDialog onClose={() => setPurchaseOpen(false)} onError={report} /> : null}
      {rebuildOpen ? <IterateRebuildKeyDialog onClose={() => setRebuildOpen(false)}
        onConfirm={rebuildKey} onError={report} /> : null}
    </div>
  );
}
