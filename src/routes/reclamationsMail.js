// routes/reclamationsMail.js — import des réclamations depuis Gmail (API Gmail + OAuth2)
// Format "import/export" (modules ES), comme le reste de votre serveur.
// Variables Render : GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
// Dépendances : npm install googleapis mailparser
import express from "express";
import { google } from "googleapis";
import { simpleParser } from "mailparser";

export default function reclamationsMail({ db, requireStaff }) {
  const r = express.Router();
  const gmail = () => {
    const auth = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET);
    auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
    return google.gmail({ version: "v1", auth });
  };
  const gmailError = e => /invalid_grant/.test(String(e?.message))
    ? "Autorisation Gmail expirée ou révoquée : régénérez le jeton (GMAIL_REFRESH_TOKEN)."
    : "Boîte mail inaccessible : " + e.message;

  // Liste des e-mails non lus
  r.get("/mailbox", requireStaff, async (req, res) => {
    try {
      const g = gmail(), limit = Math.min(Number(req.query.limit) || 30, 50);
      const list = await g.users.messages.list({ userId: "me", q: "in:inbox is:unread", maxResults: limit });
      const mails = await Promise.all((list.data.messages || []).map(async ({ id }) => {
        const m = await g.users.messages.get({ userId: "me", id, format: "raw" });
        const p = await simpleParser(Buffer.from(m.data.raw, "base64url"));
        const dup = p.messageId
          ? !(await db.collection("reclamations").where("mailMessageId", "==", p.messageId).limit(1).get()).empty
          : false;
        return {
          id, messageId: p.messageId || "", alreadyImported: dup,
          fromName: p.from?.value?.[0]?.name || "", fromEmail: p.from?.value?.[0]?.address || "",
          subject: p.subject || "", date: p.date || null, body: (p.text || "").trim().slice(0, 10000)
        };
      }));
      res.json({ mails });
    } catch (e) { res.status(502).json({ message: gmailError(e) }); }
  });

  // Création d'une réclamation à partir d'un e-mail
  r.post("/import-mail", requireStaff, async (req, res) => {
    const b = req.body || {};
    if (!b.nom || !b.email || !b.objet || !b.description)
      return res.status(400).json({ message: "Nom, e-mail, objet et contenu sont obligatoires." });
    try {
      if (b.mailMessageId) {
        const d = await db.collection("reclamations").where("mailMessageId", "==", b.mailMessageId).limit(1).get();
        if (!d.empty) return res.status(409).json({ message: "Cet e-mail a déjà été importé." });
      }
      const now = new Date();
      const reference = `REC-${now.getFullYear()}-${Math.random().toString(16).slice(2, 6).toUpperCase()}`;
      const doc = {
        reference, statut: "nouvelle", priorite: b.priorite || "normale",
        canal: "email", reponseParEmail: true,           // => aucune réponse via l'espace de suivi
        nom: b.nom, prenom: b.prenom || "", email: b.email, telephone: b.telephone || "", lien: b.lien || "patient",
        categorie: b.categorie || "Autre", objet: b.objet, description: b.description,
        mailMessageId: b.mailMessageId || "", mailFrom: b.mailFrom || "", mailSubject: b.mailSubject || "",
        mailDate: b.mailDate || null, dateCreation: now, messages: [],
        historique: [{ titre: "Demande créée depuis un e-mail", date: now, description: `Importé par ${req.user?.email || "un professionnel"}` }]
      };
      const ref = await db.collection("reclamations").add(doc);
      if (b.mailId) {                                     // marque le mail comme lu (non bloquant)
        try { await gmail().users.messages.modify({ userId: "me", id: String(b.mailId), requestBody: { removeLabelIds: ["UNREAD"] } }); } catch (_) {}
      }
      res.status(201).json({ id: ref.id, reference });
    } catch (e) { res.status(500).json({ message: "Création impossible : " + e.message }); }
  });

  return r;
}


// ⚠ À ajouter aussi dans votre route patient POST /api/reclamations/patient/message :
//   if (rec.canal === "email") return res.status(403).json({ message: "Réponse par e-mail uniquement pour cette demande." });
// ⚠ Et dans le PATCH /api/reclamations/:id : ignorer `reponseUsager` quand rec.canal === "email".