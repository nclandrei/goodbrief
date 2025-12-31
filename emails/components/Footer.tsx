import { Section, Text, Link, Hr } from "@react-email/components";
import * as React from "react";

const styles = {
  section: {
    textAlign: "center" as const,
    padding: "24px 0 32px",
  },
  hr: {
    borderColor: "#e5e7eb",
    margin: "0 0 24px",
  },
  text: {
    fontSize: "14px",
    color: "#6b7280",
    margin: "0 0 8px",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  link: {
    color: "#6b7280",
    textDecoration: "underline",
  },
};

export function Footer() {
  return (
    <Section style={styles.section}>
      <Hr style={styles.hr} />
      <Text style={styles.text}>
        Good Brief ·{" "}
        <Link href="https://goodbrief.ro" style={styles.link}>
          goodbrief.ro
        </Link>
      </Text>
      <Text style={styles.text}>
        <Link href="{{{RESEND_UNSUBSCRIBE_URL}}}" style={styles.link}>
          Dezabonare
        </Link>
      </Text>
    </Section>
  );
}
