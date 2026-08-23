import "dotenv/config";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mailRouter from "./routes/mail.js";
import firebaseTestRouter from "./routes/firebaseTest.js";
import authTestRouter from "./routes/authTest.js";
import patientAccessRouter from "./routes/patientAccess.js";
import cookieParser from "cookie-parser";
const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;

// ==============================
// MIDDLEWARES
// ==============================

app.use(helmet());

app.use(cors({
    origin: [
        "https://junior2704.github.io",
        "http://localhost:3000"
    ],
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({
    limit: "1mb"
}));
app.use(cookieParser());
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: "draft-8",
    legacyHeaders: false
});

app.use("/api", apiLimiter);
app.use("/api/mail", verifierApiKey, mailRouter);
app.use("/firebase-test", firebaseTestRouter);
app.use("/auth-test", authTestRouter);
app.use("/api/patient-access", patientAccessRouter);
function verifierApiKey(req, res, next) {

    const authorization = req.headers.authorization;

    if (!authorization) {
        return res.status(401).json({
            success: false,
            error: "Authentification requise"
        });
    }

    const [type, key] = authorization.split(" ");

    if (type !== "Bearer" || key !== process.env.API_KEY) {
        return res.status(403).json({
            success: false,
            error: "Clé API invalide"
        });
    }

    next();
}
// ==============================
// ROUTE DE TEST
// ==============================

app.get("/", (req, res) => {
    res.json({
        success: true,
        service: "GestUrg2 Server",
        status: "online"
    });
});

app.get("/health", (req, res) => {
    res.json({
        success: true,
        status: "healthy",
        timestamp: new Date().toISOString()
    });
});

// ==============================
// DEMARRAGE
// ==============================

app.listen(PORT, "0.0.0.0", () => {
    console.log(`GestUrg2 Server démarré sur le port ${PORT}`);
});