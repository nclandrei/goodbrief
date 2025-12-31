import { Section, Text } from "@react-email/components";
import * as React from "react";

export interface IntroProps {
  greeting: string;
  introText: string;
}

const styles = {
  section: {
    padding: "8px 0 16px",
  },
  greeting: {
    fontSize: "18px",
    fontWeight: "bold" as const,
    color: "#1f2937",
    margin: "0 0 16px",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  intro: {
    fontSize: "16px",
    color: "#1f2937",
    lineHeight: "1.6",
    margin: "0",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
};

export function Intro({ greeting, introText }: IntroProps) {
  return (
    <Section style={styles.section}>
      <Text style={styles.greeting}>{greeting}</Text>
      <Text style={styles.intro}>{introText}</Text>
    </Section>
  );
}
