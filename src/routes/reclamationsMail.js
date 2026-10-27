// routes/reclamationsMail.js — import des réclamations depuis Gmail (API Gmail + OAuth2)
// Variables Render : GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
// Dépendances : npm install googleapis mailparser
import express from "express";
import crypto from "node:crypto";
import { google } from "googleapis";
import { simpleParser } from "mailparser";
import { adminDb } from "../firebaseAdmin.js";
import { verifierFirebaseToken } from "../middleware/authFirebase.js";
import { verifierMedecin } from "../middleware/verifierMedecin.js";

const router = express.Router();
const COLLECTION = "reclamations";
const PRIORITES = new Set(["normale", "haute", "urgente"]);
const LIENS = new Set(["patient", "proche", "autre"]);
const CATEGORIES = new Set([
  "Accueil et orientation", "Délais d’attente", "Information et communication", "Prise en charge et soins",
  "Respect et comportement", "Organisation et locaux", "Facturation / administratif", "Autre"
]);

const texte = (v, max = 5000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const erreur = (res, status, message) => res.status(status).json({ success: false, message });

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

// POST /api/reclamations/import-mail : crée une réclamation à partir d'un e-mail
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

    const now = new Date().toISOString();
    const ref = adminDb.collection(COLLECTION).doc();
    await ref.set({
      reference, civilite: "", nom, prenom, email, telephone: texte(b.telephone, 30), lien,
      etablissement: "", dateFaits: "", categorie, objet, description, attente: "",
      statut: "nouvelle", priorite, assigneA: "", noteInterne: "",
      canal: "email", reponseParEmail: true,            // => aucune réponse via le chat
      mailMessageId, mailFrom: texte(b.mailFrom, 300), mailSubject: texte(b.mailSubject, 300), mailDate,
      dateCreation: now, dateModification: now, creePar: req.firebaseUser?.uid || null,
      historique: [{ date: now, titre: "Réclamation reçue par e-mail", statut: "nouvelle",
        description: `Dossier créé à partir d’un e-mail (${req.firebaseUser?.email || "professionnel"}).` }],
      messages: []
    });

    if (texte(b.mailId, 100)) {                          // marque le mail comme lu (non bloquant)
      try { await gmail().users.messages.modify({ userId: "me", id: texte(b.mailId, 100), requestBody: { removeLabelIds: ["UNREAD"] } }); }
      catch (e) { console.warn("Mail non marqué comme lu :", e.message); }
    }
    res.status(201).json({ success: true, id: ref.id, reference });
  } catch (e) {
    console.error("Erreur import e-mail :", e);
    erreur(res, 500, "Impossible de créer la réclamation depuis l’e-mail.");
  }
});

export default router;