import { getAuth } from "firebase-admin/auth";

export async function verifierFirebaseToken(req, res, next) {
    try {
        const authorization = req.headers.authorization;

        if (!authorization || !authorization.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                error: "Token Firebase manquant"
            });
        }

        const idToken = authorization.substring(7);

        const decodedToken = await getAuth().verifyIdToken(idToken);

        req.firebaseUser = decodedToken;

        next();

    } catch (error) {
        console.error("Erreur authentification Firebase :", error);

        return res.status(401).json({
            success: false,
            error: "Token Firebase invalide ou expiré"
        });
    }
}