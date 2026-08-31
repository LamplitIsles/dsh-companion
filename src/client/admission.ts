export interface QueuePromptSession {
  prompt(content: { type: "text"; text: string }[], mode: "queue" | "steer"): Promise<{ ok: boolean; error?: { message: string } }>;
}

/** Companion intentionally exposes no interrupt/steer affordance. */
export async function queueCompanionPrompt(session: QueuePromptSession, text: string): Promise<void> {
  const result = await session.prompt([{ type: "text", text }], "queue");
  if (!result.ok) throw new Error(result.error?.message ?? "prompt-rejected");
}
