import nodemailer from "nodemailer";
import { env } from "./env";

/**
 * Email delivery for verification and password reset. Dev/test point SMTP_URL at
 * the local Mailpit catcher (infra compose, port 55125).
 *
 * Review L10: a production process without SMTP silently wrote valid
 * verification/reset tokens to stdout. Production now fails the send loudly
 * (checked at send time, not import time, so `next build` does not need SMTP),
 * and the dev fallback logs only recipient + subject — never the token URL.
 */
// Short timeouts: nodemailer's 2-minute default left sign-up spinning when the host
// blocked the SMTP port (Render free blocks 25/465/587; Brevo also listens on 2525).
const transport = env.SMTP_URL
  ? nodemailer.createTransport({
      url: env.SMTP_URL,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    })
  : null;

type MailKey = "verifyEmail" | "resetPassword";

const SUBJECTS: Record<"ar" | "en", Record<MailKey, string>> = {
  ar: {
    verifyEmail: "تأكيد بريدك الإلكتروني — DeepCode Studio",
    resetPassword: "إعادة تعيين كلمة المرور — DeepCode Studio",
  },
  en: {
    verifyEmail: "Verify your email — DeepCode Studio",
    resetPassword: "Reset your password — DeepCode Studio",
  },
};

const BODIES: Record<"ar" | "en", Record<MailKey, string>> = {
  ar: {
    verifyEmail:
      "أهلاً بك في DeepCode Studio.\nلتأكيد بريدك الإلكتروني، افتح الرابط التالي:\n{url}\n\nإذا لم تطلب هذا الحساب يمكنك تجاهل الرسالة.",
    resetPassword:
      "طلب إعادة تعيين كلمة المرور لحسابك.\nالرابط صالح لفترة قصيرة:\n{url}\n\nإذا لم تطلب ذلك، تجاهل الرسالة.",
  },
  en: {
    verifyEmail:
      "Welcome to DeepCode Studio.\nTo verify your email address, open this link:\n{url}\n\nIf you did not create an account, you can ignore this message.",
    resetPassword:
      "A password reset was requested for your account.\nThis link expires shortly:\n{url}\n\nIf you did not request this, ignore this message.",
  },
};

export async function sendMail(input: {
  to: string;
  locale: "ar" | "en";
  subjectKey: MailKey;
  bodyKey: MailKey;
  url: string;
}): Promise<void> {
  const subject = SUBJECTS[input.locale][input.subjectKey];
  const text = BODIES[input.locale][input.bodyKey].replace("{url}", input.url);
  if (!transport) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SMTP_URL is required in production (verification and reset email cannot be delivered)");
    }
    // Dev fallback: never print the token URL (it grants account access).
    console.info(`[mail:dev] to=${input.to} subject=${subject} (body withheld; set SMTP_URL or use Mailpit)`);
    return;
  }
  await transport.sendMail({ from: env.MAIL_FROM, to: input.to, subject, text });
}
