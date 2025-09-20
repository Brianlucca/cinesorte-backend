const { auth } = require('../config/firebase');

const verifyToken = async (req, res, next) => {
  const authorizationHeader = req.headers.authorization;
  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    return res.status(403).json({ message: 'Acesso não autorizado. Token não fornecido.' });
  }

  const idToken = authorizationHeader.split('Bearer ')[1];
  try {
    const decodedToken = await auth.verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Erro ao verificar token:', error);
    return res.status(403).json({ message: 'Token inválido ou expirado.' });
  }
};

module.exports = { verifyToken };