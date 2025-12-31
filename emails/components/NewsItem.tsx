import { Section, Text, Link } from "@react-email/components";
import * as React from "react";

export interface NewsItemProps {
  title: string;
  summary: string;
  sourceUrl: string;
  sourceName: string;
}

const styles = {
  section: {
    padding: "16px 0",
  },
  title: {
    fontSize: "18px",
    fontWeight: "bold" as const,
    color: "#1f2937",
    margin: "0 0 8px",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  summary: {
    fontSize: "16px",
    color: "#1f2937",
    lineHeight: "1.6",
    margin: "0 0 12px",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  link: {
    fontSize: "16px",
    color: "#3d5f46",
    textDecoration: "none",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
};

export function NewsItem({ title, summary, sourceUrl, sourceName }: NewsItemProps) {
  return (
    <Section style={styles.section}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.summary}>{summary}</Text>
      <Link href={sourceUrl} style={styles.link}>
        → Citește pe {sourceName}
      </Link>
    </Section>
  );
}
