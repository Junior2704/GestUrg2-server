import express from "express";
import crypto from "crypto";

import { adminDb } from "../firebaseAdmin.js";
import { verifierFirebaseToken } from "../middleware/authFirebase.js";
import { verifierMedecin } from "../middleware/verifierMedecin.js";
import { verifierSessionPatient } from "../middleware/verifierSessionPatient.js";

const router = express.Router();


// ======================================================
// GÉNÉRER UNE SESSION
// ======================================================

function genererSession() {
    return crypto.randomBytes(32).toString("hex");
}


// ======================================================
// HASHER UN TOKEN
// ======================================================

function hashToken(token) {
    return crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");
}


// ======================================================
// RÉCUPÉRER UNE DATE FIRESTORE
// ======================================================

function convertirDate(date) {

    if (!date) {
        return null;
    }

    if (date.toDate) {
        return date.toDate();
    }

    return new Date(date);
}


// ======================================================
// RÉCUPÉRER LA SESSION PATIENT
// ======================================================

async function recupererSessionPatient(req) {

    const sessionToken =
        req.cookies?.gesturg_patient_session;

    if (!sessionToken) {
        return null;
    }

    const sessionHash = hashToken(sessionToken);

    const snapshot = await adminDb
        .collection("sessionsPatients")
        .where("sessionHash", "==", sessionHash)
        .limit(1)
        .get();

    if (snapshot.empty) {
        return null;
    }

    const sessionDoc = snapshot.docs[0];

    const session = {
        id: sessionDoc.id,
        ...sessionDoc.data()
    };

    // Session désactivée
    if (session.actif !== true) {
        return null;
    }

    // Vérifier expiration
    const dateExpiration =
        convertirDate(session.dateExpiration);

    if (
        !dateExpiration ||
        dateExpiration.getTime() <= Date.now()
    ) {
        return null;
    }

    return session;
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
                    error:
                        "Vous n'avez pas l'autorisation de créer un accès patient"
                });

            }

            const {
                patientId,
                hospitalisationId
            } = req.body;


            // ==================================================
            // VALIDATION
            // ==================================================

            if (
                !patientId ||
                typeof patientId !== "string"
            ) {

                return res.status(400).json({
                    success: false,
                    error: "patientId manquant"
                });

            }

            if (
                !hospitalisationId ||
                typeof hospitalisationId !== "string"
            ) {

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

            const patientSnap =
                await patientRef.get();

            if (!patientSnap.exists) {

                return res.status(404).json({
                    success: false,
                    error: "Patient introuvable"
                });

            }

            const patient = patientSnap.data();


            // ==================================================
            // VÉRIFIER L'HOSPITALISATION
            // ==================================================

            const hospitalisationsPatient =
                Array.isArray(patient.hospitalisations)
                    ? patient.hospitalisations
                    : [];


            if (
                !hospitalisationsPatient
                    .includes(hospitalisationId)
            ) {

                return res.status(403).json({
                    success: false,
                    error:
                        "Cette hospitalisation n'appartient pas à ce patient"
                });

            }


            // ==================================================
            // VÉRIFIER HOSPITALISATION ACTIVE
            // ==================================================

            if (
                patient.hospitalisationActiveId !==
                hospitalisationId
            ) {

                return res.status(403).json({
                    success: false,
                    error:
                        "Cette hospitalisation n'est pas l'hospitalisation active du patient"
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
                    error:
                        "Aucun document trouvé pour cette hospitalisation"
                });

            }


            // ==================================================
            // EMAIL
            // ==================================================

            const email = patient.email;

            if (
                !email ||
                typeof email !== "string"
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Aucune adresse email valide pour ce patient"
                });

            }


            // ==================================================
            // TOKEN D'ACCÈS
            // ==================================================

            const token =
                crypto.randomBytes(32).toString("hex");

            const tokenHash =
                hashToken(token);


            // ==================================================
            // EXPIRATION 7 JOURS
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

                dateCreation:
                    maintenant,

                dateExpiration,

                actif: true,

                dateDerniereConnexion:
                    null,

                documentsIds:
                    documentsSnap.docs.map(
                        doc => doc.id
                    )

            });


            // ==================================================
            // RÉPONSE
            // ==================================================

            return res.json({

                success: true,

                accessId:
                    accessRef.id,

                // TEMPORAIRE
                // jusqu'à branchement de l'email
                token,

                dateExpiration:
                    dateExpiration.toISOString(),

                nombreDocuments:
                    documentsSnap.size

            });

        } catch (error) {

            console.error(
                "Erreur création accès patient :",
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    "Impossible de créer l'accès patient"
            });

        }

    }
);


// ======================================================
// VÉRIFIER LE TOKEN DU LIEN
// ======================================================

router.post(
    "/verify",
    async (req, res) => {

        try {

            const { token } = req.body;


            if (
                !token ||
                typeof token !== "string"
            ) {

                return res.status(400).json({
                    success: false,
                    error: "Token manquant"
                });

            }


            const tokenHash =
                hashToken(token);


            const snapshot = await adminDb
                .collection("accesPatients")
                .where(
                    "tokenHash",
                    "==",
                    tokenHash
                )
                .limit(1)
                .get();


            if (snapshot.empty) {

                return res.status(401).json({
                    success: false,
                    error:
                        "Lien invalide ou expiré"
                });

            }


            const accessDoc =
                snapshot.docs[0];

            const access =
                accessDoc.data();


            // ==================================================
            // ACCÈS ACTIF
            // ==================================================

            if (access.actif !== true) {

                return res.status(401).json({
                    success: false,
                    error:
                        "Cet accès a été désactivé"
                });

            }


            // ==================================================
            // EXPIRATION
            // ==================================================

            const dateExpiration =
                convertirDate(
                    access.dateExpiration
                );


            if (
                !dateExpiration ||
                dateExpiration.getTime() <=
                    Date.now()
            ) {

                return res.status(401).json({
                    success: false,
                    error:
                        "Ce lien a expiré"
                });

            }


            // ==================================================
            // PATIENT
            // ==================================================

            const patientSnap =
                await adminDb
                    .collection("patients")
                    .doc(access.patientId)
                    .get();


            if (!patientSnap.exists) {

                return res.status(404).json({
                    success: false,
                    error:
                        "Patient introuvable"
                });

            }


            const patient =
                patientSnap.data();


            return res.json({

                success: true,

                accessId:
                    accessDoc.id,

                patientId:
                    access.patientId,

                hospitalisationId:
                    access.hospitalisationId,

                patient: {

                    nom:
                        patient.nom || "",

                    prenom:
                        patient.prenom || ""

                }

            });

        } catch (error) {

            console.error(
                "Erreur vérification accès patient :",
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    "Impossible de vérifier le lien"
            });

        }

    }
);


// ======================================================
// AUTHENTIFIER LE PATIENT
// ======================================================

router.post(
    "/authenticate",
    async (req, res) => {

        try {

            const {
                token,
                dateNaissance
            } = req.body;


            // ==================================================
            // VALIDATION
            // ==================================================

            if (
                !token ||
                typeof token !== "string"
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Token manquant"
                });

            }

            if (
                !dateNaissance ||
                typeof dateNaissance !== "string"
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Date de naissance manquante"
                });

            }


            if (
                !/^\d{4}-\d{2}-\d{2}$/
                    .test(dateNaissance)
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Format de date invalide"
                });

            }


            // ==================================================
            // RECHERCHE ACCÈS
            // ==================================================

            const tokenHash =
                hashToken(token);


            const snapshot = await adminDb
                .collection("accesPatients")
                .where(
                    "tokenHash",
                    "==",
                    tokenHash
                )
                .limit(1)
                .get();


            if (snapshot.empty) {

                return res.status(401).json({
                    success: false,
                    error:
                        "Lien invalide ou expiré"
                });

            }


            const accessDoc =
                snapshot.docs[0];

            const access =
                accessDoc.data();


            // ==================================================
            // VÉRIFICATIONS
            // ==================================================

            if (access.actif !== true) {

                return res.status(401).json({
                    success: false,
                    error:
                        "Cet accès a été désactivé"
                });

            }


            const dateExpiration =
                convertirDate(
                    access.dateExpiration
                );


            if (
                !dateExpiration ||
                dateExpiration.getTime() <=
                    Date.now()
            ) {

                return res.status(401).json({
                    success: false,
                    error:
                        "Ce lien a expiré"
                });

            }


            // ==================================================
            // PATIENT
            // ==================================================

            const patientSnap =
                await adminDb
                    .collection("patients")
                    .doc(access.patientId)
                    .get();


            if (!patientSnap.exists) {

                return res.status(404).json({
                    success: false,
                    error:
                        "Patient introuvable"
                });

            }


            const patient =
                patientSnap.data();


            // ==================================================
            // DATE DE NAISSANCE
            // ==================================================

            if (
                patient.dateNaissance !==
                dateNaissance
            ) {

                return res.status(401).json({
                    success: false,
                    error:
                        "Date de naissance incorrecte"
                });

            }


            // ==================================================
            // CRÉER SESSION
            // ==================================================

            const sessionToken =
                genererSession();


            const sessionHash =
                hashToken(sessionToken);


            const dateExpirationSession =
                new Date(
                    Date.now() +
                    2 * 60 * 60 * 1000
                );


            const sessionRef =
                adminDb
                    .collection("sessionsPatients")
                    .doc();


            await sessionRef.set({

                sessionHash,

                accessId:
                    accessDoc.id,

                patientId:
                    access.patientId,

                hospitalisationId:
                    access.hospitalisationId,

                dateCreation:
                    new Date(),

                dateExpiration:
                    dateExpirationSession,

                actif: true

            });


            // ==================================================
            // METTRE À JOUR DERNIÈRE CONNEXION
            // ==================================================

            await accessDoc.ref.update({

                dateDerniereConnexion:
                    new Date()

            });


            // ==================================================
            // COOKIE HTTPONLY
            // ==================================================

           res.cookie(
    "gesturg_patient_session",
    sessionToken,
    {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        maxAge: 2 * 60 * 60 * 1000,
        path: "/"
    }
);


            // ==================================================
            // RÉPONSE
            // ==================================================

            return res.json({

                success: true,

                accessId:
                    accessDoc.id,

                patientId:
                    access.patientId,

                hospitalisationId:
                    access.hospitalisationId,

                patient: {

                    nom:
                        patient.nom || "",

                    prenom:
                        patient.prenom || ""

                }

            });

        } catch (error) {

            console.error(
                "Erreur authentification patient :",
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    "Impossible d'authentifier le patient"
            });

        }

    }
);


// ======================================================
// VÉRIFIER LA SESSION PATIENT
// ======================================================

router.get(
    "/session",
    async (req, res) => {

        try {

            const session =
                await recupererSessionPatient(req);


            if (!session) {

                return res.status(401).json({
                    success: false,
                    error:
                        "Aucune session patient"
                });

            }


            // ==================================================
            // PATIENT
            // ==================================================

            const patientSnap =
                await adminDb
                    .collection("patients")
                    .doc(session.patientId)
                    .get();


            if (!patientSnap.exists) {

                return res.status(404).json({
                    success: false,
                    error:
                        "Patient introuvable"
                });

            }


            const patient =
                patientSnap.data();


            return res.json({

                success: true,

                accessId:
                    session.accessId,

                patientId:
                    session.patientId,

                hospitalisationId:
                    session.hospitalisationId,

                patient: {

                    nom:
                        patient.nom || "",

                    prenom:
                        patient.prenom || ""

                }

            });

        } catch (error) {

            console.error(
                "Erreur vérification session patient :",
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    "Impossible de vérifier la session"
            });

        }

    }
);


// ======================================================
// RÉCUPÉRER LES DOCUMENTS DU PATIENT
// ======================================================

router.get(
    "/documents",
    verifierSessionPatient,
    async (req, res) => {

        try {

            const session = req.patientSession;

            const documentsSnap =
                await adminDb
                    .collection("documents")
                    .where(
                        "ord.hospitalisationId",
                        "==",
                        session.hospitalisationId
                    )
                    .get();

            const documents =
                documentsSnap.docs.map(doc => {

                    const data = doc.data();

                    return {
                        id: doc.id,

                        type:
                            data.type || "",

                        titre:
                            data.titre ||
                            data.nom ||
                            data.type ||
                            "Document",

                        dateCreation:
                            data.dateCreation || null
                    };

                });

            return res.json({

                success: true,

                hospitalisationId:
                    session.hospitalisationId,

                documents

            });

        } catch (error) {

            console.error(
                "Erreur récupération documents patient :",
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    "Impossible de récupérer les documents"
            });

        }

    }
);
// ======================================================
// RÉCUPÉRER UN DOCUMENT PRÉCIS
// ======================================================
router.get(
    "/documents/:documentId",
    verifierSessionPatient,
    async (req, res) => {

        try {

            const session =
                req.patientSession;

            const {
                documentId
            } = req.params;
// ======================================================
// DÉCONNEXION PATIENT
// ======================================================

router.post(
    "/logout",
    async (req, res) => {

        try {

            const sessionToken =
                req.cookies?.gesturg_patient_session;


            if (sessionToken) {

                const sessionHash =
                    hashToken(sessionToken);


                const snapshot =
                    await adminDb
                        .collection("sessionsPatients")
                        .where(
                            "sessionHash",
                            "==",
                            sessionHash
                        )
                        .limit(1)
                        .get();


                if (!snapshot.empty) {

                    await snapshot.docs[0]
                        .ref
                        .update({
                            actif: false
                        });

                }

            }


            // Supprimer cookie
            res.clearCookie(
                "gesturg_patient_session",
                {
                    httpOnly: true,
                    secure:
                        process.env.NODE_ENV ===
                        "production",
                    sameSite: "lax",
                    path: "/"
                }
            );


            return res.json({
                success: true
            });

        } catch (error) {

            console.error(
                "Erreur déconnexion patient :",
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    "Impossible de se déconnecter"
            });

        }

    }
);
// ======================================================
// TEST SESSION PATIENT PROTÉGÉE
// ======================================================


router.get(
    "/protected-test",
    verifierSessionPatient,
    async (req, res) => {

        return res.json({

            success: true,

            message: "Session patient valide",

            patientId:
                req.patientSession.patientId,

            hospitalisationId:
                req.patientSession.hospitalisationId,

            accessId:
                req.patientSession.accessId

        });

    }
);

export default router;