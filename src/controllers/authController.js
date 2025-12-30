const { auth, db } = require('../config/firebase');
const axios = require('axios');
const { validateEmail, validatePassword } = require('../middleware/securityMiddleware');

const sendFirebaseVerificationEmail = async (uid, email) => {
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  
  try {
    const customToken = await auth.createCustomToken(uid);

    const signInResponse = await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
      {
        token: customToken,
        returnSecureToken: true
      }
    );
    
    const idToken = signInResponse.data.idToken;

    await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`,
      {
        requestType: "VERIFY_EMAIL",
        idToken: idToken
      }
    );
    
    return true;
  } catch (error) {
    throw new Error('Falha ao enviar e-mail de verificação.');
  }
};

const register = async (req, res) => {
  const { email, password, name, nickname } = req.body;

  if (!validateEmail(email)) {
    return res.status(400).json({ message: 'Formato de email inválido.' });
  }
  if (!validatePassword(password)) {
    return res.status(400).json({ message: 'A senha deve ter no mínimo 6 caracteres.' });
  }
  if (!name || name.trim().length < 2) {
    return res.status(400).json({ message: 'Nome inválido.' });
  }

  try {
    const userRecord = await auth.createUser({
      email,
      password,
      displayName: name,
      emailVerified: false 
    });

    await db.collection('users').doc(userRecord.uid).set({
      name: name,
      nickname: nickname || name,
      email: email,
      createdAt: new Date(),
      role: 'user',
      photoURL: null,
      bio: ''
    });

    await sendFirebaseVerificationEmail(userRecord.uid, email);

    res.status(201).json({ 
      uid: userRecord.uid, 
      email: userRecord.email, 
      message: 'Usuário criado e salvo no banco! Verifique seu e-mail.' 
    });
  } catch (error) {
    let message = 'Erro ao registrar usuário.';
    if (error.code === 'auth/email-already-exists') {
      message = 'Este email já está em uso.';
    }
    res.status(500).json({ message, code: error.code });
  }
};

const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email e senha são obrigatórios.' });
  }

  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;

  try {
    const response = await axios.post(url, {
      email,
      password,
      returnSecureToken: true,
    });
    
    const userRecord = await auth.getUser(response.data.localId);
    
    if (!userRecord.emailVerified) {
      return res.status(403).json({ message: 'Seu email ainda não foi verificado.' });
    }

    const token = response.data.idToken;

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
    };

    res.cookie('authToken', token, cookieOptions);

    res.status(200).json({
      uid: response.data.localId,
      email: response.data.email,
      name: response.data.displayName,
    });
  } catch (error) {
    res.status(401).json({ message: 'Credenciais inválidas ou erro no login.' });
  }
};

const logout = (req, res) => {
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    expires: new Date(0),
  };

  res.cookie('authToken', '', cookieOptions);
  res.status(200).json({ message: 'Logout realizado com sucesso.' });
};

const getMe = async (req, res) => {
    const { uid, email, name, email_verified } = req.user;
    res.status(200).json({ 
      uid, 
      email, 
      name, 
      emailVerified: email_verified 
    });
};

module.exports = {
  register,
  login,
  logout,
  getMe,
};