
const nodemailer = require("nodemailer");

const gmailUser = process.env.GMAIL_USER;
const gmailPassword = process.env.GMAIL_APP_PASSWORD;

const transporteur = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: gmailUser,
    pass: gmailPassword
  }
});

/**
 * Envoie un mail à la boîte Gmail surveillée par l'iPhone.
 *
 * Objet : SMS_PATIENT
 * Corps : numero/-/contenu
 */
async function envoyerMailSMSPatient(numero, contenu) {
  if (!gmailUser || !gmailPassword) {
    throw new Error("Configuration Gmail manquante.");
  }

  const telephone = String(numero || "").trim();
  const message = String(contenu || "").trim();

  if (!/^\+?[0-9 ()-]{8,20}$/.test(telephone)) {
    throw new Error("Numéro de téléphone invalide.");
  }

  if (!message) {
    throw new Error("Le contenu du SMS est obligatoire.");
  }

  await transporteur.sendMail({
    from: gmailUser,
    to: gmailUser,
    subject: "SMS_PATIENT",
    text: `${telephone}/-/${message}`,
    disableFileAccess: true,
    disableUrlAccess: true
  });

  return {
    success: true,
    destinataire: telephone
  };
}

module.exports = {
  envoyerMailSMSPatient
};
