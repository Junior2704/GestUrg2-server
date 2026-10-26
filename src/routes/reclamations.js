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

function normaliserRecherche(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9@+]/g, "");
}
function afficherDatePatient(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value?.toDate) return value.toDate().toISOString().slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}
function patientPublic(snap) {
  const p = snap.data() || {};
  return {
    id: snap.id,
    nom: texte(p.nom || p.Nom, 100),
    prenom: texte(p.prenom || p.Prénom || p.Prenom, 100),
    email: texte(p.email || p.mail, 254).toLowerCase(),
    telephone: texte(p.telephone || p.tel || p.phone || p.numeroTelephone, 40),
    dateNaissance: afficherDatePatient(p.dateNaissance || p.naissance),
    sexe: texte(p.sexe || p.Sexe, 20)
  };
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
    patientId: d.patientId || null,
    patientNom: d.patientNom || "",
    patientPrenom: d.patientPrenom || "",
    patientDateNaissance: d.patientDateNaissance || "",
    patientEmail: d.patientEmail || "",
    patientTelephone: d.patientTelephone || "",
    patientAssociationConfirmee: d.patientAssociationConfirmee === true,
    noteInterne: d.noteInterne || "",
    echeance: d.echeance || null,
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
// PROFESSIONNELS : suggestions de patients à partir d'une réclamation
// GET /api/reclamations/patients/suggestions
// Les informations retournées sont limitées à l'identité nécessaire à la vérification.
// ======================================================
router.get("/patients/suggestions", verifierFirebaseToken, verifierMedecin, verifierDroitReclamations, async (req, res) => {
  try {
    const criteria = {
      nom: normaliserRecherche(texte(req.query.nom, 100)),
      prenom: normaliserRecherche(texte(req.query.prenom, 100)),
      email: normaliserRecherche(texte(req.query.email, 254)),
      telephone: normaliserRecherche(texte(req.query.telephone, 40)),
      q: normaliserRecherche(texte(req.query.q, 200))
    };
    if (!Object.values(criteria).some(Boolean)) return res.json({ success: true, patients: [] });

    // Le système n'associe jamais un patient automatiquement : il ne fait que suggérer.
    const snap = await adminDb.collection("patients").get();
    const results = [];
    for (const docSnap of snap.docs) {
      const p = patientPublic(docSnap);
      const nom = normaliserRecherche(p.nom);
      const prenom = normaliserRecherche(p.prenom);
      const email = normaliserRecherche(p.email);
      const telephone = normaliserRecherche(p.telephone);
      let score = 0;
      const reasons = [];

      if (criteria.email && email && criteria.email === email) { score += 100; reasons.push("e-mail exact"); }
      if (criteria.telephone && telephone && criteria.telephone === telephone) { score += 95; reasons.push("téléphone exact"); }
      if (criteria.nom && nom && criteria.nom === nom) { score += 35; reasons.push("nom exact"); }
      else if (criteria.nom && nom && (nom.includes(criteria.nom) || criteria.nom.includes(nom))) { score += 18; reasons.push("nom proche"); }
      if (criteria.prenom && prenom && criteria.prenom === prenom) { score += 35; reasons.push("prénom exact"); }
      else if (criteria.prenom && prenom && (prenom.includes(criteria.prenom) || criteria.prenom.includes(prenom))) { score += 18; reasons.push("prénom proche"); }
      if (criteria.q) {
        const q = criteria.q;
        if ([nom, prenom, email, telephone, normaliserRecherche(`${p.prenom} ${p.nom}`)].some(v => v && v.includes(q))) {
          score += 20; reasons.push("recherche manuelle");
        }
      }
      if (score > 0) results.push({ ...p, score: Math.min(99, score), raison: reasons.join(" · "), niveau: score >= 90 ? "Forte" : score >= 50 ? "À vérifier" : "Faible" });
    }
    results.sort((a, b) => b.score - a.score || a.nom.localeCompare(b.nom, "fr"));
    return res.json({ success: true, patients: results.slice(0, 20) });
  } catch (error) {
    console.error("Erreur suggestions patients :", error);
    return erreur(res, 500, "Impossible de rechercher les patients.");
  }
});

// ======================================================
// PROFESSIONNELS : documents liés au patient
// Ne renvoie jamais pdfBase64 ni le contenu des documents.
// ======================================================
router.get("/patients/:patientId/documents", verifierFirebaseToken, verifierMedecin, verifierDroitReclamations, async (req, res) => {
  try {
    const patientId = texte(req.params.patientId, 150);
    if (!patientId) return erreur(res, 400, "Identifiant patient manquant.");
    const patientSnap = await adminDb.collection("patients").doc(patientId).get();
    if (!patientSnap.exists) return erreur(res, 404, "Patient introuvable.");
    const snap = await adminDb.collection("documents").where("patientId", "==", patientId).limit(200).get();
    const reclamationId = texte(req.query.reclamationId, 150);
    const sharesSnap = await adminDb.collection("accesPatients").where("patientId", "==", patientId).get();
    const shares = sharesSnap.docs.map(d => ({id:d.id, ...(d.data() || {})})).filter(a => a.type === "reclamation_document" && a.reclamationId === reclamationId);
    const documents = snap.docs.map(d => {
      const data = d.data() || {};
      const share = shares.filter(a => a.documentId === d.id).sort((a,b) => new Date(b.dateCreation || 0) - new Date(a.dateCreation || 0))[0];
      return { id: d.id, type: texte(data.type || data.nom, 180) || "Document", dateCreation: data.dateCreation || null, mime: texte(data.mime, 100), hospitalisationId: texte(data.hospitalisationId, 150), partage: share ? {id:share.id, actif:share.actif === true, dateExpiration:share.dateExpiration || null} : null };
    }).sort((a, b) => String(b.dateCreation || "").localeCompare(String(a.dateCreation || "")));
    return res.json({ success: true, documents });
  } catch (error) {
    console.error("Erreur documents patient réclamation :", error);
    return erreur(res, 500, "Impossible de charger les documents du patient.");
  }
});


/**
 * PARTAGER UN DOCUMENT DANS LE CHAT SÉCURISÉ DE LA RÉCLAMATION
 *
 * POST /api/reclamations/:id/documents/:documentId/share
 *
 * Aucun e-mail n'est envoyé.
 * Le lien temporaire est publié dans les messages de la réclamation.
 */
router.post(
  "/:id/documents/:documentId/share",
  verifierFirebaseToken,
  verifierMedecin,
  verifierDroitReclamations,
  async (req, res) => {
    let accessRef = null;

    try {
      const reclamationId = texte(req.params.id, 150);
      const documentId = texte(req.params.documentId, 150);

      if (!reclamationId || !documentId) {
        return erreur(res, 400, "Réclamation ou document manquant.");
      }

      // 1. Vérifier la réclamation
      const reclamationSnap = await adminDb
        .collection(COLLECTION)
        .doc(reclamationId)
        .get();

      if (!reclamationSnap.exists) {
        return erreur(res, 404, "Réclamation introuvable.");
      }

      const reclamation = reclamationSnap.data() || {};

      if (
        !reclamation.patientId ||
        reclamation.patientAssociationConfirmee !== true
      ) {
        return erreur(
          res,
          409,
          "Associez et confirmez le patient avant de partager un document."
        );
      }

      // 2. Vérifier le patient
      const patientSnap = await adminDb
        .collection("patients")
        .doc(reclamation.patientId)
        .get();

      if (!patientSnap.exists) {
        return erreur(res, 404, "Patient introuvable.");
      }

      const patient = patientSnap.data() || {};

      // 3. Vérifier le document
      const documentSnap = await adminDb
        .collection("documents")
        .doc(documentId)
        .get();

      if (!documentSnap.exists) {
        return erreur(res, 404, "Document introuvable.");
      }

      const document = documentSnap.data() || {};

      const hospitalisationId =
        texte(
          document.hospitalisationId ||
          document.ord?.hospitalisationId,
          150
        ) || null;

      const appartientAuPatient =
        document.patientId === reclamation.patientId ||
        (
          !document.patientId &&
          hospitalisationId &&
          (
            (
              Array.isArray(patient.hospitalisations) &&
              patient.hospitalisations.includes(hospitalisationId)
            ) ||
            patient.hospitalisationActiveId === hospitalisationId
          )
        );

      if (!appartientAuPatient) {
        return erreur(
          res,
          403,
          "Ce document n'est pas rattaché au patient associé à la réclamation."
        );
      }

      // 4. Créer un lien temporaire aléatoire
      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = hash(token);

      const now = new Date();
      const dateExpiration = new Date(
        now.getTime() + SESSION_DURATION_MS
      );

      const nomDocument =
        texte(document.type || document.titre || document.nom, 180) ||
        "Document";

      const nomProfessionnel =
        texte(
          req.medecin?.prenom && req.medecin?.nom
            ? `${req.medecin.prenom} ${req.medecin.nom}`
            : req.medecin?.nom,
          150
        ) || "Établissement";

      // 5. Enregistrer les droits d'accès au document
      accessRef = adminDb.collection("accesPatients").doc();

      await accessRef.set({
        patientId: reclamation.patientId,
        hospitalisationId,
        tokenHash,

        // Conservé à titre informatif ; aucun e-mail n'est envoyé.
        email: texte(
          patient.email ||
          patient.mail ||
          reclamation.patientEmail ||
          reclamation.email,
          254
        ).toLowerCase(),

        dateCreation: now,
        dateExpiration,
        actif: true,
        dateDerniereConnexion: null,

        documentsIds: [documentId],
        type: "reclamation_document",
        reclamationId,
        documentId,

        creePar: req.firebaseUser?.uid || null
      });

      // 6. Construire le lien du portail patient
      const portalUrl =
        "https://junior2704.github.io/GestUrg2/portail-patient/patient-login.html";

      const lien =
        `${portalUrl}?token=${encodeURIComponent(token)}`;

      const expirationFr = dateExpiration.toLocaleDateString(
        "fr-FR",
        {
          day: "2-digit",
          month: "2-digit",
          year: "numeric"
        }
      );

      // 7. Publier le lien dans le chat de la réclamation
      const messages = Array.isArray(reclamation.messages)
        ? [...reclamation.messages]
        : [];

      const messageChat = {
        auteurType: "professionnel",
        auteurLibelle: nomProfessionnel,
        contenu:
          `Un document vous a été partagé : ${nomDocument}\n\n` +
          `Accéder au document sécurisé : ${lien}\n\n` +
          `Ce lien expire le ${expirationFr}. ` +
          `Il donne accès uniquement au document partagé.`,
        date: now.toISOString(),

        // Métadonnées utiles à l'interface d'administration
        type: "document_partage",
        documentId,
        accessId: accessRef.id,
        dateExpiration: dateExpiration.toISOString()
      };

      messages.push(messageChat);

      const historique = Array.isArray(reclamation.historique)
        ? [...reclamation.historique]
        : [];

      historique.push({
        date: now.toISOString(),
        titre: "Document partagé dans le chat",
        description:
          `Le document « ${nomDocument} » a été partagé ` +
          `dans la messagerie sécurisée de la réclamation. ` +
          `Expiration du lien : ${expirationFr}.`
      });

      await reclamationSnap.ref.update({
        messages,
        historique,
        dateModification: now.toISOString()
      });

      return res.json({
        success: true,
        message: "Le lien du document a été ajouté au chat sécurisé.",
        accessId: accessRef.id,
        dateExpiration: dateExpiration.toISOString(),
        document: {
          id: documentId,
          nom: nomDocument
        },
        messageChat
      });

    } catch (error) {
      console.error(
        "Erreur partage document dans le chat sécurisé :",
        error
      );

      // Ne pas supprimer le droit d'accès si le message a déjà été
      // enregistré : cela évite de laisser un lien dans le chat qui
      // ne fonctionnerait plus à cause d'une erreur de réponse.
      if (accessRef) {
        try {
          const accessSnap = await accessRef.get();

          if (accessSnap.exists) {
            await accessRef.update({
              actif: false,
              dateRevocation: new Date(),
              motifRevocation: "Erreur pendant le partage dans le chat"
            });
          }
        } catch (revokeError) {
          console.error(
            "Erreur révocation du partage incomplet :",
            revokeError
          );
        }
      }

      return erreur(
        res,
        500,
        "Impossible de partager le document dans le chat sécurisé."
      );
    }
  }
);

// Révoquer un lien de partage existant si son accessId est connu.
router.delete("/:id/document-shares/:accessId", verifierFirebaseToken, verifierMedecin, verifierDroitReclamations, async (req, res) => {
  try {
    const reclamationId = texte(req.params.id, 150);
    const accessId = texte(req.params.accessId, 150);
    const snap = await adminDb.collection("accesPatients").doc(accessId).get();
    if (!snap.exists) return erreur(res, 404, "Lien de partage introuvable.");
    const access = snap.data() || {};
    if (access.type !== "reclamation_document" || access.reclamationId !== reclamationId) return erreur(res, 403, "Ce lien ne correspond pas à cette réclamation.");
    await snap.ref.update({actif:false, dateRevocation:new Date(), revoquePar:req.firebaseUser?.uid || null});
    return res.json({success:true});
  } catch (error) {
    console.error("Erreur révocation lien document :", error);
    return erreur(res, 500, "Impossible de révoquer le lien.");
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
    const echeance = body.echeance == null ? null : texte(body.echeance, 10);
    const reponseUsager = texte(body.reponseUsager, 5000);
    const patientIdPresent = Object.prototype.hasOwnProperty.call(body, "patientId");
    const patientId = patientIdPresent && body.patientId != null ? texte(body.patientId, 150) : null;

    if (!STATUTS.has(statut)) return erreur(res, 400, "Statut non valide.");
    if (!PRIORITES.has(priorite)) return erreur(res, 400, "Priorité non valide.");
    if (!CATEGORIES.has(categorie)) return erreur(res, 400, "Catégorie non valide.");
    if (echeance && !/^\d{4}-\d{2}-\d{2}$/.test(echeance)) return erreur(res, 400, "Format d’échéance non valide.");

    const before = snap.data();
    let patientAssocie = null;
    if (patientIdPresent && patientId) {
      const patientSnap = await adminDb.collection("patients").doc(patientId).get();
      if (!patientSnap.exists) return erreur(res, 400, "Le patient sélectionné n’existe plus.");
      patientAssocie = patientPublic(patientSnap);
    }
    const now = new Date().toISOString();
    const historique = Array.isArray(before.historique) ? before.historique : [];
    const changementStatut = before.statut !== statut;
    const changements = [];

    if (changementStatut) changements.push(`Statut modifié : ${before.statut || "nouvelle"} → ${statut}.`);
    if ((before.priorite || "normale") !== priorite) changements.push(`Priorité modifiée : ${priorite}.`);
    if ((before.assigneA || "") !== assigneA) changements.push(assigneA ? `Dossier attribué à : ${assigneA}.` : "Attribution du dossier retirée.");
    if ((before.echeance || null) !== echeance) changements.push(echeance ? `Échéance de traitement fixée au ${echeance}.` : "Échéance de traitement retirée.");
    if (patientIdPresent && (before.patientId || null) !== patientId) {
      changements.push(patientId ? `Patient associé confirmé : ${[patientAssocie?.prenom, patientAssocie?.nom].filter(Boolean).join(" ") || patientId} (ID ${patientId}).` : "Association avec le patient retirée.");
    }

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

    const updateData = {
      statut,
      priorite,
      assigneA,
      categorie,
      noteInterne,
      echeance,
      historique,
      messages,
      dateModification: now,
      derniereModificationPar: req.firebaseUser.uid
    };
    if (patientIdPresent) {
      updateData.patientId = patientId || null;
      updateData.patientAssociationConfirmee = Boolean(patientId && patientAssocie);
      updateData.patientNom = patientAssocie?.nom || "";
      updateData.patientPrenom = patientAssocie?.prenom || "";
      updateData.patientDateNaissance = patientAssocie?.dateNaissance || "";
      updateData.patientEmail = patientAssocie?.email || "";
      updateData.patientTelephone = patientAssocie?.telephone || "";
    }
    await ref.update(updateData);

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
