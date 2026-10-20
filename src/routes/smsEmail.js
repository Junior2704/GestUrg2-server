
import express from "express";
import { envoyerMailSMSPatient } from "../services/smsEmailService.js";

const router = express.Router();

router.post("/sms-email", async (req, res) => {
    try {
        const authorization = req.headers.authorization || "";
        const token = authorization.startsWith("Bearer ")
            ? authorization.slice(7)
            : "";

        if (
            !process.env.SMS_GATEWAY_TOKEN ||
            token !== process.env.SMS_GATEWAY_TOKEN
        ) {
            return res.status(401).json({
                success: false,
                error: "Accès non autorisé."
            });
        }

        const { numero, contenu } = req.body || {};

        if (
            typeof numero !== "string" ||
            typeof contenu !== "string"
        ) {
            return res.status(400).json({
                success: false,
                error: "Les champs numero et contenu sont obligatoires."
            });
        }

        await envoyerMailSMSPatient(numero, contenu);

        return res.status(200).json({
            success: true,
            message: "E-mail transmis à Gmail."
        });

    } catch (error) {
        console.error("[SMS_EMAIL]", error.message);

        return res.status(500).json({
            success: false,
            error: "Impossible de transmettre l'e-mail."
        });
    }
});

export default router;
