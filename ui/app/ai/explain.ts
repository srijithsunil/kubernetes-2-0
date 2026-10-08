// "Explain with AI" wrapper, powered by Dynatrace Intelligence (Dynatrace Intelligence CoPilot API).
// Uses the recommender conversation endpoint; requires the
// davis-copilot:conversations:execute scope and Dynatrace Intelligence CoPilot enabled on the tenant.
import { publicClient } from "@dynatrace-sdk/client-davis-copilot";

export type ExplainResult =
  | { ok: true; text: string }
  | { ok: false; message: string; hint?: string };

const INSTRUCTION =
  "You are a Kubernetes SRE assistant. Given metric summaries, recent log lines, and the services " +
  "running in a Kubernetes entity, explain in plain language what is currently happening with this " +
  "entity, whether it looks healthy, and call out anything worth investigating (restarts, saturation, " +
  "errors). Be concise: a short summary followed by 2-4 bullet points. Do not invent data you were not given.";

function classify(err: unknown): { message: string; hint?: string } {
  const status = (err as { status?: number } | undefined)?.status;
  const message = (err as { message?: string } | undefined)?.message ?? "Request failed";
  if (status === 403) {
    return {
      message: "Dynatrace Intelligence access denied (403).",
      hint: "The app token is missing davis-copilot:conversations:execute. Sign out and back in to re-grant the scope, or ask an admin to approve it.",
    };
  }
  if (status === 404) {
    return {
      message: "Dynatrace Intelligence is not available on this environment (404).",
      hint: "Dynatrace Intelligence may not be enabled for this tenant.",
    };
  }
  return { message, hint: "Try again, or rephrase — Dynatrace Intelligence occasionally needs a moment." };
}

/** Ask Dynatrace Intelligence to explain an entity given a prebuilt context string. */
export async function explainEntity(prompt: string, context: string): Promise<ExplainResult> {
  try {
    const resp = await publicClient.recommenderConversation({
      body: {
        text: prompt,
        context: [
          { type: "instruction", value: INSTRUCTION },
          { type: "supplementary", value: context },
        ],
      },
    });
    if (Array.isArray(resp)) {
      return { ok: false, message: "Dynatrace Intelligence returned an unexpected streaming response." };
    }
    if (!resp || resp.status === "FAILED" || !resp.text) {
      return {
        ok: false,
        message: "Dynatrace Intelligence processed the request but produced no answer.",
        hint: "Rephrase as a question (What / Why / How) and try again.",
      };
    }
    return { ok: true, text: resp.text };
  } catch (err) {
    const c = classify(err);
    return { ok: false, message: c.message, hint: c.hint };
  }
}
