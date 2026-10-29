
/*
 * routes/calendarFeed.js
 * Flux ICS pour Apple Calendrier, Google Agenda et Outlook.
 *
 * Route : GET /calendar/:file
 * Authentification : token secret stocké dans Firestore.
 */

import express from "express";
import admin from "firebase-admin";

const router = express.Router();
const db = admin.firestore();

// Confidentialité : false = seules les initiales apparaissent.
const AFFICHER_NOM = false;
const JOURS_PASSE = 7;
const JOURS_FUTUR = 60;

const iso = (d) => d.toISOString().slice(0, 10);

const min = (h) => {
  const [a, b] = String(h || "0:0").split(":");
  return (+a || 0) * 60 + (+b || 0);
};

const hm = (m) =>
  String(Math.floor(m / 60) % 24).padStart(2, "0") +
  String(m % 60).padStart(2, "0");

const esc = (s) =>
  String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");

function fold(line) {
  const out = [];
  let cur = "";

  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > 74) {
      out.push(cur);
      cur = " " + ch;
    } else {
      cur += ch;
    }
  }

  out.push(cur);
  return out.join("\r\n");
}

function titre(r) {
  const p = r.patient || {};

  if (AFFICHER_NOM) {
    return `Urgences · ${`${p.prenom || ""} ${p.nom || ""}`.trim()}`;
  }

  const ini = (
    (p.prenom || "").trim().charAt(0) +
    "." +
    (p.nom || "").trim().charAt(0) +
    "."
  ).toUpperCase();

  return `Urgences · RDV ${ini}`;
}

router.get("/calendar/:file", async (req, res) => {
  try {
    const match = /^([a-f0-9]{48})\.ics$/.exec(req.params.file);

    if (!match) {
      return res.status(404).end();
    }

    const feed = await db.collection("calendarFeeds").doc(match[1]).get();

    if (!feed.exists) {
      return res.status(404).end();
    }

    const uid = feed.data()?.uid;

    if (!uid) {
      return res.status(404).end();
    }

    const a = new Date();
    a.setDate(a.getDate() - JOURS_PASSE);

    const b = new Date();
    b.setDate(b.getDate() + JOURS_FUTUR);

    const snap = await db
      .collection("rdv-urgences")
      .where("date", ">=", iso(a))
      .where("date", "<=", iso(b))
      .get();

    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");

    const lignes = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//GestUrg2//Agenda//FR",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:GestUrg2 · Mon agenda",
      "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
      "X-PUBLISHED-TTL:PT15M",
    ];

    snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter(
        (r) =>
          r.medecinId === uid &&
          r.statut !== "annule" &&
          r.date &&
          r.heure
      )
      .forEach((r) => {
        const date = r.date.replace(/-/g, "");
        const debut = min(r.heure);
        const fin = Math.min(
          debut + (Number(r.duree) || 15),
          1439
        );

        lignes.push(
          "BEGIN:VEVENT",
          `UID:${r.id}@gesturg2`,
          `DTSTAMP:${stamp}`,
          `DTSTART:${date}T${hm(debut)}00`,
          `DTEND:${date}T${hm(fin)}00`,
          fold("SUMMARY:" + esc(titre(r))),
          "END:VEVENT"
        );
      });

    lignes.push("END:VCALENDAR");

    res.set({
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="gesturg2-agenda.ics"',
      "Cache-Control": "private, max-age=300",
      "X-Robots-Tag": "noindex",
    });

    return res.send(lignes.join("\r\n"));
  } catch (error) {
    console.error("calendarFeed :", error);
    return res.status(500).end();
  }
});

export default router;
