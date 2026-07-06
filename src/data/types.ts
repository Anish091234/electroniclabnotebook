export type ExperimentStatus = "active" | "review" | "complete" | "draft";

export interface Experiment {
  id: string;
  name: string;
  project: string;
  status: ExperimentStatus;
  modified: string;
  owner: string;
  ownerInitials: string;
  tags: string[];
}

export type ProtocolStepStatus = "done" | "in_progress" | "pending";

export interface ProtocolStep {
  id: string;
  label: string;
  status: ProtocolStepStatus;
  completedBy?: string;
  completedAt?: string;
  note?: string;
}

export type AIInsightKind = "alert" | "success" | "suggestion";

export interface AIInsight {
  id: string;
  kind: AIInsightKind;
  title: string;
  body: string;
  actionLabel?: string;
}

export interface Comment {
  id: string;
  author: string;
  initials: string;
  body: string;
  postedAt: string;
}

export interface HistoryEntry {
  id: string;
  actor: string;
  action: string;
  timestamp: string;
}

export interface ExperimentDetail extends Experiment {
  objective: string;
  protocol: ProtocolStep[];
  aiInsights: AIInsight[];
  comments: Comment[];
  history: HistoryEntry[];
}
