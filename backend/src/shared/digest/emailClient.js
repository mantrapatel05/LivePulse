class DigestSendError extends Error {
  constructor(status = 0) {
    super("digest send failed");
    this.name = "DigestSendError";
    this.status = status;
  }
}

function isEmailConfigured() {
  return (process.env.EMAIL_PROVIDER || "resend") === "resend"
    && Boolean(process.env.EMAIL_API_KEY && process.env.EMAIL_FROM);
}

async function sendEmail({ to, subject, html, text, unsubscribeUrl, idempotencyKey }) {
  if (!isEmailConfigured()) throw new DigestSendError(0);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.EMAIL_API_KEY}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [to],
        subject,
        html,
        text,
        headers: unsubscribeUrl
          ? { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
          : undefined,
      }),
    });
    if (!response.ok) throw new DigestSendError(response.status);
    return true;
  } catch (error) {
    if (error instanceof DigestSendError) throw error;
    throw new DigestSendError(0);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { sendEmail, isEmailConfigured, DigestSendError };
