import type { ImagePromptPart } from "./image-drafts.js";

export type CompanionPromptPart = { type: "text"; text: string } | ImagePromptPart;

interface CompanionAdmissionError {
  code?: string;
  message?: string;
}

export interface QueuePromptSession {
  prompt(content: CompanionPromptPart[], mode: "queue" | "steer"): Promise<{ ok: boolean; error?: CompanionAdmissionError }>;
}

export interface CompanionInputSession extends QueuePromptSession {
  command(line: string): Promise<{ ok: boolean; value?: { matched: boolean }; error?: CompanionAdmissionError }>;
}

/** A Host response that explicitly rejected admission (as opposed to a transport failure). */
export class CompanionPromptRejectedError extends Error {
  readonly code: string;
  readonly admission = "rejected" as const;

  constructor(message: string, code = "prompt-rejected") {
    super(message);
    this.code = code;
    this.name = "CompanionPromptRejectedError";
  }
}

export function isCompanionPromptRejectedError(error: unknown): error is CompanionPromptRejectedError {
  if (error instanceof CompanionPromptRejectedError) return error.code !== "internal";
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { admission?: unknown; code?: unknown };
  return candidate.code !== "internal" && (candidate.admission === "rejected" || candidate.code === "prompt-rejected");
}

/** A Session `internal` result means the carrier outcome is unknown, not that admission was refused. */
export class CompanionTransportAmbiguousError extends Error {
  readonly code: string;
  readonly admission = "transport-ambiguous" as const;

  constructor(message: string, code = "internal") {
    super(message);
    this.code = code;
    this.name = "CompanionTransportAmbiguousError";
  }
}

function throwAdmissionError(error: CompanionAdmissionError | undefined, fallbackMessage: string): never {
  const code = typeof error?.code === "string" && error.code ? error.code : undefined;
  const message = error?.message || fallbackMessage;
  if (code === "internal") throw new CompanionTransportAmbiguousError(message, code);
  throw new CompanionPromptRejectedError(message, code);
}

/** Companion intentionally exposes no interrupt/steer affordance. */
export async function queueCompanionPrompt(session: QueuePromptSession, content: CompanionPromptPart[]): Promise<void> {
  const result = await session.prompt(content, "queue");
  if (!result.ok) throwAdmissionError(result.error, "prompt-rejected");
}

/** Route the one command exposed by the minimal Companion composer. */
export async function submitCompanionInput(session: CompanionInputSession, text: string, images: readonly ImagePromptPart[] = []): Promise<void> {
  if (text === "/compact") {
    if (images.length > 0) throw new Error("compact-with-images");
    const result = await session.command(text);
    if (!result.ok) throwAdmissionError(result.error, "compact-command-rejected");
    if (!result.value?.matched) throw new Error("compact-command-unavailable");
    return;
  }
  await queueCompanionPrompt(session, [...images, ...(text ? [{ type: "text" as const, text }] : [])]);
}
