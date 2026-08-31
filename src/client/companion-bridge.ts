import type { CompanionProjection } from "../projection.js";
import type { CompanionContinuitySnapshot, ContextPressureProjection } from "../continuity.js";

export interface CompanionIdentityView {
  companionName: string;
  companionAvatar?: string;
  userName: string;
  userAvatar?: string;
  preferredAddress: string;
  signature: string;
  moodLabel: string;
  mood: string;
  intensity: number;
  moodNote?: string;
  affinity?: number;
  affinityStage?: string;
}
export interface CompanionActions {
  send: (text: string) => Promise<void>;
  stop?: () => Promise<void>;
  selectSession?: (sessionId: string) => Promise<void>;
  loadOlder?: () => Promise<void>;
  attachmentUrl?: (attachment: unknown) => Promise<string>;
  prepareVoice?: (text: string) => Promise<string>;
}
export interface CompanionSessionView {
  id: string;
  title: string;
  updatedAt: number;
  running: boolean;
  selected: boolean;
}

export interface CompanionContinuityView {
  /** Host-projected context pressure; absent means the meter is unavailable. */
  contextPressure?: ContextPressureProjection;
  /** Session-scoped compaction lifecycle facts from the public view registry. */
  lifecycle?: CompanionContinuitySnapshot;
}

export interface CompanionBridgeProps {
  projection: CompanionProjection;
  identity: CompanionIdentityView;
  scheme: "light" | "dark";
  actions: CompanionActions;
  sessions: CompanionSessionView[];
  workspaceReady: boolean;
  sessionReady: boolean;
  continuity?: CompanionContinuityView;
  onAdvanced?: () => void;
  onRecovery?: () => void;
}
