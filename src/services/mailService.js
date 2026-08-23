import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === "true",

    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
    }
});

export async function envoyerEmail({
    to,
    subject,
    html,
    text
}) {
    if (!to || (Array.isArray(to) && to.length === 0)) {
        throw new Error("Destinataire manquant");
    }

    if (!subject) {
        throw new Error("Sujet manquant");
    }

    if (!html && !text) {
        throw new Error("Contenu de l'e-mail manquant");
    }

    const info = await transporter.sendMail({
        from: process.env.MAIL_FROM,
        to,
        subject,
        text,
        html,
        encoding: "UTF-8"
    });

    console.log("E-mail envoyé :", info.messageId);

    return {
        messageId: info.messageId
    };
}