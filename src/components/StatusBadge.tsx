import type { ExperimentStatus } from "../data/types";

const STYLES: Record<ExperimentStatus, { bg: string; color: string; label: string }> = {
  active: { bg: "var(--color-success-bg)", color: "var(--color-success-text)", label: "Active" },
  review: { bg: "var(--color-danger-bg)", color: "var(--color-danger-text)", label: "Review" },
  complete: { bg: "var(--color-complete-bg)", color: "var(--color-complete-text)", label: "Complete" },
  draft: { bg: "var(--color-bg-soft)", color: "var(--color-text-muted)", label: "Draft" },
};

export function StatusBadge({ status }: { status: ExperimentStatus }) {
  const s = STYLES[status];
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        padding: "2px 8px",
        borderRadius: 10,
        font: "600 10px system-ui",
        display: "inline-block",
      }}
    >
      {s.label}
    </span>
  );
}
