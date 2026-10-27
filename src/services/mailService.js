import { google } from "googleapis";

function gmail() {
  const auth = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: "v1", auth });
}

// Empêche l'injection d'en-têtes (retours à la ligne)
const entete = v => String(v).replace(/[\r\n]+/g, " ").trim();
const sujetMime = s => `=?UTF-8?B?${Buffer.from(entete(s), "utf-8").toString("base64")}?=`;

export async function envoyerEmail({ to, subject, html, text, threadId, inReplyTo }) {
  const destinataires = (Array.isArray(to) ? to : [to]).map(entete).join(", ");
  const corps = html || text;

  const lignes = [
    `To: ${destinataires}`,
    `Subject: ${sujetMime(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: ${html ? "text/html" : "text/plain"}; charset="UTF-8"`,
    "Content-Transfer-Encoding: base64"
  ];
  // Pour répondre dans le même fil (utile pour les réclamations)
  if (inReplyTo) {
    lignes.push(`In-Reply-To: ${entete(inReplyTo)}`, `References: ${entete(inReplyTo)}`);
  }
  lignes.push("", Buffer.from(corps, "utf-8").toString("base64"));

  const raw = Buffer.from(lignes.join("\r\n"), "utf-8").toString("base64url");

  const res = await gmail().users.messages.send({
    userId: "me",
    requestBody: { raw, ...(threadId ? { threadId } : {}) }
  });

  return { messageId: res.data.id };
}