import type { ExperimentStatus } from "../data/types";

const STYLES: Record<ExperimentStatus, { bg: string; color: string; label: string }> = {
  active: { bg: "#dcfce7", color: "#15803d", label: "Active" },
  review: { bg: "#fee2e2", color: "#b91c1c", label: "Review" },
  complete: { bg: "#dbeafe", color: "#1e40af", label: "Complete" },
  draft: { bg: "#f1f5f9", color: "#64748b", label: "Draft" },
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
