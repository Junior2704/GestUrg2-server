
import nodemailer from "nodemailer";
import dns from "node:dns/promises";

const gmailUser = process.env.GMAIL_USER;
const gmailPassword = process.env.GMAIL_APP_PASSWORD;

async function envoyerMailSMSPatient(numero, contenu) {
    if (!gmailUser || !gmailPassword) {
        throw new Error("Configuration Gmail manquante.");
    }

    const telephone = String(numero || "").trim();
    const message = String(contenu || "").trim();

    if (!/^\+?[0-9 ()-]{8,20}$/.test(telephone)) {
        throw new Error("Numéro de téléphone invalide.");
    }

    if (!message || /[\r\n]/.test(message)) {
        throw new Error("Contenu SMS invalide.");
    }

    // Résolution IPv4 explicite de Gmail
    const adresse = await dns.lookup("smtp.gmail.com", {
        family: 4
    });

    console.log(
        "[SMS_EMAIL] Connexion SMTP IPv4 :",
        adresse.address
    );

    const transporteur = nodemailer.createTransport({
        host: adresse.address,
        port: 465,
        secure: true,

        auth: {
            user: gmailUser,
            pass: gmailPassword
        },

        // Conserve le nom Gmail pour TLS malgré l'IP utilisée
        tls: {
            servername: "smtp.gmail.com"
        },

        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 20000
    });

    try {
        const resultat = await transporteur.sendMail({
            from: gmailUser,
            to: gmailUser,
            subject: "SMS_PATIENT",
            text: `${telephone}/-/${message}`,
            disableFileAccess: true,
            disableUrlAccess: true
        });

        console.log(
            "[SMS_EMAIL] Mail accepté :",
            resultat.messageId
        );

        return {
            success: true,
            messageId: resultat.messageId
        };
    } finally {
        transporteur.close();
    }
}

export { envoyerMailSMSPatient };
