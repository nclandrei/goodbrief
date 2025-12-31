interface Env {
  RESEND_API_KEY: string;
  RESEND_AUDIENCE_ID: string;
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
