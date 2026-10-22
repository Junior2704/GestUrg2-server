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

/* ------------------------------------------------------------------
   Blocs réutilisables (même design que l'e-mail de fin d'hospitalisation)
------------------------------------------------------------------ */

function carte({ fond, bordure, marge = "28px 0 0", contenu }) {
    return `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:${marge};">
<tr>
<td style="background-color:${fond};border:1px solid ${bordure};border-radius:16px;padding:19px 20px;">
${contenu}
</td>
</tr>
</table>`;
}

function construireHTML({ prenom, nom, date, heure, reference }) {
    const aApporter = [
        "Pièce d’identité",
        "Carte Vitale et carte de mutuelle",
        "Ordonnances et liste de vos traitements",
        "Carnet de santé pour un enfant"
    ].map(element => `
        <tr>
            <td style="width:22px;vertical-align:top;color:#0F766E;font-size:13px;line-height:1.7;">✔</td>
            <td style="color:#4C6B66;font-size:13px;line-height:1.7;">${element}</td>
        </tr>`).join("");

    return `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Confirmation de votre rendez-vous — GestUrg2</title>
</head>

<body style="margin:0;padding:0;background-color:#F6FBFA;font-family:'Segoe UI',Roboto,Arial,sans-serif;color:#12312D;">

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F6FBFA;padding:35px 15px;">
<tr>
<td align="center">

<table width="100%" cellpadding="0" cellspacing="0" border="0"
    style="max-width:640px;background-color:#FFFFFF;border:1px solid #E2EEEC;border-radius:22px;overflow:hidden;box-shadow:0 20px 50px -25px rgba(15,60,55,.35);">

<!-- ============================ HEADER ============================ -->
<tr>
<td align="center" style="background-color:#0B544E;padding:32px 25px 30px;">

    <img src="https://junior2704.github.io/GestUrg2/logo.png" alt="GestUrg2" width="76"
        style="display:block;width:76px;height:76px;object-fit:contain;margin:0 auto 16px;background-color:#FFFFFF;border-radius:20px;padding:7px;">

    <div style="display:inline-block;background-color:#DCF3F0;color:#0B544E;border-radius:999px;padding:6px 13px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:12px;">
        📅 RENDEZ-VOUS
    </div>

    <h1 style="margin:0;color:#FFFFFF;font-size:26px;line-height:1.2;font-weight:600;">GestUrg2</h1>

    <p style="margin:8px 0 0;color:#D9EFEC;font-size:14px;">Service des Urgences</p>

</td>
</tr>

<!-- ============================ CONTENU =========================== -->
<tr>
<td style="padding:35px 32px;">

    <h2 style="margin:0 0 18px;color:#0B544E;font-size:24px;line-height:1.25;font-weight:600;">
        Votre rendez-vous est confirmé
    </h2>

    <p style="margin:0 0 18px;color:#12312D;font-size:16px;line-height:1.7;">
        Bonjour <strong>${prenom} ${nom}</strong>,
    </p>

    <p style="margin:0 0 18px;color:#4C6B66;font-size:15px;line-height:1.7;">
        Votre demande de rendez-vous au sein du service des Urgences
        a bien été enregistrée. Retrouvez ci-dessous les informations
        de votre venue.
    </p>

    <!-- ===================== DATE ET HEURE ===================== -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;">
    <tr>
    <td style="background-color:#F3F9F8;border:1px solid #E2EEEC;border-radius:15px;padding:17px 18px;">

        <p style="margin:0 0 7px;color:#6A8580;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">
            Votre rendez-vous
        </p>

        <p style="margin:0;color:#12312D;font-size:15px;line-height:1.6;font-weight:600;">
            📅 Le ${date}
            <br>
            🕒 À ${heure}
        </p>

    </td>
    </tr>
    </table>

    <!-- ======================= RÉFÉRENCE ======================= -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 25px;">
    <tr>
    <td align="center" style="background-color:#DCF3F0;border-radius:15px;padding:18px;">

        <p style="margin:0 0 6px;color:#0B544E;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">
            Votre référence
        </p>

        <p style="margin:0;color:#0B544E;font-size:26px;font-weight:800;letter-spacing:3px;">
            ${reference}
        </p>

    </td>
    </tr>
    </table>

    <p style="margin:0;color:#4C6B66;font-size:15px;line-height:1.7;">
        Conservez cette référence : elle vous sera demandée à l’accueil.
        Merci de vous présenter <strong>10 minutes avant</strong> l’heure de votre rendez-vous.
    </p>
    <!-- ===================== ANNULATION ===================== -->
    <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin:26px auto 0;">
    <tr>
    <td align="center" style="border:2px solid #EF6351;border-radius:14px;background-color:#FFFFFF;">
        <a href="https://junior2704.github.io/GestUrg2/annulerrdv.html"
           target="_blank"
           style="display:inline-block;padding:13px 26px;color:#EF6351;font-size:15px;font-weight:700;text-decoration:none;border-radius:14px;">
            Annuler mon rendez-vous
        </a>
    </td>
    </tr>
    </table>
    <p style="margin:10px 0 0;text-align:center;color:#8AA19D;font-size:12px;line-height:1.6;">
        Vous aurez besoin de votre référence, de l’e-mail et de la date de naissance du patient.
    </p>
    ${carte({
        fond: "#F3F9F8",
        bordure: "#DCEBE8",
        contenu: `
    <p style="margin:0 0 10px;color:#0B544E;font-size:15px;font-weight:700;">
        🎒 À apporter
    </p>
    <table cellpadding="0" cellspacing="0" border="0">
        ${aApporter}
    </table>`
    })}

    ${carte({
        fond: "#FFF9F5",
        bordure: "#F3E5DA",
        contenu: `
    <p style="margin:0 0 8px;color:#12312D;font-size:15px;font-weight:700;">
        🚑 En cas de danger vital
    </p>
    <p style="margin:0;color:#4C6B66;font-size:13px;line-height:1.7;">
        Si vous ressentez une douleur dans la poitrine, une difficulté à respirer
        ou un malaise grave, n’attendez pas votre rendez-vous : appelez immédiatement le
        <strong>15</strong> (SAMU) ou le <strong>112</strong>.
    </p>`
    })}

    <!-- ========================= CONTACT ========================= -->
    <p style="margin:28px 0 0;color:#4C6B66;font-size:13px;line-height:1.6;">
        Pour toute question concernant votre rendez-vous,
        vous pouvez contacter le service des Urgences :
        <br>
        <a href="mailto:urgences.hopj@gmail.com" style="color:#0F766E;text-decoration:none;font-weight:700;">
            urgences.hopj@gmail.com
        </a>
    </p>

    <!-- ======================= SÉPARATION ======================== -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 20px;">
    <tr>
    <td style="border-top:1px solid #E2EEEC;font-size:1px;line-height:1px;">&nbsp;</td>
    </tr>
    </table>

    <!-- ========================= FOOTER ========================== -->
    <p style="margin:0;text-align:center;color:#4C6B66;font-size:11px;line-height:1.7;">
        Service des Urgences
        <br>
        <strong style="color:#0F766E;">Fièrement propulsé par GestUrg2 🚀</strong>
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
</html>`;
}

function construireTexte({ prenom, nom, date, heure, reference }) {
    return `Bonjour ${prenom} ${nom},

Votre demande de rendez-vous au sein du service des Urgences a bien été enregistrée.


VOTRE RENDEZ-VOUS

Le ${date}
À ${heure}


VOTRE RÉFÉRENCE

${reference}

Conservez cette référence : elle vous sera demandée à l'accueil.
Merci de vous présenter 10 minutes avant l'heure de votre rendez-vous.


À APPORTER

- Pièce d'identité
- Carte Vitale et carte de mutuelle
- Ordonnances et liste de vos traitements
- Carnet de santé pour un enfant


EN CAS DE DANGER VITAL

Si vous ressentez une douleur dans la poitrine, une difficulté à respirer ou un malaise grave, n'attendez pas votre rendez-vous : appelez immédiatement le 15 (SAMU) ou le 112.


CONTACT

Pour toute question concernant votre rendez-vous, vous pouvez contacter le service des Urgences :

urgences.hopj@gmail.com


Cet e-mail a été généré automatiquement.
Merci de ne pas y répondre.

Service des Urgences`;
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
            const dateFormatee = date.split("-").reverse().join("/");

            const subject = "Confirmation de votre rendez-vous";

            // Valeurs brutes pour la version texte
            const text = construireTexte({
                prenom,
                nom,
                date: dateFormatee,
                heure,
                reference
            });

            // Valeurs échappées pour la version HTML
            const html = construireHTML({
                prenom: echapperHTML(prenom),
                nom: echapperHTML(nom),
                date: echapperHTML(dateFormatee),
                heure: echapperHTML(heure),
                reference: echapperHTML(reference)
            });

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