import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { XmarkIcon } from "@dynatrace/strato-icons";

/**
 * A right-anchored overlay panel — a focused alternative to the full-screen
 * Strato Sheet. Renders a dimmed backdrop (click or Escape to dismiss) and a
 * fixed panel on the right edge sized to `width` (capped at 92vw on narrow
 * screens). `zIndex` lets panels stack (e.g. Assist above the detail panel).
 */
export const SidePanel = ({
  show,
  title,
  actions,
  onDismiss,
  width = 820,
  zIndex = 1000,
  children,
}: {
  show: boolean;
  title: React.ReactNode;
  actions?: React.ReactNode;
  onDismiss: () => void;
  width?: number;
  zIndex?: number;
  children: React.ReactNode;
}) => {
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show, onDismiss]);

  if (!show) return null;

  // Portal to <body> so `position: fixed` is relative to the viewport even if an
  // ancestor establishes a containing block (transform/filter/perspective).
  return createPortal(
    <>
      <div
        role="presentation"
        onClick={onDismiss}
        style={{
          position: "fixed",
          inset: 0,
          background: "var(--dt-colors-background-surface-backdrop, #38384266)",
          zIndex,
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: `min(${width}px, 92vw)`,
          background: "var(--dt-colors-background-base-default, #fafafb)",
          boxShadow: "var(--dt-box-shadows-surface-floating-rest, -8px 0 24px #38384229)",
          zIndex: zIndex + 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <Flex
          justifyContent="space-between"
          alignItems="center"
          gap={8}
          paddingX={24}
          paddingY={16}
          style={{ borderBottom: "1px solid var(--dt-colors-border-neutral-default, #e8e8ed)" }}
        >
          <div style={{ minWidth: 0 }}>
            {typeof title === "string" ? <Text>{title}</Text> : title}
          </div>
          <Flex alignItems="center" gap={8}>
            {actions}
            <Button aria-label="Close" onClick={onDismiss}>
              <Button.Prefix>
                <XmarkIcon />
              </Button.Prefix>
            </Button>
          </Flex>
        </Flex>
        <div style={{ overflow: "auto", flex: 1, padding: 24 }}>{children}</div>
      </div>
    </>,
    document.body
  );
};
