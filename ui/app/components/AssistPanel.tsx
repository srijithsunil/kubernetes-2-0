import React, { useEffect, useRef, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Paragraph, Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { TextInput } from "@dynatrace/strato-components/forms";
import { AiResponse } from "@dynatrace/strato-components/content";
import { SidePanel } from "./SidePanel";
import { useAssist } from "../lib/assist";
import { explainEntity } from "../ai/explain";

type LoadingMsg = { role: "assistant"; loading: true };
type Msg =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; ok: true }
  | { role: "assistant"; text: string; hint?: string; ok: false }
  | LoadingMsg;

const isLoading = (m: Msg): m is LoadingMsg => "loading" in m && m.loading === true;

/** Build a running transcript so follow-up questions keep conversational context. */
const transcript = (baseContext: string, msgs: Msg[]): string => {
  const turns = msgs
    .filter((m) => !isLoading(m))
    .map((m) =>
      m.role === "user" ? `User asked: ${m.text}` : `You answered: ${"text" in m ? m.text : ""}`
    );
  return [baseContext, ...(turns.length ? ["Conversation so far:", ...turns] : [])].join("\n");
};

const UserBubble = ({ text }: { text: string }) => (
  <Flex justifyContent="flex-end">
    <div
      style={{
        maxWidth: "85%",
        background: "var(--dt-colors-background-container-neutral-default, #f2f2f5)",
        borderRadius: 12,
        padding: "8px 12px",
      }}
    >
      <Text>{text}</Text>
    </div>
  </Flex>
);

const AssistConversation = ({ subject, context }: { subject: string; context: string }) => {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Mirror of the settled (non-loading) conversation, read when building the
  // transcript for the next turn without depending on async state closures.
  const historyRef = useRef<Msg[]>([]);

  const ask = (prompt: string, display?: string) => {
    setBusy(true);
    if (display) historyRef.current = [...historyRef.current, { role: "user", text: display }];
    const grounding = transcript(context, historyRef.current);
    setMsgs((prev) => {
      const withUser: Msg[] = display ? [...prev, { role: "user", text: display }] : prev;
      return [...withUser, { role: "assistant", loading: true }];
    });
    void explainEntity(prompt, grounding).then((r) => {
      const answer: Msg = r.ok
        ? { role: "assistant", text: r.text, ok: true }
        : { role: "assistant", text: r.message, hint: r.hint, ok: false };
      historyRef.current = [...historyRef.current, answer];
      setMsgs((cur) => [...cur.filter((m) => !isLoading(m)), answer]);
      setBusy(false);
    });
  };

  // Kick off the initial explanation whenever a new entity is opened.
  useEffect(() => {
    setMsgs([]);
    setDraft("");
    historyRef.current = [];
    ask(`Explain the current state of ${subject}.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, context]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  const send = () => {
    const q = draft.trim();
    if (!q || busy) return;
    setDraft("");
    ask(q, q);
  };

  return (
    <Flex flexDirection="column" gap={16} height="100%">
      <Flex flexDirection="column" gap={4}>
        <Heading level={4}>{subject}</Heading>
        <Text textStyle="small">
          Powered by Dynatrace Intelligence · AI-generated, verify before acting
        </Text>
      </Flex>

      <Flex flexDirection="column" gap={16} style={{ flex: 1 }}>
        {msgs.map((m, i) =>
          isLoading(m) ? (
            <Text key={i} textStyle="small">
              Asking Dynatrace Intelligence…
            </Text>
          ) : m.role === "user" ? (
            <UserBubble key={i} text={m.text} />
          ) : m.ok ? (
            <AiResponse key={i} responseState="static">
              {m.text}
            </AiResponse>
          ) : (
            <Flex key={i} flexDirection="column" gap={2}>
              <Paragraph>{m.text}</Paragraph>
              {m.hint ? <Text textStyle="small">{m.hint}</Text> : null}
            </Flex>
          )
        )}
        <div ref={bottomRef} />
      </Flex>

      <Flex gap={8} alignItems="flex-end">
        <div style={{ flex: 1 }}>
          <TextInput
            value={draft}
            onChange={(v) => setDraft(v)}
            placeholder="Ask a follow-up…"
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
            aria-label="Ask Dynatrace Assist a follow-up question"
          />
        </div>
        <Button onClick={send} variant="accent" disabled={busy || !draft.trim()}>
          Send
        </Button>
      </Flex>
    </Flex>
  );
};

/** Global "Dynatrace Assist" side panel, mounted once at the app root. */
export const AssistPanel = () => {
  const { request, nonce, close } = useAssist();
  return (
    <SidePanel show={request != null} title="Dynatrace Assist" onDismiss={close} width={520} zIndex={1100}>
      {request ? (
        <AssistConversation key={nonce} subject={request.subject} context={request.context} />
      ) : null}
    </SidePanel>
  );
};
