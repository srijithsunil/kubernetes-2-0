import React from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Paragraph } from "@dynatrace/strato-components/typography";

type Props = {
  title: string;
  caption?: string;
  children: React.ReactNode;
};

export const ViewShell = ({ title, caption, children }: Props) => {
  return (
    <Flex flexDirection="column" gap={16} padding={32}>
      <Flex flexDirection="column" gap={2}>
        <Heading level={1}>{title}</Heading>
        {caption ? <Paragraph>{caption}</Paragraph> : null}
      </Flex>
      {children}
    </Flex>
  );
};
