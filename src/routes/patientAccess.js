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
// RÉCUPÉRER L'HOSPITALISATION
// ==================================================

const hospitalisationRef = adminDb
    .collection("hospitalisations")
    .doc(hospitalisationId);

const hospitalisationSnap =
    await hospitalisationRef.get();

if (!hospitalisationSnap.exists) {

    return res.status(404).json({
        success: false,
        error: "Hospitalisation introuvable"
    });

}

const hospitalisation =
    hospitalisationSnap.data();
	

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
// ==================================================
// DATES DE L'HOSPITALISATION
// ==================================================

const dateDebutHospitalisation =
    convertirDate(
        hospitalisation.dateEntree ||
        hospitalisation.dateDebut ||
        hospitalisation.dateCreation
    );

const dateFinHospitalisation =
    convertirDate(
        hospitalisation.dateSortie ||
        hospitalisation.dateFin ||
        new Date()
    );

function formaterDateHospitalisation(date) {

    if (!date) {
        return "Date non renseignée";
    }

    return date.toLocaleDateString(
        "fr-FR",
        {
            day: "2-digit",
            month: "long",
            year: "numeric"
        }
    );
}

const dateDebutHospitalisationFormatee =
    formaterDateHospitalisation(
        dateDebutHospitalisation
    );

const dateFinHospitalisationFormatee =
    formaterDateHospitalisation(
        dateFinHospitalisation
    );

const emailHtml = `

<!DOCTYPE html>
<html lang="fr">

<head>

    <meta charset="UTF-8">

    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
    >

    <title>Votre dossier d'hospitalisation — GestUrg2</title>

</head>


<body
    style="
        margin:0;
        padding:0;
        background-color:#F6FBFA;
        font-family:'Segoe UI',Roboto,Arial,sans-serif;
        color:#12312D;
    "
>


<!-- ============================================================
     CONTENEUR PRINCIPAL
============================================================ -->

<table
    width="100%"
    cellpadding="0"
    cellspacing="0"
    border="0"
    style="
        background-color:#F6FBFA;
        padding:35px 15px;
    "
>

<tr>

<td align="center">


<table
    width="100%"
    cellpadding="0"
    cellspacing="0"
    border="0"
    style="
        max-width:640px;
        background-color:#FFFFFF;
        border:1px solid #E2EEEC;
        border-radius:22px;
        overflow:hidden;
        box-shadow:0 20px 50px -25px rgba(15,60,55,.35);
    "
>


<!-- ============================================================
     HEADER
============================================================ -->

<tr>

<td
    align="center"
    style="
        background-color:#0B544E;
        padding:32px 25px 30px;
    "
>

    <img
        src="https://junior2704.github.io/GestUrg2/logo.png"
        alt="GestUrg2"
        width="76"
        style="
            display:block;
            width:76px;
            height:76px;
            object-fit:contain;
            margin:0 auto 16px;
            background-color:#FFFFFF;
            border-radius:20px;
            padding:7px;
        "
    >

    <div
        style="
            display:inline-block;
            background-color:#DCF3F0;
            color:#0B544E;
            border-radius:999px;
            padding:6px 13px;
            font-size:11px;
            font-weight:700;
            letter-spacing:.08em;
            text-transform:uppercase;
            margin-bottom:12px;
        "
    >
        🏥 ESPACE PATIENT
    </div>

    <h1
        style="
            margin:0;
            color:#FFFFFF;
            font-size:26px;
            line-height:1.2;
            font-weight:600;
        "
    >
        GestUrg2
    </h1>

    <p
        style="
            margin:8px 0 0;
            color:#D9EFEC;
            font-size:14px;
        "
    >
        Votre espace patient sécurisé
    </p>

</td>

</tr>


<!-- ============================================================
     CONTENU
============================================================ -->

<tr>

<td
    style="
        padding:35px 32px;
    "
>


<h2
    style="
        margin:0 0 18px;
        color:#0B544E;
        font-size:24px;
        line-height:1.25;
        font-weight:600;
    "
>
    Votre dossier d'hospitalisation
</h2>


<p
    style="
        margin:0 0 18px;
        color:#12312D;
        font-size:16px;
        line-height:1.7;
    "
>
    Bonjour <strong>${nomPatient}</strong>,
</p>


<p
    style="
        margin:0 0 18px;
        color:#4C6B66;
        font-size:15px;
        line-height:1.7;
    "
>
    Les documents relatifs à votre récente hospitalisation
    au sein du service des Urgences sont maintenant disponibles
    dans votre espace patient sécurisé.
</p>


<!-- ============================================================
     DATES D'HOSPITALISATION
============================================================ -->

<table
    width="100%"
    cellpadding="0"
    cellspacing="0"
    border="0"
    style="
        margin:0 0 25px;
    "
>

<tr>

<td
    style="
        background-color:#F3F9F8;
        border:1px solid #E2EEEC;
        border-radius:15px;
        padding:17px 18px;
    "
>

    <p
        style="
            margin:0 0 7px;
            color:#6A8580;
            font-size:11px;
            font-weight:700;
            letter-spacing:.06em;
            text-transform:uppercase;
        "
    >
        Votre hospitalisation
    </p>

    <p
        style="
            margin:0;
            color:#12312D;
            font-size:15px;
            line-height:1.6;
            font-weight:600;
        "
    >
        📅 Du ${dateDebutHospitalisationFormatee}
        au ${dateFinHospitalisationFormatee}
    </p>

</td>

</tr>

</table>


<p
    style="
        margin:0 0 24px;
        color:#4C6B66;
        font-size:15px;
        line-height:1.7;
    "
>
    Vous pouvez consulter vos documents directement depuis
    votre espace patient en cliquant sur le bouton ci-dessous.
</p>


<!-- ============================================================
     BOUTON ESPACE PATIENT
============================================================ -->

<table
    width="100%"
    cellpadding="0"
    cellspacing="0"
    border="0"
>

<tr>

<td align="center">

    <a
        href="${lienPatient}"
        style="
            display:inline-block;
            background-color:#0F766E;
            color:#FFFFFF;
            text-decoration:none;
            padding:15px 28px;
            border-radius:14px;
            font-size:14px;
            font-weight:700;
            box-shadow:0 10px 25px -12px rgba(15,118,110,.7);
        "
    >
        Accéder à mon espace patient →
    </a>

</td>

</tr>

</table>


<!-- ============================================================
     CONSERVATION DES DOCUMENTS
============================================================ -->

<table
    width="100%"
    cellpadding="0"
    cellspacing="0"
    border="0"
    style="
        margin-top:28px;
    "
>

<tr>

<td
    style="
        background-color:#F3F9F8;
        border:1px solid #DCEBE8;
        border-radius:16px;
        padding:19px 20px;
    "
>

    <p
        style="
            margin:0 0 8px;
            color:#0B544E;
            font-size:15px;
            font-weight:700;
        "
    >
        📁 Conservez vos documents
    </p>

    <p
        style="
            margin:0;
            color:#4C6B66;
            font-size:13px;
            line-height:1.7;
        "
    >
        Nous vous recommandons de conserver ces documents
        pour votre suivi médical et de les présenter à votre
        médecin traitant ou à tout professionnel de santé
        qui en aurait besoin.
    </p>

</td>

</tr>

</table>


<!-- ============================================================
     SÉCURITÉ
============================================================ -->

<table
    width="100%"
    cellpadding="0"
    cellspacing="0"
    border="0"
    style="
        margin-top:20px;
    "
>

<tr>

<td
    style="
        background-color:#DCF3F0;
        border-radius:15px;
        padding:16px 18px;
    "
>

    <p
        style="
            margin:0;
            color:#0B544E;
            font-size:13px;
            line-height:1.6;
        "
    >
        🔒 <strong>Important :</strong>
        afin de garantir la confidentialité de vos données,
        ce lien restera actif jusqu'au
        <strong>${dateExpirationFormatee}</strong>.
    </p>

</td>

</tr>

</table>


<p
    style="
        margin:16px 0 0;
        color:#4C6B66;
        font-size:13px;
        line-height:1.6;
    "
>
    Pour accéder à votre dossier, votre date de naissance
    vous sera demandée afin de vérifier votre identité.
</p>


<!-- ============================================================
     APRÈS L'HOSPITALISATION
============================================================ -->

<table
    width="100%"
    cellpadding="0"
    cellspacing="0"
    border="0"
    style="
        margin-top:28px;
    "
>

<tr>

<td
    style="
        background-color:#FFF9F5;
        border:1px solid #F3E5DA;
        border-radius:16px;
        padding:19px 20px;
    "
>

    <p
        style="
            margin:0 0 8px;
            color:#12312D;
            font-size:15px;
            font-weight:700;
        "
    >
        🏥 Après votre hospitalisation
    </p>

    <p
        style="
            margin:0;
            color:#4C6B66;
            font-size:13px;
            line-height:1.7;
        "
    >
        Si votre état de santé s'aggrave ou si de nouveaux
        symptômes apparaissent, contactez un professionnel
        de santé ou les services d'urgence adaptés à votre
        situation.
    </p>

</td>

</tr>

</table>


<!-- ============================================================
     AVIS PATIENT
============================================================ -->

<table
    width="100%"
    cellpadding="0"
    cellspacing="0"
    border="0"
    style="
        margin-top:28px;
    "
>

<tr>

<td
    style="
        background-color:#F8FBFA;
        border:1px solid #E2EEEC;
        border-radius:16px;
        padding:18px 20px;
    "
>

    <p
        style="
            margin:0 0 7px;
            color:#12312D;
            font-size:14px;
            font-weight:700;
        "
    >
        Votre avis nous intéresse
    </p>

    <p
        style="
            margin:0 0 14px;
            color:#6A8580;
            font-size:12px;
            line-height:1.6;
        "
    >
        Votre retour nous aide à améliorer la qualité de
        l'accueil et de la prise en charge.
        Votre avis est entièrement anonymisé.
    </p>

    <a
        href="https://junior2704.github.io/GestUrg2/avis-patient"
        style="
            display:inline-block;
            background-color:#E9F3F1;
            color:#0F766E;
            text-decoration:none;
            padding:9px 16px;
            border-radius:10px;
            font-size:12px;
            font-weight:700;
        "
    >
        Donner mon avis →
    </a>

</td>

</tr>

</table>


<!-- ============================================================
     CONTACT
============================================================ -->

<p
    style="
        margin:28px 0 0;
        color:#4C6B66;
        font-size:13px;
        line-height:1.6;
    "
>
    Pour toute question concernant votre dossier ou vos documents,
    vous pouvez contacter le service des Urgences :
    <br>

    <a
        href="mailto:urgences.hopj@gmail.com"
        style="
            color:#0F766E;
            text-decoration:none;
            font-weight:700;
        "
    >
        urgences.hopj@gmail.com
    </a>
</p>


<!-- ============================================================
     SÉPARATION
============================================================ -->

<table
    width="100%"
    cellpadding="0"
    cellspacing="0"
    border="0"
    style="
        margin:28px 0 20px;
    "
>

<tr>

<td
    style="
        border-top:1px solid #E2EEEC;
        font-size:1px;
        line-height:1px;
    "
>
    &nbsp;
</td>

</tr>

</table>


<!-- ============================================================
     FOOTER
============================================================ -->

<p
    style="
        margin:0;
        text-align:center;
        color:#4C6B66;
        font-size:11px;
        line-height:1.7;
    "
>

    Service des Urgences
    <br>
 <strong style="color:#0F766E;">
        Fièrement propulsé par GestUrg2 🚀
    </strong>
	<br>
    <span style="color:#8AA19D;">
        Cet e-mail a été généré automatiquement,
        merci de ne pas y répondre.
    </span>

</p>


</td>

</tr>


</table>


</td>

</tr>

</table>


</body>

</html>
`;


const emailText = `
Bonjour ${nomPatient},

Votre espace patient GestUrg2 est maintenant disponible.

Les documents relatifs à votre récente hospitalisation sont disponibles dans votre espace patient.

Vous pouvez y accéder ici :

${lienPatient}

Pour vous connecter, vous devrez renseigner la date de naissance du patient.

Pour des raisons de sécurité, ce lien restera actif jusqu'au ${dateExpirationFormatee}.

Une fois ce délai passé, l'accès à vos documents ne sera plus possible via ce lien.

Vous pouvez également nous laisser un avis, de manière entièrement anonymisée :

https://junior2704.github.io/GestUrg2/avis-patient

Pour toute question, vous pouvez contacter le service des Urgences :
urgences.hopj@gmail.com

Cet e-mail a été généré automatiquement.

Fièrement propulsé par GestUrg2 🚀
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