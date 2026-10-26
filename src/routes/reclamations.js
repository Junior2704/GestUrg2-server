import express from "express";
import crypto from "node:crypto";
import { adminDb } from "../firebaseAdmin.js";
import { verifierFirebaseToken } from "../middleware/authFirebase.js";
import { verifierMedecin } from "../middleware/verifierMedecin.js";

const router = express.Router();

const COLLECTION = "reclamations";
const SESSIONS = "sessionsReclamations";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

const STATUTS = new Set([
  "nouvelle",
  "en_analyse",
  "en_attente",
  "en_cours",
  "cloturee",
  "refusee"
]);

const PRIORITES = new Set(["normale", "haute", "urgente"]);
const CATEGORIES = new Set([
  "Accueil et orientation",
  "Délais d’attente",
  "Information et communication",
  "Prise en charge et soins",
  "Respect et comportement",
  "Organisation et locaux",
  "Facturation / administratif",
  "Autre"
]);

function texte(value, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function genererCodeSuivi() {
  // Code lisible à saisir par le patient ; il ne sera pas stocké en clair.
  return crypto.randomBytes(6).toString("base64url").toUpperCase().slice(0, 10);
}

function genererReference() {
  const annee = new Date().getFullYear();
  return `REC-${annee}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function erreur(res, status, message) {
  return res.status(status).json({ success: false, message });
}

function verifierDroitReclamations(req, res, next) {
  if (req.medecin?.pages?.reclamations !== true) {
    return erreur(res, 403, "Vous ne disposez pas du droit de gestion des réclamations.");
  }
  next();
}

function dossierPublic(d) {
  // Ne jamais exposer les hashes, les notes internes ou les données d'authentification.
  return {
    id: d.id,
    reference: d.reference,
    civilite: d.civilite || "",
    nom: d.nom || "",
    prenom: d.prenom || "",
    email: d.email || "",
    telephone: d.telephone || "",
    lien: d.lien || "",
    etablissement: d.etablissement || "",
    dateFaits: d.dateFaits || "",
    categorie: d.categorie || "Autre",
    objet: d.objet || "",
    description: d.description || "",
    attente: d.attente || "",
    statut: d.statut || "nouvelle",
    priorite: d.priorite || "normale",
    assigneA: d.assigneA || "",
    dateCreation: d.dateCreation || "",
    dateModification: d.dateModification || "",
    historique: Array.isArray(d.historique) ? d.historique : []
  };
}

function dossierAdmin(d, id) {
  return {
    ...dossierPublic({ ...d, id }),
    noteInterne: d.noteInterne || "",
    messages: Array.isArray(d.messages) ? d.messages : []
  };
}

async function lireSessionPatient(req) {
  const authorization = req.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) return null;

  const token = authorization.slice(7).trim();
  if (!token || token.length > 500) return null;

  const sessionId = hash(token);
  const snap = await adminDb.collection(SESSIONS).doc(sessionId).get();
  if (!snap.exists) return null;

  const session = snap.data();
  if (!session.expiresAt || new Date(session.expiresAt).getTime() <= Date.now()) {
    await snap.ref.delete().catch(() => {});
    return null;
  }

  const reclamationSnap = await adminDb.collection(COLLECTION).doc(session.reclamationId).get();
  if (!reclamationSnap.exists) return null;

  return {
    reclamationSnap,
    reclamation: reclamationSnap.data(),
    sessionId
  };
}

function verifierChampsDemande(body) {
  const nom = texte(body.nom, 100);
  const prenom = texte(body.prenom, 100);
  const email = texte(body.email, 254).toLowerCase();
  const etablissement = texte(body.etablissement, 180);
  const categorie = texte(body.categorie, 100);
  const objet = texte(body.objet, 180);
  const description = texte(body.description, 10000);

  if (!nom || !prenom || !email || !etablissement || !categorie || !objet || description.length < 20) {
    return "Veuillez renseigner tous les champs obligatoires et une description d’au moins 20 caractères.";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "L’adresse e-mail semble invalide.";
  }
  if (!CATEGORIES.has(categorie)) {
    return "La catégorie sélectionnée n’est pas valide.";
  }
  if (body.exactitude !== true && body.exactitude !== "true" && body.exactitude !== "on") {
    return "La confirmation des informations est obligatoire.";
  }
  return null;
}

// ======================================================
// PATIENT : déposer une réclamation (route publique)
// POST /api/reclamations
// ======================================================
router.post("/", async (req, res) => {
  try {
    const validation = verifierChampsDemande(req.body || {});
    if (validation) return erreur(res, 400, validation);

    const body = req.body;
    const now = new Date().toISOString();
    let reference;
    let refSnap;

    // Évite les collisions de référence, même si elles sont extrêmement improbables.
    do {
      reference = genererReference();
      refSnap = await adminDb.collection(COLLECTION).where("reference", "==", reference).limit(1).get();
    } while (!refSnap.empty);

    const codeSuivi = genererCodeSuivi();
    const codeSalt = crypto.randomBytes(16).toString("hex");
    const codeHash = crypto.scryptSync(codeSuivi, codeSalt, 64).toString("hex");

    const dossier = {
      reference,
      civilite: texte(body.civilite, 20),
      nom: texte(body.nom, 100),
      prenom: texte(body.prenom, 100),
      email: texte(body.email, 254).toLowerCase(),
      telephone: texte(body.telephone, 30),
      lien: texte(body.lien, 40),
      etablissement: texte(body.etablissement, 180),
      dateFaits: texte(body.dateFaits, 20),
      categorie: texte(body.categorie, 100),
      objet: texte(body.objet, 180),
      description: texte(body.description, 10000),
      attente: texte(body.attente, 3000),
      statut: "nouvelle",
      priorite: "normale",
      assigneA: "",
      noteInterne: "",
      codeSalt,
      codeHash,
      dateCreation: now,
      dateModification: now,
      historique: [{
        date: now,
        titre: "Réclamation reçue",
        statut: "nouvelle",
        description: "La réclamation a été transmise à l’établissement."
      }],
      messages: []
    };

    const docRef = adminDb.collection(COLLECTION).doc();
    await docRef.set(dossier);

    return res.status(201).json({
      success: true,
      reference,
      codeSuivi,
      message: "Votre réclamation a été enregistrée. Conservez votre référence et votre code de suivi."
    });
  } catch (error) {
    console.error("Erreur création réclamation :", error);
    return erreur(res, 500, "Impossible d’enregistrer la réclamation pour le moment.");
  }
});

// ======================================================
// PATIENT : authentification par référence + code
// POST /api/reclamations/patient/authenticate
// ======================================================
router.post("/patient/authenticate", async (req, res) => {
  try {
    const reference = texte(req.body?.reference, 40).toUpperCase();
    const code = texte(req.body?.code, 100);

    if (!reference || !code) return erreur(res, 400, "Référence et code de suivi obligatoires.");

    const snap = await adminDb.collection(COLLECTION)
      .where("reference", "==", reference)
      .limit(1)
      .get();

    if (snap.empty) return erreur(res, 401, "Référence ou code de suivi incorrect.");

    const reclamationSnap = snap.docs[0];
    const d = reclamationSnap.data();
    const calcul = crypto.scryptSync(code, d.codeSalt || "", 64);
    const attendu = Buffer.from(d.codeHash || "", "hex");

    if (attendu.length !== calcul.length || !crypto.timingSafeEqual(attendu, calcul)) {
      return erreur(res, 401, "Référence ou code de suivi incorrect.");
    }

    const sessionToken = crypto.randomBytes(32).toString("base64url");
    const sessionId = hash(sessionToken);
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

    await adminDb.collection(SESSIONS).doc(sessionId).set({
      reclamationId: reclamationSnap.id,
      expiresAt,
      dateCreation: new Date().toISOString()
    });

    const reclamation = dossierPublic({ ...d, id: reclamationSnap.id });
    const messages = (Array.isArray(d.messages) ? d.messages : []).map(m => ({
      auteurType: m.auteurType || "établissement",
      auteurLibelle: m.auteurLibelle || (m.auteurType === "patient" ? "Vous" : "Établissement"),
      contenu: m.contenu || "",
      date: m.date || ""
    }));

    return res.json({ success: true, sessionToken, reclamation, messages });
  } catch (error) {
    console.error("Erreur authentification suivi réclamation :", error);
    return erreur(res, 500, "Impossible d’ouvrir le dossier pour le moment.");
  }
});

// ======================================================
// PATIENT : envoyer un message
// POST /api/reclamations/patient/message
// ======================================================
router.post("/patient/message", async (req, res) => {
  try {
    const session = await lireSessionPatient(req);
    if (!session) return erreur(res, 401, "Session de suivi invalide ou expirée. Veuillez vous reconnecter.");

    const contenu = texte(req.body?.message, 5000);
    if (contenu.length < 2) return erreur(res, 400, "Le message doit contenir au moins 2 caractères.");

    const now = new Date().toISOString();
    const d = session.reclamation;
    const messages = Array.isArray(d.messages) ? d.messages : [];
    messages.push({
      auteurType: "patient",
      auteurLibelle: "Vous",
      contenu,
      date: now
    });

    const historique = Array.isArray(d.historique) ? d.historique : [];
    historique.push({
      date: now,
      titre: "Nouveau message du demandeur",
      description: "Le demandeur a ajouté un message au dossier."
    });

    await session.reclamationSnap.ref.update({
      messages,
      historique,
      dateModification: now
    });

    const updated = { ...d, messages, historique, dateModification: now };
    return res.json({
      success: true,
      reclamation: dossierPublic({ ...updated, id: session.reclamationSnap.id }),
      messages: messages.map(m => ({
        auteurType: m.auteurType || "établissement",
        auteurLibelle: m.auteurLibelle || (m.auteurType === "patient" ? "Vous" : "Établissement"),
        contenu: m.contenu || "",
        date: m.date || ""
      }))
    });
  } catch (error) {
    console.error("Erreur message patient réclamation :", error);
    return erreur(res, 500, "Impossible d’envoyer le message pour le moment.");
  }
});

// ======================================================
// PROFESSIONNELS : liste des réclamations
// GET /api/reclamations
// Auth Firebase + medecin + pages.reclamations
// ======================================================
router.get("/", verifierFirebaseToken, verifierMedecin, verifierDroitReclamations, async (req, res) => {
  try {
    const snap = await adminDb.collection(COLLECTION).orderBy("dateCreation", "desc").limit(300).get();
    let items = snap.docs.map(docSnap => dossierAdmin(docSnap.data(), docSnap.id));

    const q = texte(req.query.q, 200).toLowerCase();
    const statut = texte(req.query.statut, 50).toLowerCase();
    const categorie = texte(req.query.categorie, 100);

    if (q) {
      items = items.filter(d => [
        d.reference, d.nom, d.prenom, d.email, d.objet, d.description, d.etablissement
      ].some(v => String(v || "").toLowerCase().includes(q)));
    }
    if (statut) items = items.filter(d => d.statut === statut);
    if (categorie) items = items.filter(d => d.categorie === categorie);

    return res.json({ success: true, reclamations: items });
  } catch (error) {
    console.error("Erreur liste réclamations :", error);
    return erreur(res, 500, "Impossible de charger les réclamations.");
  }
});

// ======================================================
// PROFESSIONNELS : modifier une réclamation
// PATCH /api/reclamations/:id
// Auth Firebase + medecin + pages.reclamations
// ======================================================
router.patch("/:id", verifierFirebaseToken, verifierMedecin, verifierDroitReclamations, async (req, res) => {
  try {
    const id = texte(req.params.id, 150);
    if (!id) return erreur(res, 400, "Identifiant de réclamation manquant.");

    const ref = adminDb.collection(COLLECTION).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return erreur(res, 404, "Réclamation introuvable.");

    const body = req.body || {};
    const statut = texte(body.statut, 50);
    const priorite = texte(body.priorite, 30);
    const assigneA = texte(body.assigneA, 180);
    const categorie = texte(body.categorie, 100);
    const noteInterne = texte(body.noteInterne, 5000);
    const reponseUsager = texte(body.reponseUsager, 5000);

    if (!STATUTS.has(statut)) return erreur(res, 400, "Statut non valide.");
    if (!PRIORITES.has(priorite)) return erreur(res, 400, "Priorité non valide.");
    if (!CATEGORIES.has(categorie)) return erreur(res, 400, "Catégorie non valide.");

    const before = snap.data();
    const now = new Date().toISOString();
    const historique = Array.isArray(before.historique) ? before.historique : [];
    const changementStatut = before.statut !== statut;
    const changements = [];

    if (changementStatut) changements.push(`Statut modifié : ${before.statut || "nouvelle"} → ${statut}.`);
    if ((before.priorite || "normale") !== priorite) changements.push(`Priorité modifiée : ${priorite}.`);
    if ((before.assigneA || "") !== assigneA) changements.push(assigneA ? `Dossier attribué à : ${assigneA}.` : "Attribution du dossier retirée.");

    if (changements.length) {
      historique.push({
        date: now,
        titre: "Dossier mis à jour",
        statut,
        description: changements.join(" ")
      });
    }

    const messages = Array.isArray(before.messages) ? before.messages : [];
    if (reponseUsager) {
      messages.push({
        auteurType: "professionnel",
        auteurLibelle: "Établissement",
        contenu: reponseUsager,
        date: now
      });
      historique.push({
        date: now,
        titre: "Réponse de l’établissement",
        description: "L’établissement a envoyé un message au demandeur."
      });
    }

    await ref.update({
      statut,
      priorite,
      assigneA,
      categorie,
      noteInterne,
      historique,
      messages,
      dateModification: now,
      derniereModificationPar: req.firebaseUser.uid
    });

    const updatedSnap = await ref.get();
    return res.json({
      success: true,
      reclamation: dossierAdmin(updatedSnap.data(), updatedSnap.id)
    });
  } catch (error) {
    console.error("Erreur modification réclamation :", error);
    return erreur(res, 500, "Impossible d’enregistrer les modifications.");
  }
});

export default router;
