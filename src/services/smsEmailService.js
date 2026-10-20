
import nodemailer from "nodemailer";

const gmailUser = process.env.GMAIL_USER;
const gmailPassword = process.env.GMAIL_APP_PASSWORD;

import dns from "node:dns";

// Privilégie IPv4 lorsque Node.js résout les adresses réseau.
dns.setDefaultResultOrder("ipv4first");

const transporteur = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    family: 4,
    auth: {
        user: gmailUser,
        pass: gmailPassword
    }
});

/**
 * Envoie un e-mail à la boîte Gmail surveillée par l'iPhone.
 *
 * Objet : SMS_PATIENT
 * Corps : numero/-/contenu
 *
 * Exemple :
 * 0612345678/-/Bonjour, votre rendez-vous est confirmé.
 */
async function envoyerMailSMSPatient(numero, contenu) {

    // Vérification de la configuration Gmail
    if (!gmailUser || !gmailPassword) {
        throw new Error(
            "Configuration Gmail manquante : GMAIL_USER ou GMAIL_APP_PASSWORD."
        );
    }

    const telephone = String(numero || "").trim();
    const message = String(contenu || "").trim();

    // Vérification du numéro
    if (!/^\+?[0-9 ()-]{8,20}$/.test(telephone)) {
        throw new Error("Numéro de téléphone invalide.");
    }

    // Vérification du contenu
    if (!message) {
        throw new Error("Le contenu du SMS est obligatoire.");
    }

    if (/[\r\n]/.test(message)) {
        throw new Error(
            "Le contenu du SMS ne doit pas contenir de retour à la ligne."
        );
    }

    // Envoi du mail à la même adresse Gmail
    const resultat = await transporteur.sendMail({
        from: gmailUser,
        to: gmailUser,
        subject: "SMS_PATIENT",
        text: `${telephone}/-/${message}`,
        disableFileAccess: true,
        disableUrlAccess: true
    });

    console.log(
        "[SMS_EMAIL] E-mail envoyé à Gmail. Message ID :",
        resultat.messageId
    );

    return {
        success: true,
        messageId: resultat.messageId
    };
}


export { envoyerMailSMSPatient };