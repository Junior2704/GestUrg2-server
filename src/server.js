import "dotenv/config";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mailRouter from "./routes/mail.js";
const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;

// ==============================
// MIDDLEWARES
// ==============================

app.use(helmet());

app.use(cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({
    limit: "1mb"
}));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: "draft-8",
    legacyHeaders: false
});

app.use("/api", apiLimiter);
app.use("/api/mail", verifierApiKey, mailRouter);
console.log("API_KEY chargée :", process.env.API_KEY);
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