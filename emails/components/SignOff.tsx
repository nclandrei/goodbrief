import { Section, Text, Link } from "@react-email/components";
import * as React from "react";

export interface SignOffProps {
  signOffText: string;
}

const styles = {
  section: {
    padding: "24px 0 16px",
  },
  signOff: {
    fontSize: "16px",
    color: "#1f2937",
    lineHeight: "1.6",
    margin: "0 0 16px",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  cta: {
    fontSize: "16px",
    color: "#6b7280",
    lineHeight: "1.6",
    margin: "0",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  link: {
    color: "#3d5f46",
    textDecoration: "none",
  },
};

export function SignOff({ signOffText }: SignOffProps) {
  return (
    <Section style={styles.section}>
      <Text style={styles.signOff}>{signOffText}</Text>
      <Text style={styles.cta}>
        Ai o poveste bună? Reply la acest email sau scrie-ne la{" "}
        <Link href="mailto:contact@goodbrief.ro" style={styles.link}>
          contact@goodbrief.ro
        </Link>
      </Text>
    </Section>
  );
}
