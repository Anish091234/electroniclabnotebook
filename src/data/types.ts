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

export interface ProtocolStepTemplate {
  id: string;
  order: number;
  title: string;
  description: string;
  duration?: string;
  reagents?: string[];
}

export interface ProtocolVersionEntry {
  id: string;
  version: string;
  changeSummary: string;
  author: string;
  date: string;
}

export interface ProtocolUsage {
  experimentId: string;
  experimentName: string;
  usedAt: string;
}

export interface Protocol {
  id: string;
  name: string;
  category: string;
  version: string;
  stepCount: number;
  lastUpdated: string;
  updatedBy: string;
  usedCount: number;
  successRate?: number;
}

export interface ProtocolDetail extends Protocol {
  description: string;
  steps: ProtocolStepTemplate[];
  usedIn: ProtocolUsage[];
  versionHistory: ProtocolVersionEntry[];
  aiInsight?: {
    title: string;
    body: string;
  };
}
