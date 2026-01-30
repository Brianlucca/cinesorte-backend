const { auth, db } = require('../config/firebase');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');

const verifyToken = catchAsync(async (req, res, next) => {
  const sessionCookie = req.cookies.authToken;
  if (!sessionCookie) return next(new AppError('Acesso negado. Faça login.', 401));

  try {
    const decodedClaims = await auth.verifySessionCookie(sessionCookie, true);
    if (!decodedClaims.email_verified) return next(new AppError('Verifique seu email.', 403));
    
    const userDoc = await db.collection("users").doc(decodedClaims.uid).get();
    if (!userDoc.exists) return next(new AppError('Usuário não encontrado.', 404));

    const userData = userDoc.data();
    req.user = { 
        uid: decodedClaims.uid, 
        email: decodedClaims.email,
        username: userData.username,
        photoURL: userData.photoURL,
        role: userData.role,
        termsVersion: userData.termsVersion
    };
    next();
  } catch (error) {
    res.clearCookie("authToken");
    return next(new AppError('Sessão inválida.', 401));
  }
});

const optionalVerify = catchAsync(async (req, res, next) => {
  const sessionCookie = req.cookies.authToken;
  if (sessionCookie) {
    try {
      const decodedClaims = await auth.verifySessionCookie(sessionCookie, true);
      req.user = { uid: decodedClaims.uid };
    } catch (e) {
      req.user = null;
    }
  }
  next();
});

const requireTerms = (req, res, next) => {
  const CURRENT_TERMS_VERSION = '1.0';
  if (!req.user || req.user.termsVersion !== CURRENT_TERMS_VERSION) {
    return next(new AppError('Aceite os novos termos.', 403));
  }
  next();
};

module.exports = { verifyToken, optionalVerify, requireTerms };