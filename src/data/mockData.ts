import type { Experiment, ExperimentDetail } from "./types";

export const currentUser = {
  name: "Dr. S. Chen",
  initials: "SC",
  department: "Immunology",
  email: "s.chen@labos.io",
};

export const dashboardStats = [
  { label: "Active", value: "12", note: "↑ 3 this week", noteColor: "positive" as const },
  { label: "Protocols Run", value: "48", note: "This month", noteColor: "neutral" as const },
  { label: "Collaborators", value: "7", note: "3 projects", noteColor: "neutral" as const },
  { label: "AI Insights", value: "3", note: "New suggestions", noteColor: "accent" as const },
];

export const experiments: Experiment[] = [
  {
    id: "EXP-2026-0142",
    name: "CRISPR-Cas9 T-Cell Knockout",
    project: "Immunotherapy",
    status: "active",
    modified: "2h ago",
    owner: "S. Chen",
    ownerInitials: "SC",
    tags: ["CRISPR", "T-cells"],
  },
  {
    id: "EXP-2026-0141",
    name: "Flow Cytometry — CD4/CD8 Panel",
    project: "Immunotherapy",
    status: "active",
    modified: "Yesterday",
    owner: "M. Patel",
    ownerInitials: "MP",
    tags: ["Flow Cyto"],
  },
  {
    id: "EXP-2026-0139",
    name: "Western Blot — Protein Expression",
    project: "Proteomics",
    status: "review",
    modified: "3 days ago",
    owner: "S. Chen",
    ownerInitials: "SC",
    tags: ["Western Blot"],
  },
  {
    id: "EXP-2026-0138",
    name: "Gel Electrophoresis — Batch 7",
    project: "Genomics",
    status: "complete",
    modified: "1 week ago",
    owner: "J. Kim",
    ownerInitials: "JK",
    tags: ["Electrophoresis"],
  },
  {
    id: "EXP-2026-0136",
    name: "Single-cell RNA Sequencing — Batch 3",
    project: "Genomics",
    status: "active",
    modified: "2 days ago",
    owner: "A. Reyes",
    ownerInitials: "AR",
    tags: ["scRNA-seq"],
  },
  {
    id: "EXP-2026-0135",
    name: "PCR Validation — Knockout Confirmation",
    project: "Immunotherapy",
    status: "draft",
    modified: "5 days ago",
    owner: "S. Chen",
    ownerInitials: "SC",
    tags: ["PCR"],
  },
];

export const dashboardAIBanner = {
  title: "AI: Transfection efficiency ↓23% in EXP-2026-0142",
  body: "Matches buffer prep anomaly from 2 prior runs. Compare Cas9:sgRNA ratio with EXP-2026-0131.",
  actionLabel: "View Analysis →",
};

export const experimentDetails: Record<string, ExperimentDetail> = {
  "EXP-2026-0142": {
    id: "EXP-2026-0142",
    name: "CRISPR-Cas9 T-Cell Knockout",
    project: "Immunotherapy",
    status: "active",
    modified: "2h ago",
    owner: "S. Chen",
    ownerInitials: "SC",
    tags: ["CRISPR", "T-cells"],
    objective:
      "Investigate PD-1 knockout effect on CD8+ T-cell cytotoxic activation. CRISPR-Cas9 targeting PDCD1 locus in primary human T cells from healthy donor PBMCs.",
    protocol: [
      {
        id: "s1",
        label: "PBMC isolation — Ficoll gradient",
        status: "done",
        completedBy: "S.C.",
        completedAt: "9:12 AM",
      },
      {
        id: "s2",
        label: "CD8+ T cell enrichment — EasySep Kit",
        status: "done",
        completedBy: "M.P.",
        completedAt: "11:30 AM",
      },
      {
        id: "s3",
        label: "RNP assembly — Cas9 protein + PD-1 sgRNA",
        status: "in_progress",
      },
      {
        id: "s4",
        label: "Electroporation — Nucleofection 4D",
        status: "pending",
      },
      {
        id: "s5",
        label: "48h recovery in X-VIVO 15 media",
        status: "pending",
      },
    ],
    aiInsights: [
      {
        id: "ai1",
        kind: "alert",
        title: "⚠ Efficiency Alert",
        body: "Transfection eff. 23% below your 5-run avg. Compare Cas9:sgRNA ratio with EXP-2026-0131 where a 1:2.5 ratio resolved similar drop.",
      },
      {
        id: "ai2",
        kind: "success",
        title: "✓ Steps 1–2 On Track",
        body: "Ficoll separation yield consistent with lab average. Viability >95%.",
      },
      {
        id: "ai3",
        kind: "suggestion",
        title: "Suggestion",
        body: "Add trypan blue viability check pre-electroporation — improves Cas9 delivery ~18% per 3 internal runs.",
        actionLabel: "+ Add Step",
      },
    ],
    comments: [
      {
        id: "c1",
        author: "M. Patel",
        initials: "MP",
        body: "Purity came back at 97% for the CD8+ enrichment — logged in step 2.",
        postedAt: "Yesterday, 11:34 AM",
      },
      {
        id: "c2",
        author: "S. Chen",
        initials: "SC",
        body: "Starting RNP assembly now, will update once electroporation is done.",
        postedAt: "Today, 9:20 AM",
      },
    ],
    history: [
      { id: "h1", actor: "S. Chen", action: "Created experiment", timestamp: "Jul 3, 2026 · 4:02 PM" },
      { id: "h2", actor: "S. Chen", action: "Completed step: PBMC isolation", timestamp: "Jul 6, 2026 · 9:12 AM" },
      { id: "h3", actor: "M. Patel", action: "Completed step: CD8+ T cell enrichment", timestamp: "Jul 6, 2026 · 11:30 AM" },
      { id: "h4", actor: "AI Assistant", action: "Flagged transfection efficiency anomaly", timestamp: "Jul 6, 2026 · 1:15 PM" },
    ],
  },
};
