import crypto from "crypto";
import { adminDb } from "../firebaseAdmin.js";

export async function verifierSessionPatient(req, res, next) {

    try {

        // ==================================================
        // RÉCUPÉRER LE COOKIE
        // ==================================================

        const sessionToken =
            req.cookies?.gesturg_patient_session;

        if (!sessionToken) {
            return res.status(401).json({
                success: false,
                error: "Authentification patient requise"
            });
        }


        // ==================================================
        // HASH DU COOKIE
        // ==================================================

        const sessionHash = crypto
            .createHash("sha256")
            .update(sessionToken)
            .digest("hex");


        // ==================================================
        // RECHERCHER LA SESSION
        // ==================================================

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


        // ==================================================
        // SESSION ACTIVE ?
        // ==================================================

        if (session.actif !== true) {
            return res.status(401).json({
                success: false,
                error: "Session désactivée"
            });
        }


        // ==================================================
        // EXPIRATION
        // ==================================================

        const dateExpiration =
            session.dateExpiration?.toDate
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


        // ==================================================
        // VÉRIFIER LE PATIENT
        // ==================================================

        if (!session.patientId) {
            return res.status(401).json({
                success: false,
                error: "Session patient invalide"
            });
        }


        // ==================================================
        // AJOUTER LA SESSION À REQ
        // ==================================================

        req.patientSession = {

            sessionId: sessionDoc.id,

            accessId: session.accessId,

            patientId: session.patientId,

            hospitalisationId:
                session.hospitalisationId

        };


        // ==================================================
        // CONTINUER
        // ==================================================

        next();

    } catch (error) {

        console.error(
            "Erreur vérification session patient :",
            error
        );

        return res.status(500).json({
            success: false,
            error: "Impossible de vérifier la session patient"
        });

    }

}