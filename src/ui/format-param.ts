/**
 * Format a normalized parameter value for display.
 * Pure utility — no state, no side effects.
 */

import { normalizedToParam } from "@/audio/params";

export function formatParam(
  normalized: number,
  param: { min: number; max: number; scale: string; unit?: string; steps?: number; valueLabels?: string[] }
): string {
  const value = normalizedToParam(normalized, param as Parameters<typeof normalizedToParam>[1]);
  if (param.valueLabels && param.steps && param.steps > 1) {
    const stepIndex = Math.round((value - param.min) / (param.max - param.min) * (param.steps - 1));
    return param.valueLabels[Math.max(0, Math.min(param.valueLabels.length - 1, stepIndex))] ?? `${Math.round(value)}`;
  }
  if (param.unit === "Hz") {
    return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : `${Math.round(value)}`;
  }
  if (param.unit === "s") {
    return value < 0.1 ? `${Math.round(value * 1000)}ms` : `${value.toFixed(2)}s`;
  }
  if (param.unit === "¢") {
    return `${Math.round(value)}¢`;
  }
  if (param.unit === "dB") {
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(1)}`;
  }
  return value % 1 === 0 ? `${value}` : `${value.toFixed(2)}`;
}
