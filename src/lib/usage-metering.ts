export type UsageMetricKey =
  | "storage_bytes"
  | "active_users"
  | "automation_executions"
  | "outbound_emails"
  | "sms_segments";

export type UsageMetricStatus = "unconfigured" | "within" | "approaching" | "exceeded";

export type UsageAllowanceSnapshot = {
  unit?: string | null;
  included_quantity?: number | string | null;
  warning_threshold_percent?: number | string | null;
};

export type UsageMetric = {
  key: UsageMetricKey;
  label: string;
  unit: string;
  measured: number;
  allowance: number | null;
  remaining: number | null;
  warningThresholdPercent: number;
  status: UsageMetricStatus;
};

const METRIC_META: Record<UsageMetricKey, { label: string; unit: string }> = {
  storage_bytes: { label: "File storage", unit: "bytes" },
  active_users: { label: "Active users", unit: "users" },
  automation_executions: { label: "Automation executions", unit: "executions" },
  outbound_emails: { label: "Outbound emails", unit: "messages" },
  sms_segments: { label: "SMS segments", unit: "segments" },
};

export const USAGE_METRIC_KEYS = Object.keys(METRIC_META) as UsageMetricKey[];

function finiteNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function optionalFiniteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function usageMetricStatus(
  measured: number,
  allowance: number | null,
  warningThresholdPercent = 80,
): UsageMetricStatus {
  if (allowance === null) return "unconfigured";
  if (measured > allowance) return "exceeded";
  if (allowance === 0) return measured > 0 ? "exceeded" : "within";
  if (measured >= allowance * (warningThresholdPercent / 100)) return "approaching";
  return "within";
}

export function buildUsageMetrics(
  measured: Partial<Record<UsageMetricKey, number | string | null | undefined>>,
  allowances: Partial<Record<UsageMetricKey, UsageAllowanceSnapshot | null | undefined>>,
): UsageMetric[] {
  return USAGE_METRIC_KEYS.map((key) => {
    const meta = METRIC_META[key];
    const current = Math.max(0, finiteNumber(measured[key]));
    const allowanceRecord = allowances[key] ?? null;
    const allowance = optionalFiniteNumber(allowanceRecord?.included_quantity);
    const warningThresholdPercent = Math.min(
      100,
      Math.max(0, finiteNumber(allowanceRecord?.warning_threshold_percent, 80)),
    );

    return {
      key,
      label: meta.label,
      unit: allowanceRecord?.unit || meta.unit,
      measured: current,
      allowance,
      remaining: allowance === null ? null : Math.max(0, allowance - current),
      warningThresholdPercent,
      status: usageMetricStatus(current, allowance, warningThresholdPercent),
    };
  });
}

export function formatUsageValue(value: number, unit: string) {
  if (unit === "bytes") {
    if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(value >= 10_000_000_000 ? 0 : 1)} GB`;
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)} MB`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)} KB`;
    return `${Math.round(value)} B`;
  }
  return Math.round(value).toLocaleString();
}
