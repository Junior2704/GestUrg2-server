import express from "express";
import { verifierFirebaseToken } from "../middleware/authFirebase.js";

const router = express.Router();

router.get("/", verifierFirebaseToken, async (req, res) => {

    res.json({
        success: true,
        authenticated: true,
        uid: req.firebaseUser.uid,
        email: req.firebaseUser.email || null
    });

});

export default router;