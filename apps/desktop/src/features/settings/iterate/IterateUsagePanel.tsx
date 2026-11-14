import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { IterateOverview } from "@pi-desktop/shared";
import { Button } from "../../../components/ui";
import { api } from "../../../lib/api";
import { useAppStore } from "../../../stores/app-store";

/**
 * The last-seven-days consumption view for the signed-in account. Amounts
 * reuse the overview's own unit conversion (balance amount over raw quota),
 * so the panel never needs to know how the gateway displays currency.
 */
export function IterateUsagePanel({ overview }: { overview: IterateOverview }) {
  const { t } = useTranslation();
  const showToast = useAppStore((state) => state.showToast);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof api.iterateUsage>> | null>(null);
  const [loading, setLoading] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const load = useCallback(async (force: boolean) => {
    setLoading(true);
    try {
      const value = await api.iterateUsage(force);
      if (alive.current) setSummary(value);
    } catch {
      if (alive.current) showToast(t("settings.iterateUsageFailed"), { variant: "error" });
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => { void load(false); }, [load]);

  const quota = overview.user?.quota ?? 0;
  const ratio = overview.balance && quota > 0 ? overview.balance.amount / quota : null;
  const format = (value: number) => {
    if (ratio === null || !overview.balance) return value.toLocaleString();
    return `${(value * ratio).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${overview.balance.unit}`;
  };
  const maxDay = summary ? Math.max(...summary.days.map((day) => day.quota), 0) : 0;

  return (
    <div className="settings-card-block">
      <div className="model-config-section-head">
        <div className="settings-card-heading-line">
          <h3 className="settings-card-heading">{t("settings.iterateUsageTitle")}</h3>
        </div>
        <div className="provider-section-head-actions">
          <Button size="sm" disabled={loading} onClick={() => void load(true)}>
            {loading ? t("settings.iterateWorking") : t("settings.iterateUsageRefresh")}
          </Button>
        </div>
      </div>
      {!summary ? null : summary.count === 0 ? (
        <p className="settings-row-detail">{t("settings.iterateUsageEmpty")}</p>
      ) : (
        <div className="iterate-usage">
          <p className="settings-row-detail">
            {t("settings.iterateUsageTotal")}: {format(summary.totalQuota)} · {t("settings.iterateUsageCount", { count: summary.count })}
          </p>
          <div className="iterate-usage-section">
            <h4>{t("settings.iterateUsageByDay")}</h4>
            <div className="iterate-usage-days">
              {summary.days.map((day) => (
                <div key={day.date} className="iterate-usage-day" title={`${day.date} · ${format(day.quota)}`}>
                  <span className="iterate-usage-day-label">{day.date.slice(5)}</span>
                  <span className="iterate-usage-day-track">
                    <span
                      className="iterate-usage-day-bar"
                      style={{ width: maxDay > 0 ? `${Math.max(day.quota > 0 ? 2 : 0, (day.quota / maxDay) * 100)}%` : "0%" }}
                    />
                  </span>
                </div>
              ))}
            </div>
          </div>
          {summary.models.length ? (
            <div className="iterate-usage-section">
              <h4>{t("settings.iterateUsageByModel")}</h4>
              <ul className="iterate-usage-models">
                {summary.models.map((entry) => (
                  <li key={entry.model}>
                    <span className="iterate-usage-model-name">{entry.model}</span>
                    <span className="settings-row-detail">
                      {format(entry.quota)} · {t("settings.iterateUsageCount", { count: entry.count })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
