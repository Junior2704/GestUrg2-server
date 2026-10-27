// routes/reclamationsMail.js — import des réclamations depuis Gmail (API Gmail + OAuth2)
// Variables Render : GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
// Optionnelle : SUIVI_URL (page de suivi patient)
import express from "express";
import crypto from "node:crypto";
import { google } from "googleapis";
import { simpleParser } from "mailparser";
import { adminDb } from "../firebaseAdmin.js";
import { verifierFirebaseToken } from "../middleware/authFirebase.js";
import { verifierMedecin } from "../middleware/verifierMedecin.js";
import { envoyerEmail } from "../services/mailService.js";

const router = express.Router();
const COLLECTION = "reclamations";
const SESSIONS = "sessionsReclamations";
const SUIVI_URL = process.env.SUIVI_URL || "https://junior2704.github.io/GestUrg2/suivi-demande.html";
const PRIORITES = new Set(["normale", "haute", "urgente"]);
const LIENS = new Set(["patient", "proche", "autre"]);
const CATEGORIES = new Set([
  "Accueil et orientation", "Délais d’attente", "Information et communication", "Prise en charge et soins",
  "Respect et comportement", "Organisation et locaux", "Facturation / administratif", "Autre"
]);

const texte = (v, max = 5000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const erreur = (res, status, message) => res.status(status).json({ success: false, message });
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function verifierDroit(req, res, next) {
  if (req.medecin?.pages?.reclamations !== true)
    return erreur(res, 403, "Vous ne disposez pas du droit de gestion des réclamations.");
  next();
}
const staff = [verifierFirebaseToken, verifierMedecin, verifierDroit];

function gmail() {
  const auth = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: "v1", auth });
}
const gmailError = e => /invalid_grant/.test(String(e?.message))
  ? "Autorisation Gmail expirée ou révoquée : régénérez le jeton (GMAIL_REFRESH_TOKEN)."
  : "Boîte mail inaccessible : " + e.message;

// ---------- Espace de suivi : code + e-mail d'accès ----------
// Même format que le dépôt public d'une réclamation (routes/reclamations.js)
const genererCodeSuivi = () => crypto.randomBytes(6).toString("base64url").toUpperCase().slice(0, 10);

function hasherCode(code) {
  const codeSalt = crypto.randomBytes(16).toString("hex");
  const codeHash = crypto.scryptSync(code, codeSalt, 64).toString("hex");
  return { codeSalt, codeHash };
}

async function envoyerAccesEspace({ email, prenom, nom, reference, codeSuivi }) {
  const appel = [prenom, nom].filter(Boolean).join(" ") || "Madame, Monsieur";

  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#F6FBFA;font-family:'Segoe UI',Roboto,Arial,sans-serif;color:#12312D;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F6FBFA;padding:35px 15px;"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E2EEEC;border-radius:22px;overflow:hidden;">
<tr><td align="center" style="background-color:#0B544E;padding:28px 25px;">
  <h1 style="margin:0;color:#FFFFFF;font-size:24px;font-weight:600;">GestUrg2</h1>
  <p style="margin:8px 0 0;color:#D9EFEC;font-size:14px;">Suivi de votre réclamation</p>
</td></tr>
<tr><td style="padding:32px;">
  <p style="margin:0 0 16px;font-size:16px;line-height:1.7;">Bonjour <strong>${esc(appel)}</strong>,</p>
  <p style="margin:0 0 18px;color:#4C6B66;font-size:15px;line-height:1.7;">
    Nous avons bien reçu votre message et l’avons enregistré comme une réclamation.
    Un espace sécurisé a été créé pour suivre son avancement et échanger avec le service.
  </p>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;"><tr>
    <td style="background-color:#F3F9F8;border:1px solid #E2EEEC;border-radius:15px;padding:18px;">
      <p style="margin:0 0 6px;color:#6A8580;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Référence</p>
      <p style="margin:0 0 14px;font-size:18px;font-weight:700;color:#0B544E;">${esc(reference)}</p>
      <p style="margin:0 0 6px;color:#6A8580;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Code de suivi</p>
      <p style="margin:0;font-size:20px;font-weight:700;letter-spacing:.08em;color:#12312D;font-family:Consolas,monospace;">${esc(codeSuivi)}</p>
    </td></tr></table>
  <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
    <a href="${esc(SUIVI_URL)}" style="display:inline-block;background-color:#0F766E;color:#FFFFFF;text-decoration:none;padding:15px 28px;border-radius:14px;font-size:14px;font-weight:700;">Accéder à mon espace de suivi →</a>
  </td></tr></table>
  <p style="margin:24px 0 0;color:#4C6B66;font-size:13px;line-height:1.6;">
    🔒 Conservez ces identifiants : ils vous permettent de consulter votre dossier et d’échanger avec le service.
    Ne les communiquez à personne.
  </p>
  <p style="margin:18px 0 0;text-align:center;color:#8AA19D;font-size:11px;line-height:1.7;">
    Service des Urgences — Cet e-mail a été généré automatiquement, merci de ne pas y répondre.
  </p>
</td></tr></table></td></tr></table></body></html>`;

  const text =
`Bonjour ${appel},

Nous avons bien reçu votre message et l'avons enregistré comme une réclamation.
Un espace sécurisé a été créé pour suivre son avancement et échanger avec le service.

Référence : ${reference}
Code de suivi : ${codeSuivi}

Accéder à votre espace de suivi : ${SUIVI_URL}

Conservez ces identifiants et ne les communiquez à personne.

Service des Urgences
Cet e-mail a été généré automatiquement, merci de ne pas y répondre.`;

  return envoyerEmail({
    to: email,
    subject: `Votre réclamation ${reference} — accès à votre espace de suivi`,
    html, text
  });
}

// GET /api/reclamations/mailbox : e-mails non lus de la boîte générique
router.get("/mailbox", ...staff, async (req, res) => {
  try {
    if (!process.env.GMAIL_REFRESH_TOKEN) return erreur(res, 503, "Boîte mail non configurée sur le serveur.");
    const g = gmail();
    const limit = Math.min(Number(req.query.limit) || 30, 30);
    const list = await g.users.messages.list({ userId: "me", q: "in:inbox is:unread", maxResults: limit });
    const mails = await Promise.all((list.data.messages || []).map(async ({ id }) => {
      const m = await g.users.messages.get({ userId: "me", id, format: "raw" });
      const p = await simpleParser(Buffer.from(m.data.raw, "base64url"));
      const dup = p.messageId
        ? !(await adminDb.collection(COLLECTION).where("mailMessageId", "==", p.messageId).limit(1).get()).empty
        : false;
      return {
        id, messageId: p.messageId || "", alreadyImported: dup,
        fromName: p.from?.value?.[0]?.name || "", fromEmail: p.from?.value?.[0]?.address || "",
        subject: p.subject || "", date: p.date ? p.date.toISOString() : null,
        body: (p.text || "").trim().slice(0, 10000)
      };
    }));
    res.json({ success: true, mails });
  } catch (e) {
    console.error("Erreur lecture boîte Gmail :", e);
    erreur(res, 502, gmailError(e));
  }
});

// POST /api/reclamations/import-mail : crée une réclamation + espace de suivi à partir d'un e-mail
router.post("/import-mail", ...staff, async (req, res) => {
  try {
    const b = req.body || {};
    const nom = texte(b.nom, 100), prenom = texte(b.prenom, 100), email = texte(b.email, 254).toLowerCase();
    const objet = texte(b.objet, 180), description = texte(b.description, 10000);
    const categorie = CATEGORIES.has(b.categorie) ? b.categorie : "Autre";
    const priorite = PRIORITES.has(b.priorite) ? b.priorite : "normale";
    const lien = LIENS.has(b.lien) ? b.lien : "patient";
    if (!nom || !objet || description.length < 5) return erreur(res, 400, "Nom, objet et contenu du mail sont obligatoires.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return erreur(res, 400, "L’adresse e-mail semble invalide.");

    const mailMessageId = texte(b.mailMessageId, 300);
    if (mailMessageId) {
      const d = await adminDb.collection(COLLECTION).where("mailMessageId", "==", mailMessageId).limit(1).get();
      if (!d.empty) return erreur(res, 409, "Cet e-mail a déjà été importé.");
    }
    let mailDate = "";
    try { if (b.mailDate) mailDate = new Date(b.mailDate).toISOString(); } catch (_) {}

    let reference, s;
    do {
      reference = `REC-${new Date().getFullYear()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      s = await adminDb.collection(COLLECTION).where("reference", "==", reference).limit(1).get();
    } while (!s.empty);

    const codeSuivi = genererCodeSuivi();
    const { codeSalt, codeHash } = hasherCode(codeSuivi);

    const now = new Date().toISOString();
    const ref = adminDb.collection(COLLECTION).doc();
    await ref.set({
      reference, civilite: "", nom, prenom, email, telephone: texte(b.telephone, 30), lien,
      etablissement: "", dateFaits: "", categorie, objet, description, attente: "",
      statut: "nouvelle", priorite, assigneA: "", noteInterne: "",
      source: "email", canal: "espace", reponseParEmail: false,   // chat sécurisé activé
      codeSalt, codeHash, accesEnvoyeLe: null,
      mailMessageId, mailFrom: texte(b.mailFrom, 300), mailSubject: texte(b.mailSubject, 300), mailDate,
      dateCreation: now, dateModification: now, creePar: req.firebaseUser?.uid || null,
      historique: [
        { date: now, titre: "Réclamation reçue par e-mail", statut: "nouvelle",
          description: `Dossier créé à partir d’un e-mail (${req.firebaseUser?.email || "professionnel"}).` },
        { date: now, titre: "Espace de suivi sécurisé créé",
          description: "Un espace de suivi a été ouvert pour le demandeur." }
      ],
      messages: []
    });

    // Envoi des identifiants (non bloquant : le dossier reste créé en cas d'échec)
    let emailEnvoye = false;
    try {
      await envoyerAccesEspace({ email, prenom, nom, reference, codeSuivi });
      emailEnvoye = true;
      await ref.update({
        accesEnvoyeLe: new Date().toISOString(),
        historique: [
          { date: now, titre: "Réclamation reçue par e-mail", statut: "nouvelle",
            description: `Dossier créé à partir d’un e-mail (${req.firebaseUser?.email || "professionnel"}).` },
          { date: now, titre: "Espace de suivi sécurisé créé",
            description: "Un espace de suivi a été ouvert pour le demandeur." },
          { date: new Date().toISOString(), titre: "Identifiants envoyés",
            description: `Référence et code de suivi envoyés par e-mail à ${email}.` }
        ]
      });
    } catch (e) {
      console.error("Erreur envoi des identifiants :", e);
    }

    if (texte(b.mailId, 100)) {                          // marque le mail comme lu (non bloquant)
      try { await gmail().users.messages.modify({ userId: "me", id: texte(b.mailId, 100), requestBody: { removeLabelIds: ["UNREAD"] } }); }
      catch (e) { console.warn("Mail non marqué comme lu :", e.message); }
    }
    res.status(201).json({ success: true, id: ref.id, reference, emailEnvoye });
  } catch (e) {
    console.error("Erreur import e-mail :", e);
    erreur(res, 500, "Impossible de créer la réclamation depuis l’e-mail.");
  }
});

// POST /api/reclamations/:id/renvoyer-acces : nouveau code + renvoi par e-mail
// (sert aussi à convertir un ancien dossier "réponse par e-mail" en dossier avec espace de suivi)
router.post("/:id/renvoyer-acces", ...staff, async (req, res) => {
  try {
    const id = texte(req.params.id, 150);
    if (!id) return erreur(res, 400, "Identifiant manquant.");
    const ref = adminDb.collection(COLLECTION).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return erreur(res, 404, "Réclamation introuvable.");
    const d = snap.data();
    if (!d.email) return erreur(res, 400, "Aucune adresse e-mail pour ce dossier.");

    const codeSuivi = genererCodeSuivi();
    const { codeSalt, codeHash } = hasherCode(codeSuivi);

    // 1. Envoi d'abord : si l'e-mail échoue, rien n'est modifié (l'ancien code reste valable)
    try {
      await envoyerAccesEspace({ email: d.email, prenom: d.prenom, nom: d.nom, reference: d.reference, codeSuivi });
    } catch (e) {
      console.error("Erreur renvoi des identifiants :", e);
      return erreur(res, 502, "L’e-mail n’a pas pu être envoyé. Réessayez dans un instant.");
    }

    // 2. Invalider les sessions ouvertes avec l'ancien code
    const sessions = await adminDb.collection(SESSIONS).where("reclamationId", "==", id).get();
    if (!sessions.empty) {
      const batch = adminDb.batch();
      sessions.docs.forEach(s => batch.delete(s.ref));
      await batch.commit();
    }

    // 3. Enregistrer le nouveau code
    const now = new Date().toISOString();
    const historique = Array.isArray(d.historique) ? d.historique : [];
    const etaitAncienMode = d.canal === "email";
    historique.push({
      date: now,
      titre: etaitAncienMode ? "Espace de suivi créé" : "Identifiants renvoyés",
      description: `Nouveau code de suivi envoyé par e-mail à ${d.email} (${req.firebaseUser?.email || "professionnel"}).`
    });
    await ref.update({
      codeSalt, codeHash, historique,
      accesEnvoyeLe: now, dateModification: now,
      ...(etaitAncienMode ? { canal: "espace", reponseParEmail: false, source: d.source || "email" } : {})
    });

    res.json({ success: true, message: `Identifiants envoyés à ${d.email}.` });
  } catch (e) {
    console.error("Erreur renvoi accès :", e);
    erreur(res, 500, "Impossible de renvoyer les identifiants.");
  }
});

export default router;