const { auth, db } = require('../config/firebase');

const verifyToken = async (req, res, next) => {
    const sessionCookie = req.cookies.authToken || '';
    
    try {
        const decodedClaims = await auth.verifySessionCookie(sessionCookie, true);
        
        if (!decodedClaims.email_verified) {
             return res.status(403).json({ message: 'Verifique seu email.' });
        }

        const userDoc = await db.collection('users').doc(decodedClaims.uid).get();
        req.user = { ...decodedClaims, ...userDoc.data() };
        
        next();
    } catch (error) {
        res.status(401).json({ message: 'Sessão expirada. Faça login novamente.' });
    }
};

const optionalVerify = async (req, res, next) => {
    const sessionCookie = req.cookies.authToken || '';
    if (sessionCookie) {
        try {
            const decodedClaims = await auth.verifySessionCookie(sessionCookie, true);
            req.user = decodedClaims;
        } catch (e) {}
    }
    next();
};

const requireTerms = (req, res, next) => {
    const CURRENT_TERMS_VERSION = '1.0'; 
    if (req.user && req.user.termsVersion !== CURRENT_TERMS_VERSION) {
        return res.status(403).json({ code: 'TERMS_NOT_ACCEPTED', message: 'É necessário aceitar os novos termos de uso.' });
    }
    next();
};

module.exports = { verifyToken, optionalVerify, requireTerms };