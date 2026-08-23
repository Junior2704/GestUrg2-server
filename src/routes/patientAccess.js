import express from "express";
import crypto from "crypto";

import { adminDb } from "../firebaseAdmin.js";
import { verifierFirebaseToken } from "../middleware/authFirebase.js";
import { verifierMedecin } from "../middleware/verifierMedecin.js";
import { verifierSessionPatient } from "../middleware/verifierSessionPatient.js";
import { envoyerEmail } from "../services/mailService.js";

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

           // ==================================================
// LIEN PATIENT
// ==================================================
const PATIENT_URL = "https://junior2704.github.io/GestUrg2/portail-patient/patient-login.html";
const lienPatient =
    `${PATIENT_URL}?token=${encodeURIComponent(token)}`;


// ==================================================
// EMAIL PATIENT
// ==================================================

const nomPatient =
    `${patient.prenom || ""} ${patient.nom || ""}`.trim();

const dateExpirationFormatee =
    dateExpiration.toLocaleDateString(
        "fr-FR",
        {
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        }
    );


const emailHtml = `

<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Vos documents d'hospitalisation</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f6f9; font-family:'Segoe UI', Roboto, Arial, sans-serif; color:#333;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px; margin:auto; background:white; border-radius:10px; box-shadow:0 3px 10px rgba(0,0,0,0.08); overflow:hidden;">
    <tr>
      <td style="background-color:#1a73e8; padding:24px; text-align:center;">
        <img src="https://junior2704.github.io/GestUrg2/logo.png" alt="Logo Hôpital" style="height:60px; display:block; margin:0 auto 10px auto;">
        <h1 style="color:white; font-size:22px; margin:0;">HOPJ</h1>
        <p style="color:#dce6f3; margin:6px 0 0; font-size:14px;">Service des Urgences</p>
      </td>
    </tr>

    <tr>
      <td style="padding:30px;">
        <h2 style="color:#1a73e8; font-weight:600; margin-top:0;">Votre ordonnance médicale</h2>

        <p style="font-size:16px; line-height:1.6;">
          Bonjour <strong>${nomPatient}</strong>,
        </p>

        <p style="font-size:15px; line-height:1.6; color:#555;">
          Les documents relatifs à votre récente hospitalisation au sein du service des Urgences de l'HOPJ sont maintenant disponible(s) !
        </p>
  <p style="font-size:15px; line-height:1.6; color:#555;">
          Rendez-vous sur votre espace patient en cliquant ci-desous :
        </p>
        <div style="text-align:center; margin:30px 0;">
          <a href="${lienPatient}" 
             style="background-color:#1a73e8; color:white; padding:14px 32px; text-decoration:none; border-radius:8px; font-weight:500; display:inline-block;">
            Acceder à mon espace patient
          </a>
        </div>

        <p style="font-size:15px; line-height:1.6; color:#555;">
          🚨 Afin de garantir la confidentialité de vos données, ce lien restera actif j'ausqu'au <strong>${dateExpirationFormatee}</strong>.
          Une fois ce délai passé, il vous sera impossible d'acceder à vos documents, et nous ne pourrons pas vous y donner accès de nouveau.
        </p>
<br>
  <p style="font-size:15px; line-height:1.6; color:#555;">
N'hésitez-pas à nous laisser un avis sur la page prévue à cet effet.
Les avis sont entièrement anonymisés et nous permettent d'améliorer la qualité du service de soins que nous proposons.        </p>
 <a href="https://junior2704.github.io/GesUrg2/avis-patient" 
             style="background-color:#1a73e8; color:white; padding:14px 32px; text-decoration:none; border-radius:8px; font-weight:500; display:inline-block;">
            Laisser un avis
          </a>      
	  <p style="font-size:14px; color:#777;">
          Pour toute question, merci de contacter le service des Urgences :
          <a href="mailto:urgences.hopj@gmail.com" style="color:#1a73e8;">urgences.hopj@gmail.com</a>
        </p>

        <hr style="border:none; border-top:1px solid #e0e0e0; margin:30px 0;">
        <p style="font-size:13px; color:#999; text-align:center;">
          Service des Urgences<br>
          <em>Cet e-mail a été généré automatiquement, merci de ne pas y répondre.</em>
		  <em>Fièrement propulsé par GestUrg2 🚀</em>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;



const emailText = `
Bonjour ${nomPatient},

Votre espace patient GestUrg2 est maintenant disponible.

Vous pouvez accéder à vos documents médicaux ici :

${lienPatient}

Pour vous connecter, vous devrez renseigner votre date de naissance.

Ce lien est valable jusqu'au ${dateExpirationFormatee}.

Cet e-mail a été envoyé automatiquement par GestUrg2.
`;


// ==================================================
// ENVOI
// ==================================================

let emailEnvoye = false;

try {
const emailBrut = patient.email;

if (
    !emailBrut ||
    typeof emailBrut !== "string"
) {

    return res.status(400).json({
        success: false,
        error: "Aucune adresse email valide pour ce patient"
    });

}

// Découper les emails séparés par "//"
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const emails = emailBrut
    .split("//")
    .map(e => e.trim())
    .filter(e => emailRegex.test(e));

if (emails.length === 0) {

    return res.status(400).json({
        success: false,
        error: `Aucune adresse email valide trouvée dans "${emailBrut}"`
    });

}
  await envoyerEmail({
    to: emails[0],
    subject: "Votre espace patient GestUrg2",
    html: emailHtml,
    text: emailText
});

    emailEnvoye = true;

} catch (emailError) {

    console.error(
        "Erreur envoi e-mail patient :",
        emailError
    );

}


// ==================================================
// RÉPONSE
// ==================================================

return res.json({

    success: true,

    accessId:
        accessRef.id,

    dateExpiration:
        dateExpiration.toISOString(),

    nombreDocuments:
        documentsSnap.size,

    emailEnvoye

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

            const session = req.patientSession;

            const { documentId } = req.params;

            // ==================================================
            // VALIDATION
            // ==================================================

            if (!documentId) {

                return res.status(400).json({
                    success: false,
                    error: "Identifiant du document manquant"
                });

            }

            // ==================================================
            // RÉCUPÉRER LE DOCUMENT
            // ==================================================

            const documentSnap =
                await adminDb
                    .collection("documents")
                    .doc(documentId)
                    .get();

            if (!documentSnap.exists) {

                return res.status(404).json({
                    success: false,
                    error: "Document introuvable"
                });

            }

            const document = documentSnap.data();

            // ==================================================
            // VÉRIFICATION CRITIQUE
            // ==================================================

            if (
                document?.ord?.hospitalisationId !==
                session.hospitalisationId
            ) {

                return res.status(403).json({
                    success: false,
                    error: "Accès interdit à ce document"
                });

            }

            // ==================================================
            // RÉPONSE
            // ==================================================

          return res.json({

    success: true,

    document: {

        id:
            documentSnap.id,

        type:
            document.type || "",

        dateCreation:
            document.dateCreation || null,

        ord:
            document.ord || null

    }

});

        } catch (error) {

            console.error(
                "Erreur récupération document patient :",
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    "Impossible de récupérer le document"
            });

        }

    }
);


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

            // ==================================================
            // SUPPRIMER LE COOKIE
            // ==================================================

            res.clearCookie(
                "gesturg_patient_session",
                {
                    httpOnly: true,
                    secure: true,
                    sameSite: "none",
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

            message:
                "Session patient valide",

            patientId:
                req.patientSession.patientId,

            hospitalisationId:
                req.patientSession.hospitalisationId,

            accessId:
                req.patientSession.accessId

        });

    }
);


// ======================================================
// EXPORT
// ======================================================

export default router;