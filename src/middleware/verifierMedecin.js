import { adminDb } from "../firebaseAdmin.js";

export async function verifierMedecin(req, res, next) {

    try {

        // Le middleware Firebase doit avoir placé
        // l'utilisateur authentifié ici
        const uid = req.firebaseUser?.uid;

        if (!uid) {

            return res.status(401).json({
                success: false,
                error: "Utilisateur Firebase introuvable"
            });

        }


        // ============================================
        // RÉCUPÉRER LE MÉDECIN
        // ============================================

        const medecinRef = adminDb
            .collection("medecins")
            .doc(uid);

        const medecinSnap = await medecinRef.get();


        if (!medecinSnap.exists) {

            return res.status(403).json({
                success: false,
                error: "Compte professionnel introuvable"
            });

        }


        // ============================================
        // STOCKER LES INFORMATIONS DU MÉDECIN
        // ============================================

        const medecin = medecinSnap.data();

        req.medecin = {
            uid,
            ...medecin
        };


        // ============================================
        // CONTINUER
        // ============================================

        next();

    } catch (error) {

        console.error(
            "Erreur vérification médecin :",
            error
        );

        return res.status(500).json({
            success: false,
            error: "Impossible de vérifier le compte professionnel"
        });

    }

}