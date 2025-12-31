import { render } from "@react-email/components";
import type { ReactElement } from "react";

export interface RenderOptions {
  pretty?: boolean;
}

export async function renderEmailToHtml(
  template: ReactElement,
  options: RenderOptions = {}
): Promise<string> {
  const { pretty = false } = options;

  const html = await render(template, { pretty });

  return html;
}

export async function renderEmailToPlainText(
  template: ReactElement
): Promise<string> {
  const text = await render(template, { plainText: true });

  return text;
}
