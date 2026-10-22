
import express from "express";
import rateLimit from "express-rate-limit";
import { envoyerEmail } from "../services/mailService.js";

const router = express.Router();

const limiterConfirmation = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false
});

function echapperHTML(valeur) {
    return String(valeur ?? "").replace(/[&<>"']/g, caractere => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[caractere]);
}

router.post(
    "/confirmation",
    limiterConfirmation,
    async (req, res) => {
        try {
            const {
                email,
                prenom,
                nom,
                date,
                heure,
                reference
            } = req.body ?? {};

            const emailValide =
                typeof email === "string" &&
                /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
                email.length <= 254;

            const dateValide =
                typeof date === "string" &&
                /^\d{4}-\d{2}-\d{2}$/.test(date);

            const heureValide =
                typeof heure === "string" &&
                /^\d{2}:\d{2}$/.test(heure);

            const referenceValide =
                typeof reference === "string" &&
                /^URG-[A-Z0-9]{4}$/.test(reference);

            if (
                !emailValide ||
                typeof prenom !== "string" ||
                prenom.length > 100 ||
                typeof nom !== "string" ||
                nom.length > 100 ||
                !dateValide ||
                !heureValide ||
                !referenceValide
            ) {
                return res.status(400).json({
                    success: false,
                    error: "Informations de rendez-vous invalides"
                });
            }

            const destinataire = email.trim();
            const prenomHTML = echapperHTML(prenom);
            const nomHTML = echapperHTML(nom);
            const dateHTML = echapperHTML(
                date.split("-").reverse().join("/")
            );
            const heureHTML = echapperHTML(heure);
            const referenceHTML = echapperHTML(reference);

            const subject = "Confirmation de votre rendez-vous";

            const text =
`Bonjour ${prenom} ${nom},

Votre demande de rendez-vous a été enregistrée.

Date : ${date.split("-").reverse().join("/")}
Heure : ${heure}
Référence : ${reference}

Conservez cette référence pour retrouver votre rendez-vous.

Ceci est un message automatique.`;

            const html = `
                <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#243447;line-height:1.6">
                    <div style="background:#005ea2;color:white;padding:22px;border-radius:10px 10px 0 0">
                        <h2 style="margin:0">Confirmation de rendez-vous</h2>
                    </div>
                    <div style="padding:24px;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 10px 10px">
                        <p>Bonjour ${prenomHTML} ${nomHTML},</p>
                        <p>Votre demande de rendez-vous a bien été enregistrée.</p>
                        <div style="background:#f3f7fb;padding:16px;border-radius:8px">
                            <p><strong>Date :</strong> ${dateHTML}</p>
                            <p><strong>Heure :</strong> ${heureHTML}</p>
                            <p><strong>Référence :</strong> ${referenceHTML}</p>
                        </div>
                        <p>Conservez cette référence pour retrouver votre rendez-vous.</p>
                        <p style="font-size:12px;color:#64748b">Ceci est un message automatique.</p>
                    </div>
                </div>
            `;

            const resultat = await envoyerEmail({
                to: destinataire,
                subject,
                html,
                text
            });

            return res.json({
                success: true,
                message: "E-mail de confirmation envoyé",
                messageId: resultat?.messageId
            });

        } catch (error) {
            console.error(
                "Erreur confirmation rendez-vous :",
                error
            );

            return res.status(500).json({
                success: false,
                error: "Impossible d'envoyer la confirmation"
            });
        }
    }
);

export default router;
