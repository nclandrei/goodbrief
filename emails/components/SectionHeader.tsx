import { Section, Text, Hr } from "@react-email/components";
import * as React from "react";

export interface SectionHeaderProps {
  emoji: string;
  title: string;
}

const styles = {
  section: {
    padding: "24px 0 8px",
  },
  text: {
    fontSize: "14px",
    color: "#3d5f46",
    textTransform: "uppercase" as const,
    letterSpacing: "1px",
    margin: "0 0 8px",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  hr: {
    borderColor: "#e5e7eb",
    margin: "0",
  },
};

export function SectionHeader({ emoji, title }: SectionHeaderProps) {
  return (
    <Section style={styles.section}>
      <Text style={styles.text}>
        {emoji} {title}
      </Text>
      <Hr style={styles.hr} />
    </Section>
  );
}
