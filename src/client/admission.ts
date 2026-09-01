import type { ISession, PendingSubmissionRetirement } from "@deepseek-ai/dsh-api-session-controller/client";
import { serializeImageDrafts, type CompanionImageDraft } from "./image-drafts.js";

export type CompanionAdmissionPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: import("@deepseek-ai/dsh-attachment").ImageMediaType; data: string; name?: string };

/** A Host-side admission rejection, distinct from a caller-side serialization failure. */
export class CompanionAdmissionError extends Error {
  readonly code: string;
  readonly admission = "rejected" as const;

  constructor(message: string, code = "prompt-rejected") {
    super(message);
    this.code = code;
    this.name = "CompanionAdmissionError";
  }
}

/** A caller-side failure before any Session-controller submission exists. */
export class CompanionPreControllerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanionPreControllerError";
  }
}

function reject(error: { code?: string; message?: string } | undefined, fallback: string): never {
  const code = typeof error?.code === "string" && error.code ? error.code : "prompt-rejected";
  throw new CompanionAdmissionError(error?.message || fallback, code);
}

/**
 * Register the alpha Session controller's request-id-backed echo before any
 * browser image serialization, then carry that exact identity into prompt().
 * The controller owns echo retirement and invokes onRetire at its authoritative
 * observed/failed boundary.
 */
export async function submitCompanionInput(
  session: Pick<ISession, "beginSubmission" | "prompt" | "command">,
  text: string,
  drafts: readonly CompanionImageDraft[] = [],
  onRetire?: (retirement: PendingSubmissionRetirement) => void,
  onSubmissionRetire?: (requestId: string, retirement: PendingSubmissionRetirement) => void,
): Promise<void> {
  if (text === "/compact") {
    if (drafts.length > 0) throw new CompanionPreControllerError("compact-with-images");
    const result = await session.command(text);
    if (!result.ok) throw new CompanionPreControllerError(result.error?.message || "compact-command-rejected");
    if (!result.value?.matched) throw new CompanionPreControllerError("compact-command-unavailable");
    return;
  }

  let requestId: string | undefined;
  const handle = session.beginSubmission({
    mode: "queue",
    text,
    images: drafts.map((draft) => ({ previewUrl: draft.previewUrl, ...(draft.file.name ? { name: draft.file.name } : {}) })),
    onRetire: (retirement) => {
      if (requestId) onSubmissionRetire?.(requestId, retirement);
      onRetire?.(retirement);
    },
  });
  requestId = handle.requestId;
  try {
    const images = await serializeImageDrafts(drafts);
    const content: CompanionAdmissionPart[] = [...images, ...(text ? [{ type: "text" as const, text }] : [])];
    const result = await session.prompt(content, "queue", undefined, handle.requestId);
    if (!result.ok) reject(result.error, "prompt-rejected");
  } catch (error) {
    // The controller's abandon path is deliberately idempotent; on a thrown
    // serialization/carrier failure it provides the only pre-prompt cleanup.
    handle.abandon();
    throw error;
  }
}
