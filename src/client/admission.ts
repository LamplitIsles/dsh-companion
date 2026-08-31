import type { ImagePromptPart } from "./image-drafts.js";

export type CompanionPromptPart = { type: "text"; text: string } | ImagePromptPart;

export interface QueuePromptSession {
  prompt(content: CompanionPromptPart[], mode: "queue" | "steer"): Promise<{ ok: boolean; error?: { message: string } }>;
}

export interface CompanionInputSession extends QueuePromptSession {
  command(line: string): Promise<{ ok: boolean; value?: { matched: boolean }; error?: { message: string } }>;
}

/** A Host response that explicitly rejected admission (as opposed to a transport failure). */
export class CompanionPromptRejectedError extends Error {
  readonly code = "prompt-rejected" as const;

  constructor(message: string) {
    super(message);
    this.name = "CompanionPromptRejectedError";
  }
}

export function isCompanionPromptRejectedError(error: unknown): error is CompanionPromptRejectedError {
  return error instanceof CompanionPromptRejectedError
    || (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "prompt-rejected");
}

/** Companion intentionally exposes no interrupt/steer affordance. */
export async function queueCompanionPrompt(session: QueuePromptSession, content: CompanionPromptPart[]): Promise<void> {
  const result = await session.prompt(content, "queue");
  if (!result.ok) throw new CompanionPromptRejectedError(result.error?.message ?? "prompt-rejected");
}

/** Route the one command exposed by the minimal Companion composer. */
export async function submitCompanionInput(session: CompanionInputSession, text: string, images: readonly ImagePromptPart[] = []): Promise<void> {
  if (text === "/compact") {
    if (images.length > 0) throw new Error("compact-with-images");
    const result = await session.command(text);
    if (!result.ok) throw new CompanionPromptRejectedError(result.error?.message ?? "compact-command-rejected");
    if (!result.value?.matched) throw new Error("compact-command-unavailable");
    return;
  }
  await queueCompanionPrompt(session, [...images, ...(text ? [{ type: "text" as const, text }] : [])]);
}
