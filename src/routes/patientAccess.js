import express from "express";
import crypto from "crypto";

import { adminDb } from "../firebaseAdmin.js";
import { verifierFirebaseToken } from "../middleware/authFirebase.js";
import { verifierMedecin } from "../middleware/verifierMedecin.js";

const router = express.Router();
function genererSession() {
    return crypto.randomBytes(32).toString("hex");
}

// ======================================================
// CRÉER UN ACCÈS PATIENT
// ======================================================

router.post(
    "/create",
    verifierFirebaseToken,
    verifierMedecin,
    async (req, res) => {
    try {
const pages = req.medecin.pages || {};

if (!pages.creerAccesPatient) {

    return res.status(403).json({
        success: false,
        error: "Vous n'avez pas l'autorisation de créer un accès patient"
    });

}
        const {
            patientId,
            hospitalisationId
        } = req.body;


        // ==================================================
        // VALIDATION
        // ==================================================

        if (!patientId || typeof patientId !== "string") {
            return res.status(400).json({
                success: false,
                error: "patientId manquant"
            });
        }

        if (!hospitalisationId || typeof hospitalisationId !== "string") {
            return res.status(400).json({
                success: false,
                error: "hospitalisationId manquant"
            });
        }


        // ==================================================
        // RÉCUPÉRER LE PATIENT
        // ==================================================

        const patientRef = adminDb
            .collection("patients")
            .doc(patientId);

        const patientSnap = await patientRef.get();

        if (!patientSnap.exists) {
            return res.status(404).json({
                success: false,
                error: "Patient introuvable"
            });
        }

        const patient = patientSnap.data();

// ==================================================
// VÉRIFIER QUE L'HOSPITALISATION APPARTIENT AU PATIENT
// ==================================================

const hospitalisationsPatient = Array.isArray(patient.hospitalisations)
    ? patient.hospitalisations
    : [];

if (!hospitalisationsPatient.includes(hospitalisationId)) {
    return res.status(403).json({
        success: false,
        error: "Cette hospitalisation n'appartient pas à ce patient"
    });
}
if (patient.hospitalisationActiveId !== hospitalisationId) {
    return res.status(403).json({
        success: false,
        error: "Cette hospitalisation n'est pas l'hospitalisation active du patient"
    });

}
        // ==================================================
        // RÉCUPÉRER LES DOCUMENTS
        // ==================================================

        const documentsSnap = await adminDb
            .collection("documents")
            .where(
                "ord.hospitalisationId",
                "==",
                hospitalisationId
            )
            .get();

        if (documentsSnap.empty) {
            return res.status(404).json({
                success: false,
                error: "Aucun document trouvé pour cette hospitalisation"
            });
        }


        // ==================================================
        // RÉCUPÉRER L'EMAIL
        // ==================================================

        const email = patient.email;

        if (!email || typeof email !== "string") {
            return res.status(400).json({
                success: false,
                error: "Aucune adresse email valide pour ce patient"
            });
        }


        // ==================================================
        // GÉNÉRATION DU TOKEN
        // ==================================================

        const token = crypto.randomBytes(32).toString("hex");

        const tokenHash = crypto
            .createHash("sha256")
            .update(token)
            .digest("hex");


        // ==================================================
        // EXPIRATION : 7 JOURS
        // ==================================================

        const maintenant = new Date();

        const dateExpiration = new Date(
            maintenant.getTime() +
            7 * 24 * 60 * 60 * 1000
        );


        // ==================================================
        // CRÉER L'ACCÈS
        // ==================================================

        const accessRef = adminDb
            .collection("accesPatients")
            .doc();

        await accessRef.set({

            patientId,

            hospitalisationId,

            tokenHash,

            email,

            dateCreation: maintenant,

            dateExpiration,

            actif: true,

            dateDerniereConnexion: null,

            documentsIds: documentsSnap.docs.map(doc => doc.id)

        });


        // ==================================================
        // RÉPONSE
        // ==================================================

        res.json({

            success: true,

            accessId: accessRef.id,

            // TEMPORAIRE :
            // sera supprimé lorsque l'envoi du mail sera branché
            token,

            dateExpiration: dateExpiration.toISOString(),

            nombreDocuments: documentsSnap.size

        });

    } catch (error) {

        console.error(
            "Erreur création accès patient :",
            error
        );

        res.status(500).json({
            success: false,
            error: "Impossible de créer l'accès patient"
        });

    }

});
// ======================================================
// VÉRIFIER UN TOKEN PATIENT
// ======================================================

router.post("/verify", async (req, res) => {

    try {

        const { token } = req.body;

        // ================================================
        // VALIDATION DU TOKEN
        // ================================================

        if (!token || typeof token !== "string") {

            return res.status(400).json({
                success: false,
                error: "Token manquant"
            });

        }


        // ================================================
        // HASH DU TOKEN
        // ================================================

        const tokenHash = crypto
            .createHash("sha256")
            .update(token)
            .digest("hex");


        // ================================================
        // RECHERCHE DE L'ACCÈS
        // ================================================

        const snapshot = await adminDb
            .collection("accesPatients")
            .where("tokenHash", "==", tokenHash)
            .limit(1)
            .get();


        if (snapshot.empty) {

            return res.status(401).json({
                success: false,
                error: "Lien invalide ou expiré"
            });

        }


        const accessDoc = snapshot.docs[0];
        const access = accessDoc.data();


        // ================================================
        // VÉRIFIER QUE L'ACCÈS EST ACTIF
        // ================================================

        if (access.actif !== true) {

            return res.status(401).json({
                success: false,
                error: "Cet accès a été désactivé"
            });

        }


        // ================================================
        // VÉRIFIER L'EXPIRATION
        // ================================================

        const maintenant = new Date();

        const dateExpiration = access.dateExpiration?.toDate
            ? access.dateExpiration.toDate()
            : new Date(access.dateExpiration);


        if (
            !dateExpiration ||
            dateExpiration.getTime() <= maintenant.getTime()
        ) {

            return res.status(401).json({
                success: false,
                error: "Ce lien a expiré"
            });

        }


        // ================================================
        // RÉCUPÉRER LE PATIENT
        // ================================================

        const patientSnap = await adminDb
            .collection("patients")
            .doc(access.patientId)
            .get();


        if (!patientSnap.exists) {

            return res.status(404).json({
                success: false,
                error: "Patient introuvable"
            });

        }


        const patient = patientSnap.data();


        // ================================================
        // SUCCÈS
        // ================================================

        return res.json({

            success: true,

            accessId: accessDoc.id,

            patientId: access.patientId,

            hospitalisationId: access.hospitalisationId,

            patient: {
                nom: patient.nom || "",
                prenom: patient.prenom || ""
            }

        });


    } catch (error) {

        console.error(
            "Erreur vérification accès patient :",
            error
        );

        return res.status(500).json({
            success: false,
            error: "Impossible de vérifier le lien"
        });

    }

});
// ======================================================
// AUTHENTIFIER LE PATIENT AVEC SA DATE DE NAISSANCE
// ======================================================

router.post("/authenticate", async (req, res) => {

    try {

        const {
            token,
            dateNaissance
        } = req.body;

        // ================================================
        // VALIDATION
        // ================================================

        if (!token || typeof token !== "string") {
            return res.status(400).json({
                success: false,
                error: "Token manquant"
            });
        }

        if (!dateNaissance || typeof dateNaissance !== "string") {
            return res.status(400).json({
                success: false,
                error: "Date de naissance manquante"
            });
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateNaissance)) {
            return res.status(400).json({
                success: false,
                error: "Format de date invalide"
            });
        }

        // ================================================
        // HASH DU TOKEN
        // ================================================

        const tokenHash = crypto
            .createHash("sha256")
            .update(token)
            .digest("hex");

        // ================================================
        // RECHERCHE DE L'ACCÈS
        // ================================================

        const snapshot = await adminDb
            .collection("accesPatients")
            .where("tokenHash", "==", tokenHash)
            .limit(1)
            .get();

        if (snapshot.empty) {
            return res.status(401).json({
                success: false,
                error: "Lien invalide ou expiré"
            });
        }

        const accessDoc = snapshot.docs[0];
        const access = accessDoc.data();

        // ================================================
        // VÉRIFIER L'ACCÈS
        // ================================================

        if (access.actif !== true) {
            return res.status(401).json({
                success: false,
                error: "Cet accès a été désactivé"
            });
        }

        const maintenant = new Date();

        const dateExpiration = access.dateExpiration?.toDate
            ? access.dateExpiration.toDate()
            : new Date(access.dateExpiration);

        if (
            !dateExpiration ||
            dateExpiration.getTime() <= maintenant.getTime()
        ) {
            return res.status(401).json({
                success: false,
                error: "Ce lien a expiré"
            });
        }

        // ================================================
        // RÉCUPÉRER LE PATIENT
        // ================================================

        const patientSnap = await adminDb
            .collection("patients")
            .doc(access.patientId)
            .get();

        if (!patientSnap.exists) {
            return res.status(404).json({
                success: false,
                error: "Patient introuvable"
            });
        }

        const patient = patientSnap.data();

        // ================================================
        // VÉRIFIER LA DATE DE NAISSANCE
        // ================================================

        if (patient.dateNaissance !== dateNaissance) {
            return res.status(401).json({
                success: false,
                error: "Date de naissance incorrecte"
            });
        }

        // ================================================
        // CRÉER LA SESSION
        // ================================================

        const sessionToken = genererSession();

        const sessionHash = crypto
            .createHash("sha256")
            .update(sessionToken)
            .digest("hex");

        const dateExpirationSession = new Date(
            Date.now() + 2 * 60 * 60 * 1000
        );

        const sessionRef = adminDb
            .collection("sessionsPatients")
            .doc();

        await sessionRef.set({

            sessionHash,

            accessId: accessDoc.id,

            patientId: access.patientId,

            hospitalisationId: access.hospitalisationId,

            dateCreation: new Date(),

            dateExpiration: dateExpirationSession,

            actif: true

        });

        // ================================================
        // COOKIE HTTPONLY
        // ================================================

       res.cookie(
    "gesturg_patient_session",
    sessionToken,
    {
        httpOnly: true,

        secure: process.env.NODE_ENV === "production",

        sameSite: process.env.NODE_ENV === "production"
            ? "none"
            : "lax",

        maxAge: 2 * 60 * 60 * 1000,

        path: "/"
    }
);

        // ================================================
        // SUCCÈS
        // ================================================

        return res.json({

            success: true,

            accessId: accessDoc.id,

            patientId: access.patientId,

            hospitalisationId: access.hospitalisationId,

            patient: {
                nom: patient.nom || "",
                prenom: patient.prenom || ""
            }

        });

    } catch (error) {

        console.error(
            "Erreur authentification patient :",
            error
        );

        return res.status(500).json({
            success: false,
            error: "Impossible d'authentifier le patient"
        });

    }

});
// ======================================================
// VÉRIFIER LA SESSION PATIENT
// ======================================================

router.get("/session", async (req, res) => {

    try {

        const sessionToken =
            req.cookies?.gesturg_patient_session;

        if (!sessionToken) {

            return res.status(401).json({
                success: false,
                error: "Aucune session patient"
            });

        }

        // Hash du cookie
        const sessionHash = crypto
            .createHash("sha256")
            .update(sessionToken)
            .digest("hex");

        // Recherche de la session
        const snapshot = await adminDb
            .collection("sessionsPatients")
            .where("sessionHash", "==", sessionHash)
            .limit(1)
            .get();

        if (snapshot.empty) {

            return res.status(401).json({
                success: false,
                error: "Session invalide"
            });

        }

        const sessionDoc = snapshot.docs[0];
        const session = sessionDoc.data();

        // Session désactivée
        if (session.actif !== true) {

            return res.status(401).json({
                success: false,
                error: "Session désactivée"
            });

        }

        // Vérifier expiration
        const dateExpiration = session.dateExpiration?.toDate
            ? session.dateExpiration.toDate()
            : new Date(session.dateExpiration);

        if (
            !dateExpiration ||
            dateExpiration.getTime() <= Date.now()
        ) {

            return res.status(401).json({
                success: false,
                error: "Session expirée"
            });

        }

        // Récupérer le patient
        const patientSnap = await adminDb
            .collection("patients")
            .doc(session.patientId)
            .get();

        if (!patientSnap.exists) {

            return res.status(404).json({
                success: false,
                error: "Patient introuvable"
            });

        }

        const patient = patientSnap.data();

        // ==============================================
        // SESSION VALIDE
        // ==============================================

        return res.json({

            success: true,

            accessId: session.accessId,

            patientId: session.patientId,

            hospitalisationId: session.hospitalisationId,

            patient: {
                nom: patient.nom || "",
                prenom: patient.prenom || ""
            }

        });

    } catch (error) {

        console.error(
            "Erreur vérification session patient :",
            error
        );

        return res.status(500).json({
            success: false,
            error: "Impossible de vérifier la session"
        });

    }

});

export default router;