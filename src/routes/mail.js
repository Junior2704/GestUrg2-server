import express from "express";
import { envoyerEmail } from "../services/mailService.js";

const router = express.Router();

router.post("/send", async (req, res) => {

    try {

        const {
            to,
            subject,
            html,
            text
        } = req.body;

        // ==============================
        // VALIDATION
        // ==============================

        if (!to || typeof to !== "string") {
            return res.status(400).json({
                success: false,
                error: "Destinataire invalide"
            });
        }

        if (!subject || typeof subject !== "string") {
            return res.status(400).json({
                success: false,
                error: "Sujet invalide"
            });
        }

        if (!html && !text) {
            return res.status(400).json({
                success: false,
                error: "Contenu de l'e-mail manquant"
            });
        }

        // ==============================
        // ENVOI
        // ==============================

        const result = await envoyerEmail({
            to,
            subject,
            html,
            text
        });

        res.json({
            success: true,
            message: "E-mail envoyé",
            messageId: result.messageId
        });

    } catch (error) {

        console.error("Erreur envoi e-mail :", error);

        res.status(500).json({
            success: false,
            error: "Impossible d'envoyer l'e-mail"
        });

    }

});
router.get("/test", async (req, res) => {

    res.json({
        success: true,
        service: "mail",
        status: "online"
    });

});
export default router;