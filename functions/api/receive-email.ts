interface Env {
  RESEND_API_KEY: string;
  FORWARD_EMAIL: string;
  RESEND_WEBHOOK_SECRET: string;
}

interface ResendEmailEvent {
  type: "email.received";
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject: string;
  };
}

interface ReceivedEmail {
  from: string;
  to: string[];
  subject: string;
  html?: string;
  text?: string;
  created_at: string;
}

async function verifyWebhookSignature(
  payload: string,
  headers: Headers,
  secret: string
): Promise<boolean> {
  const svixId = headers.get("svix-id");
  const svixTimestamp = headers.get("svix-timestamp");
  const svixSignature = headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return false;
  }

  // Check timestamp to prevent replay attacks (5 min tolerance)
  const timestamp = parseInt(svixTimestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) {
    return false;
  }

  // Build signed content and verify signature
  const signedContent = `${svixId}.${svixTimestamp}.${payload}`;
  const secretBytes = base64ToUint8Array(secret.replace("whsec_", ""));

  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedContent)
  );

  const expectedSignature = uint8ArrayToBase64(new Uint8Array(signatureBytes));

  // Svix sends multiple signatures, check if any match
  const signatures = svixSignature.split(" ");
  for (const sig of signatures) {
    const [version, signature] = sig.split(",");
    if (version === "v1" && signature === expectedSignature) {
      return true;
    }
  }

  return false;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function getEmailContent(
  emailId: string,
  apiKey: string
): Promise<ReceivedEmail> {
  const response = await fetch(
    `https://api.resend.com/emails/${emailId}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch email: ${response.status}`);
  }

  return response.json();
}

async function forwardEmail(
  email: ReceivedEmail,
  forwardTo: string,
  apiKey: string
): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Good Brief <hello@goodbrief.ro>",
      to: forwardTo,
      reply_to: email.from,
      subject: `[Fwd] ${email.subject}`,
      html: buildForwardedHtml(email),
      text: buildForwardedText(email),
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to forward email: ${error}`);
  }
}

function buildForwardedHtml(email: ReceivedEmail): string {
  return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 16px; background: #f5f5f5; border-radius: 8px; margin-bottom: 16px;">
  <p style="margin: 0 0 8px;"><strong>From:</strong> ${escapeHtml(email.from)}</p>
  <p style="margin: 0 0 8px;"><strong>To:</strong> ${escapeHtml(email.to.join(", "))}</p>
  <p style="margin: 0 0 8px;"><strong>Subject:</strong> ${escapeHtml(email.subject)}</p>
  <p style="margin: 0;"><strong>Date:</strong> ${new Date(email.created_at).toLocaleString("ro-RO")}</p>
</div>
<hr style="border: none; border-top: 1px solid #ddd; margin: 16px 0;">
${email.html || `<pre style="white-space: pre-wrap;">${escapeHtml(email.text || "")}</pre>`}
`;
}

function buildForwardedText(email: ReceivedEmail): string {
  return `---------- Forwarded message ----------
From: ${email.from}
To: ${email.to.join(", ")}
Subject: ${email.subject}
Date: ${new Date(email.created_at).toLocaleString("ro-RO")}

${email.text || ""}
`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const payload = await context.request.text();

    // Verify webhook signature
    const isValid = await verifyWebhookSignature(
      payload,
      context.request.headers,
      context.env.RESEND_WEBHOOK_SECRET
    );

    if (!isValid) {
      console.error("Invalid webhook signature");
      return new Response("Unauthorized", { status: 401 });
    }

    const event = JSON.parse(payload) as ResendEmailEvent;

    if (event.type !== "email.received") {
      return new Response("Ignored", { status: 200 });
    }

    console.log(`Received email from ${event.data.from}: ${event.data.subject}`);

    const email = await getEmailContent(
      event.data.email_id,
      context.env.RESEND_API_KEY
    );

    await forwardEmail(email, context.env.FORWARD_EMAIL, context.env.RESEND_API_KEY);

    console.log(`Forwarded email to ${context.env.FORWARD_EMAIL}`);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Receive email error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to process email" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
