import express from "express";
import { adminDb } from "../firebaseAdmin.js";

const router = express.Router();

router.get("/", async (req, res) => {

    try {

        const snapshot = await adminDb
            .collection("patients")
            .limit(1)
            .get();

        res.json({
            success: true,
            firebase: true,
            firestore: true,
            documentsAccessibles: !snapshot.empty
        });

    } catch (error) {

        console.error("Erreur Firebase Admin :", error);

        res.status(500).json({
            success: false,
            firebase: false,
            error: "Connexion Firebase impossible"
        });

    }

});

export default router;