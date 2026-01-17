interface Env {
  RESEND_API_KEY: string;
  RESEND_AUDIENCE_ID: string;
  RESEND_FROM_EMAIL?: string;
  RESEND_REPLY_TO?: string;
}

const welcomeEmailHtml = `
<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="background-color: #f5f1eb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 0;">
  <div style="background-color: #ffffff; max-width: 600px; margin: 0 auto; padding: 0 24px;">
    <div style="text-align: center; padding: 32px 0 24px;">
      <img src="https://goodbrief.ro/logo.png" alt="Good Brief" width="120" height="120" style="margin: 0 auto;">
      <p style="font-size: 16px; color: #6b7280; margin: 16px 0 0;">Vești bune din România</p>
    </div>
    <div style="padding: 24px 0;">
      <p style="font-size: 20px; font-weight: 600; color: #1f2937; margin: 0 0 16px;">Bine ai venit! 👋</p>
      <p style="font-size: 16px; line-height: 1.6; color: #1f2937; margin: 0 0 16px;">
        Mulțumim că te-ai abonat la Good Brief – locul tău pentru vești bune din România.
      </p>
      <p style="font-size: 16px; line-height: 1.6; color: #1f2937; margin: 0 0 16px;">
        În fiecare săptămână, îți trimitem un email cu cele mai frumoase povești din țară: oameni care fac bine, reușite demne de celebrat, și inițiative verzi care ne dau speranță.
      </p>
      <p style="font-size: 16px; line-height: 1.6; color: #1f2937; margin: 24px 0; padding: 16px; background-color: #f0fdf4; border-left: 4px solid #3d5f46;">
        🌱 Local Heroes · 🏆 Wins · 💚 Green Stuff<br><br>
        Totul în sub 5 minute. No doomscrolling, feel-good only.
      </p>
      <p style="font-size: 16px; line-height: 1.6; color: #1f2937; margin: 0 0 16px;">
        Primul tău newsletter ajunge curând. Până atunci, poți explora 
        <a href="https://goodbrief.ro/issues" style="color: #3d5f46; text-decoration: underline;">arhiva de ediții</a> 
        pentru o doză de optimism.
      </p>
      <p style="font-size: 16px; line-height: 1.6; color: #1f2937; margin: 24px 0 0;">
        Thanks for joining! 🙏<br><br>
        Ai o poveste bună? Reply la acest email sau scrie-ne la 
        <a href="mailto:hello@goodbrief.ro" style="color: #3d5f46; text-decoration: underline;">hello@goodbrief.ro</a>.
      </p>
    </div>
    <div style="text-align: center; padding: 24px 0 32px;">
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 0 0 24px;">
      <p style="font-size: 14px; color: #6b7280; margin: 0;">
        Good Brief · <a href="https://goodbrief.ro" style="color: #6b7280; text-decoration: underline;">goodbrief.ro</a>
      </p>
    </div>
  </div>
</body>
</html>
`;

async function sendWelcomeEmail(email: string, env: Env): Promise<void> {
  const fromEmail = env.RESEND_FROM_EMAIL || "buna@goodbrief.ro";
  const replyTo = env.RESEND_REPLY_TO || "hello@goodbrief.ro";

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `Good Brief <${fromEmail}>`,
      to: email,
      reply_to: replyTo,
      subject: "Bine ai venit la Good Brief! 🎉",
      html: welcomeEmailHtml,
    }),
  });
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data: object, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const body = await context.request.json() as { email?: string };
    const email = body.email?.trim().toLowerCase();

    if (!email) {
      return jsonResponse(
        { success: false, message: "Adresa de email este obligatorie." },
        400
      );
    }

    if (!isValidEmail(email)) {
      return jsonResponse(
        { success: false, message: "Adresa de email nu este validă." },
        400
      );
    }

    const response = await fetch(
      `https://api.resend.com/audiences/${context.env.RESEND_AUDIENCE_ID}/contacts`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${context.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          unsubscribed: false,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("Resend API error:", errorData);
      
      if (response.status === 409) {
        return jsonResponse(
          { success: true, message: "Ești deja abonat! 🎉" },
          200
        );
      }

      return jsonResponse(
        { success: false, message: "A apărut o eroare. Te rugăm să încerci din nou." },
        500
      );
    }

    try {
      await sendWelcomeEmail(email, context.env);
    } catch (welcomeError) {
      console.error("Failed to send welcome email:", welcomeError);
    }

    return jsonResponse({
      success: true,
      message: "Te-ai abonat cu succes! 🎉",
    });
  } catch (error) {
    console.error("Subscribe error:", error);
    return jsonResponse(
      { success: false, message: "A apărut o eroare. Te rugăm să încerci din nou." },
      500
    );
  }
};
