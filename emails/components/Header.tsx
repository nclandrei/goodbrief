import { Section, Img, Text } from "@react-email/components";
import * as React from "react";

const styles = {
  section: {
    textAlign: "center" as const,
    padding: "32px 0 24px",
  },
  logo: {
    margin: "0 auto",
  },
  tagline: {
    fontSize: "16px",
    color: "#6b7280",
    margin: "16px 0 0",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
};

export function Header() {
  return (
    <Section style={styles.section}>
      <Img
        src="https://goodbrief.ro/logo.png"
        alt="Good Brief"
        width={120}
        height={120}
        style={styles.logo}
      />
      <Text style={styles.tagline}>Vești bune din România</Text>
    </Section>
  );
}
