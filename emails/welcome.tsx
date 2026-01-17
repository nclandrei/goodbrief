import {
  Html,
  Head,
  Body,
  Container,
  Preview,
  Section,
  Text,
  Link,
  Font,
} from "@react-email/components";
import * as React from "react";

import { Header } from "./components/Header";
import { Footer } from "./components/Footer";

const styles = {
  body: {
    backgroundColor: "#f5f1eb",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    margin: "0",
    padding: "0",
  },
  container: {
    backgroundColor: "#ffffff",
    maxWidth: "600px",
    margin: "0 auto",
    padding: "0 24px",
  },
  section: {
    padding: "24px 0",
  },
  greeting: {
    fontSize: "20px",
    fontWeight: "600" as const,
    color: "#1f2937",
    margin: "0 0 16px",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  text: {
    fontSize: "16px",
    lineHeight: "1.6",
    color: "#1f2937",
    margin: "0 0 16px",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  highlight: {
    fontSize: "16px",
    lineHeight: "1.6",
    color: "#1f2937",
    margin: "24px 0",
    padding: "16px",
    backgroundColor: "#f0fdf4",
    borderLeft: "4px solid #3d5f46",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  link: {
    color: "#3d5f46",
    textDecoration: "underline",
  },
  signOff: {
    fontSize: "16px",
    lineHeight: "1.6",
    color: "#1f2937",
    margin: "24px 0 0",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
};

export function Welcome() {
  return (
    <Html lang="ro">
      <Head>
        <Font
          fontFamily="system-ui"
          fallbackFontFamily={["Arial", "sans-serif"]}
        />
      </Head>
      <Preview>Bine ai venit la Good Brief! 🎉</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Header />
          <Section style={styles.section}>
            <Text style={styles.greeting}>Bine ai venit! 👋</Text>
            <Text style={styles.text}>
              Mulțumim că te-ai abonat la Good Brief – locul tău pentru vești
              bune din România.
            </Text>
            <Text style={styles.text}>
              În fiecare săptămână, îți trimitem un email cu cele mai frumoase
              povești din țară: oameni care fac bine, reușite demne de
              celebrat, și inițiative verzi care ne dau speranță.
            </Text>
            <Text style={styles.highlight}>
              🌱 Local Heroes · 🏆 Wins · 💚 Green Stuff
              <br />
              <br />
              Totul în sub 5 minute. No doomscrolling, feel-good only.
            </Text>
            <Text style={styles.text}>
              Primul tău newsletter ajunge curând. Până atunci, poți explora{" "}
              <Link href="https://goodbrief.ro/issues" style={styles.link}>
                arhiva de ediții
              </Link>{" "}
              pentru o doză de optimism.
            </Text>
            <Text style={styles.signOff}>
              Thanks for joining! 🙏
              <br />
              <br />
              Ai o poveste bună? Reply la acest email sau scrie-ne la{" "}
              <Link href="mailto:hello@goodbrief.ro" style={styles.link}>
                hello@goodbrief.ro
              </Link>
              .
            </Text>
          </Section>
          <Footer />
        </Container>
      </Body>
    </Html>
  );
}

export default Welcome;
