import nodemailer from 'nodemailer';

const host = process.env.SMTP_HOST!;
const port = Number(process.env.SMTP_PORT);

export const mailer = nodemailer.createTransport({
  host,
  port,
  // 465 is implicit TLS; 587 and Mailhog's 1025 start plaintext.
  secure: port === 465,
  // Mailhog offers no AUTH — sending credentials to it fails the connection.
  ...(process.env.SMTP_USER
    ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }
    : {}),
});

export const MAIL_FROM = process.env.MAIL_FROM ?? 'Gate <tickets@gate.test>';
