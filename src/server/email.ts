import "server-only";

/**
 * Optional outgoing email (invites and self-service password resets).
 * Disabled unless SMTP_HOST and SMTP_FROM are configured; the app is fully
 * usable without it — administrators copy invite/reset links instead.
 */
export function emailEnabled(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

export async function sendEmail(message: { to: string; subject: string; text: string }): Promise<boolean> {
  if (!emailEnabled()) return false;
  const nodemailer = await import("nodemailer");
  const port = Number(process.env.SMTP_PORT ?? 587);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } : undefined,
  });
  try {
    await transport.sendMail({ from: process.env.SMTP_FROM, to: message.to, subject: message.subject, text: message.text });
    return true;
  } catch (err) {
    console.error("[email] send failed:", err instanceof Error ? err.message : err);
    return false;
  }
}
