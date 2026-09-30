
import express from "express";
import { verifierFirebaseToken } from "../middleware/authFirebase.js";
import { verifierMedecin } from "../middleware/verifierMedecin.js";
import { envoyerEmail } from "../services/mailService.js";

const router = express.Router();

router.post(
    "/send",
    verifierFirebaseToken,
    verifierMedecin,
    async (req, res) => {

        try {

            let {
                to,
                subject,
                html,
                text
            } = req.body;


            // ==================================================
            // VÉRIFICATION AUTORISATION
            // ==================================================

           const pages = req.medecin?.pages || {};

if (
    pages.admin !== true &&
    pages.mailto !== true
) {
    return res.status(403).json({
        success: false,
        error: "Vous n'avez pas l'autorisation d'envoyer des e-mails"
    });
}


            // ==================================================
            // DESTINATAIRE
            // ==================================================

            if (!to) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Destinataire manquant"
                });

            }


            if (Array.isArray(to)) {

                to =
                    to
                        .map(email =>
                            String(email).trim()
                        )
                        .filter(Boolean);

            } else if (
                typeof to === "string"
            ) {

                to =
                    to.trim();

            } else {

                return res.status(400).json({
                    success: false,
                    error:
                        "Destinataire invalide"
                });

            }


            if (
                !to ||
                (
                    Array.isArray(to) &&
                    to.length === 0
                )
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Aucun destinataire valide"
                });

            }


            // ==================================================
            // SUJET
            // ==================================================

            if (
                !subject ||
                typeof subject !== "string"
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Sujet invalide"
                });

            }


            // ==================================================
            // CONTENU
            // ==================================================

            if (
                !html &&
                !text
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Contenu de l'e-mail manquant"
                });

            }


            // ==================================================
            // ENVOI
            // ==================================================

            const result =
                await envoyerEmail({
                    to,
                    subject,
                    html,
                    text
                });


            return res.json({

                success: true,

                message:
                    "E-mail envoyé",

                messageId:
                    result.messageId

            });

        } catch (error) {

            console.error(
                "Erreur envoi e-mail :",
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    "Impossible d'envoyer l'e-mail"
            });

        }

    }
);


router.get(
    "/test",
    async (req, res) => {

        res.json({
            success: true,
            service: "mail",
            status: "online"
        });

    }
);



router.get("/test", async (req, res) => {

    res.json({

        success: true,

        service: "mail",

        status: "online"

    });

});


export default router;

