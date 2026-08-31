export interface QueuePromptSession {
  prompt(content: { type: "text"; text: string }[], mode: "queue" | "steer"): Promise<{ ok: boolean; error?: { message: string } }>;
}

export interface CompanionInputSession extends QueuePromptSession {
  command(line: string): Promise<{ ok: boolean; value?: { matched: boolean }; error?: { message: string } }>;
}

/** Companion intentionally exposes no interrupt/steer affordance. */
export async function queueCompanionPrompt(session: QueuePromptSession, text: string): Promise<void> {
  const result = await session.prompt([{ type: "text", text }], "queue");
  if (!result.ok) throw new Error(result.error?.message ?? "prompt-rejected");
}

/** Route the one command exposed by the minimal Companion composer. */
export async function submitCompanionInput(session: CompanionInputSession, text: string): Promise<void> {
  if (text === "/compact") {
    const result = await session.command(text);
    if (!result.ok) throw new Error(result.error?.message ?? "compact-command-rejected");
    if (!result.value?.matched) throw new Error("compact-command-unavailable");
    return;
  }
  await queueCompanionPrompt(session, text);
}
