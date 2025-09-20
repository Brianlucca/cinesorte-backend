const { auth } = require('../config/firebase');
const axios = require('axios');

const register = async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ message: 'Nome, email e senha são obrigatórios.' });
  }
  try {
    const userRecord = await auth.createUser({
      email: email,
      password: password,
      displayName: name,
    });
    res.status(201).json({ uid: userRecord.uid, email: userRecord.email, name: userRecord.displayName });
  } catch (error) {
    let message = 'Erro ao registrar usuário.';
    if (error.code === 'auth/email-already-exists') {
      message = 'Este email já está em uso.';
    } else if (error.code === 'auth/invalid-password') {
      message = 'A senha deve ter no mínimo 6 caracteres.';
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
      email: email,
      password: password,
      returnSecureToken: true,
    });
    
    const token = response.data.idToken;

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    };

    if (process.env.NODE_ENV === 'production') {
      cookieOptions.sameSite = 'none';
    }

    res.cookie('authToken', token, cookieOptions);

    res.status(200).json({
      uid: response.data.localId,
      email: response.data.email,
      name: response.data.displayName,
    });
  } catch (error) {
    res.status(401).json({ message: 'Email ou senha inválidos.' });
  }
};

const logout = (req, res) => {
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    expires: new Date(0),
  };

  if (process.env.NODE_ENV === 'production') {
    cookieOptions.sameSite = 'none';
  }

  res.cookie('authToken', '', cookieOptions);
  res.status(200).json({ message: 'Logout bem-sucedido.' });
};

const getMe = async (req, res) => {
    const { uid, email, name } = req.user;
    res.status(200).json({ uid, email, name });
};

module.exports = {
  register,
  login,
  logout,
  getMe,
};