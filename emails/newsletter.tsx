import {
  Html,
  Head,
  Body,
  Container,
  Preview,
  Font,
} from "@react-email/components";
import * as React from "react";

import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { NewsItem, type NewsItemProps } from "./components/NewsItem";
import { SectionHeader } from "./components/SectionHeader";
import { Intro } from "./components/Intro";
import { SignOff } from "./components/SignOff";

export interface NewsletterSection {
  emoji: string;
  title: string;
  items: NewsItemProps[];
}

export interface NewsletterProps {
  previewText?: string;
  greeting: string;
  introText: string;
  signOffText: string;
  localHeroes: NewsItemProps[];
  wins: NewsItemProps[];
  greenStuff: NewsItemProps[];
}

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
};

export function Newsletter({
  previewText = "Vești bune din România - Good Brief",
  greeting,
  introText,
  signOffText,
  localHeroes,
  wins,
  greenStuff,
}: NewsletterProps) {
  const sections: NewsletterSection[] = [
    { emoji: "🌱", title: "Local Heroes", items: localHeroes },
    { emoji: "🏆", title: "Wins", items: wins },
    { emoji: "💚", title: "Green Stuff", items: greenStuff },
  ];

  return (
    <Html lang="ro">
      <Head>
        <Font
          fontFamily="system-ui"
          fallbackFontFamily={["Arial", "sans-serif"]}
        />
      </Head>
      <Preview>{previewText}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Header />
          <Intro greeting={greeting} introText={introText} />

          {sections.map(
            (section) =>
              section.items.length > 0 && (
                <React.Fragment key={section.title}>
                  <SectionHeader emoji={section.emoji} title={section.title} />
                  {section.items.map((item, index) => (
                    <NewsItem key={`${section.title}-${index}`} {...item} />
                  ))}
                </React.Fragment>
              )
          )}

          <SignOff signOffText={signOffText} />
          <Footer />
        </Container>
      </Body>
    </Html>
  );
}

export default Newsletter;
