import type { CompanionProjection } from "../projection.js";
import type { CompanionContinuitySnapshot, ContextPressureProjection } from "../continuity.js";
import type { ImageAttachmentLimits } from "@deepseek-ai/dsh-attachment";
import type { CompanionImageDraft } from "./image-drafts.js";
import type { PendingSubmissionRetirement } from "@deepseek-ai/dsh-api-session-controller/client";

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
  send: (text: string, images: readonly CompanionImageDraft[], onRetire?: (retirement: PendingSubmissionRetirement) => void) => Promise<void>;
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
  /** Browser-only draft images must not cross an active Session switch. */
  sessionId?: string;
  /** Host-advertised image capability and intake limits; absent means unavailable. */
  imageLimits?: ImageAttachmentLimits;
  continuity?: CompanionContinuityView;
  onAdvanced?: () => void;
  onRecovery?: () => void;
}
