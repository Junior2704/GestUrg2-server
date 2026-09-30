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

    console.log("📧 Préparation envoi e-mail :", {
        to,
        typeTo: typeof to,
        subject
    });

    // ================================
    // NORMALISATION DES DESTINATAIRES
    // ================================

    let destinataires = [];

    if (Array.isArray(to)) {
        destinataires = to
            .flatMap(e => String(e).split("//"))
            .map(e => e.trim())
            .filter(Boolean);

    } else if (typeof to === "string") {
        destinataires = to
            .split("//")
            .map(e => e.trim())
            .filter(Boolean);

    } else if (to) {
        destinataires = [String(to).trim()].filter(Boolean);
    }

    // ================================
    // VÉRIFICATIONS
    // ================================

    if (destinataires.length === 0) {
        throw new Error(
            `Destinataire manquant. Valeur reçue : ${JSON.stringify(to)}`
        );
    }

    if (!subject || !subject.trim()) {
        throw new Error("Sujet manquant");
    }

    if (!html && !text) {
        throw new Error("Contenu de l'e-mail manquant");
    }

    console.log("📧 Destinataires finaux :", destinataires);

    // ================================
    // ENVOI
    // ================================

    const info = await transporter.sendMail({
        from: process.env.MAIL_FROM,
        to: destinataires.join(", "),
        subject: subject.trim(),
        text,
        html,
        encoding: "UTF-8"
    });

    console.log("✅ E-mail envoyé :", info.messageId);

    return {
        messageId: info.messageId
    };
}