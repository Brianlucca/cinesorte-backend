const { auth } = require('../config/firebase');

const verifyToken = async (req, res, next) => {
  const token = req.cookies.authToken;
  if (!token) {
    return res.status(403).json({ message: 'Unauthorized access' });
  }

  try {
    const decodedToken = await auth.verifyIdToken(token);
    
    if (!decodedToken.email_verified) {
      return res.status(403).json({ message: 'Email verification required' });
    }

    req.user = decodedToken;
    next();
  } catch (error) {
    return res.status(403).json({ message: 'Invalid or expired token' });
  }
};

module.exports = { verifyToken };