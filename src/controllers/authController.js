const axios = require('axios');
const { auth, db } = require('../config/firebase');
const admin = require('firebase-admin');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const { containsProfanity } = require('../utils/profanity');

const isProduction = process.env.NODE_ENV === 'production';

const cookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax',
};

async function verifyTurnstile(token, ip) {
  if (!isProduction && token === '1x00000000000000000000AA') return true;
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: process.env.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: ip,
      }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json();
    return data.success === true;
  } catch {
    return false;
  }
}

function generateUsername(displayName, uid) {
  const base = (displayName || 'user')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 20);
  const suffix = uid.slice(-5).toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${base || 'user'}${suffix}`;
}

async function deleteCollectionData(collectionName, userId) {
  const batchSize = 400;
  while (true) {
    const snapshot = await db
      .collection(collectionName)
      .where('userId', '==', userId)
      .limit(batchSize)
      .get();
    if (snapshot.empty) break;
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function deleteSubcollections(userRef) {
  const subcollections = ['lists', 'followers', 'following', 'history'];
  const batchSize = 400;
  for (const sub of subcollections) {
    while (true) {
      const snapshot = await userRef.collection(sub).limit(batchSize).get();
      if (snapshot.empty) break;
      const batch = db.batch();
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

async function syncUsernameAndPhoto(uid, newUsername, newPhoto) {
  const collections = ['reviews', 'comments', 'shared_lists'];
  const batchSize = 400;
  for (const col of collections) {
    let lastDoc = null;
    while (true) {
      let query = db.collection(col).where('userId', '==', uid).limit(batchSize);
      if (lastDoc) query = query.startAfter(lastDoc);
      const snapshot = await query.get();
      if (snapshot.empty) break;
      const batch = db.batch();
      snapshot.docs.forEach((doc) => {
        const updates = {};
        if (newUsername !== undefined) updates.username = newUsername;
        if (newPhoto !== undefined) updates.userPhoto = newPhoto;
        if (Object.keys(updates).length > 0) batch.update(doc.ref, updates);
      });
      await batch.commit();
      lastDoc = snapshot.docs[snapshot.docs.length - 1];
      if (snapshot.docs.length < batchSize) break;
    }
  }
}

exports.register = catchAsync(async (req, res, next) => {
  const { email, password, name, nickname, turnstileToken } = req.body;

  const turnstileValid = await verifyTurnstile(turnstileToken, req.ip);
  if (!turnstileValid) return next(new AppError('Verificação de segurança falhou.', 400));

  if (containsProfanity(name) || containsProfanity(nickname)) {
    return next(new AppError('Nome ou Nickname impróprio.', 400));
  }

  const checkUser = await db.collection('users').where('username', '==', nickname).get();
  if (!checkUser.empty) return next(new AppError('Este nickname já está em uso.', 400));

  const userRecord = await auth.createUser({
    email,
    password,
    displayName: name,
    emailVerified: false,
  });

  const CURRENT_TERMS_VERSION = '2.0';
  await db.collection('users').doc(userRecord.uid).set({
    name,
    username: nickname,
    email,
    provider: 'email',
    createdAt: new Date(),
    role: 'user',
    levelTitle: 'Espectador',
    reviewsCount: 0,
    genreCounts: {},
    termsVersion: CURRENT_TERMS_VERSION,
    termsAcceptedAt: new Date(),
    termsAcceptedUserAgent: req.headers['user-agent'] || 'unknown',
    photoURL: null,
    backgroundURL: null,
    bio: null,
    lastUsernameChange: null,
    level: 1,
    totalXp: 0,
    xp: 0,
    followersCount: 0,
    followingCount: 0,
    watchedCount: 0,
    likesCount: 0,
  });

  const apiKey = env.FIREBASE_WEB_API_KEY;
  try {
    const customToken = await auth.createCustomToken(userRecord.uid);
    const signResp = await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
      { token: customToken, returnSecureToken: true }
    );
    const idToken = signResp.data.idToken;
    if (!idToken) throw new Error('No idToken from signInWithCustomToken');
    await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`,
      { requestType: 'VERIFY_EMAIL', idToken }
    );
  } catch (emailError) {
    const errInfo = emailError.response ? emailError.response.data : emailError;
    const { sendAlert } = require('../services/telegramService');
    const logger = require('../utils/logger');
    logger.error('sending verification email failed: %o', errInfo);
    if (isProduction)
      sendAlert(
        `Falha ao enviar email de verificacao. Erro: ${errInfo.message || JSON.stringify(errInfo)}`
      );
    try {
      const link = await admin.auth().generateEmailVerificationLink(email);
      await sendAlert(`Verification link generated: ${link}`);
    } catch (adminErr) {
      logger.error('generateEmailVerificationLink failed: %o', adminErr);
    }
  }

  res.status(201).json({ username: nickname, message: 'Usuário criado. Verifique seu email.' });
});

exports.login = catchAsync(async (req, res, next) => {
  const { email, password, turnstileToken } = req.body;

  const turnstileValid = await verifyTurnstile(turnstileToken, req.ip);
  if (!turnstileValid) return next(new AppError('Verificação de segurança falhou.', 400));

  const apiKey = env.FIREBASE_WEB_API_KEY;
  try {
    const response = await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      { email, password, returnSecureToken: true }
    );

    const userInfo = await auth.getUser(response.data.localId);
    if (!userInfo.emailVerified) return next(new AppError('Email não verificado.', 403));

    const idToken = response.data.idToken;
    const expiresIn = 60 * 60 * 24 * 5 * 1000;
    const sessionCookie = await auth.createSessionCookie(idToken, { expiresIn });

    res.cookie('authToken', sessionCookie, { ...cookieOptions, maxAge: expiresIn });

    const userDoc = await db.collection('users').doc(response.data.localId).get();
    const userData = userDoc.data();

    res.status(200).json({
      uid: response.data.localId,
      username: userData?.username,
      photoURL: userData?.photoURL,
      name: userData?.name,
      termsVersion: userData?.termsVersion,
    });
  } catch {
    return next(new AppError('Credenciais inválidas.', 401));
  }
});

exports.googleAuth = catchAsync(async (req, res, next) => {
  const { idToken } = req.body;
  if (!idToken) return next(new AppError('Token do Google ausente.', 400));

  let decoded;
  try {
    decoded = await auth.verifyIdToken(idToken);
  } catch {
    return next(new AppError('Token do Google inválido.', 401));
  }

  const { uid, email, name, picture } = decoded;
  const CURRENT_TERMS_VERSION = '2.0';
  const expiresIn = 60 * 60 * 24 * 5 * 1000;

  const userRef = db.collection('users').doc(uid);
  const userDoc = await userRef.get();

  let userData;

  if (!userDoc.exists) {
    const baseUsername = generateUsername(name, uid);
    const existing = await db
      .collection('users')
      .where('username', '==', baseUsername)
      .limit(1)
      .get();
    const finalUsername = existing.empty
      ? baseUsername
      : `${baseUsername}${Math.floor(Math.random() * 900 + 100)}`;

    userData = {
      name: name || 'Usuário',
      username: finalUsername,
      email: email || null,
      provider: 'google',
      createdAt: new Date(),
      role: 'user',
      levelTitle: 'Espectador',
      reviewsCount: 0,
      genreCounts: {},
      termsVersion: CURRENT_TERMS_VERSION,
      termsAcceptedAt: new Date(),
      termsAcceptedUserAgent: req.headers['user-agent'] || 'unknown',
      photoURL: picture || null,
      backgroundURL: null,
      bio: null,
      lastUsernameChange: null,
      level: 1,
      totalXp: 0,
      xp: 0,
      followersCount: 0,
      followingCount: 0,
      watchedCount: 0,
      likesCount: 0,
    };

    await userRef.set(userData);
  } else {
    userData = userDoc.data();
    if (picture && !userData.photoURL) {
      await userRef.update({ photoURL: picture });
      userData = { ...userData, photoURL: picture };
    }
  }

  const sessionCookie = await auth.createSessionCookie(idToken, { expiresIn });
  res.cookie('authToken', sessionCookie, { ...cookieOptions, maxAge: expiresIn });

  res.status(200).json({
    uid,
    username: userData.username,
    photoURL: userData.photoURL,
    name: userData.name,
    termsVersion: userData.termsVersion,
  });
});

exports.logout = (req, res) => {
  res.clearCookie('authToken', cookieOptions);
  res.status(200).json({ message: 'Logout realizado.' });
};

exports.getMe = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const doc = await db.collection('users').doc(uid).get();
  if (!doc.exists) return next(new AppError('Usuário não encontrado', 404));
  const d = doc.data();
  res.status(200).json({
    uid,
    name: d.name,
    username: d.username,
    email: d.email,
    photoURL: d.photoURL,
    backgroundURL: d.backgroundURL,
    bio: d.bio,
    level: d.level,
    levelTitle: d.levelTitle,
    xp: d.xp,
    totalXp: d.totalXp,
    reviewsCount: d.reviewsCount,
    watchedCount: d.watchedCount,
    followersCount: d.followersCount,
    followingCount: d.followingCount,
    genreCounts: d.genreCounts || {},
    termsVersion: d.termsVersion,
  });
});

exports.updateProfile = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const { bio, photoURL, backgroundURL, username } = req.body;

  if ((bio && containsProfanity(bio)) || (username && containsProfanity(username))) {
    return next(new AppError('Conteúdo impróprio.', 400));
  }

  const userRef = db.collection('users').doc(uid);
  let usernameChanged = null;
  let photoChanged = null;

  try {
    await db.runTransaction(async (t) => {
      const doc = await t.get(userRef);
      if (!doc.exists) throw new Error('USER_NOT_FOUND');

      const userData = doc.data();
      const updates = {};
      const history = {};

      if (username && username !== userData.username) {
        const checkSnapshot = await db
          .collection('users')
          .where('username', '==', username)
          .limit(1)
          .get();
        if (!checkSnapshot.empty && checkSnapshot.docs[0].id !== uid)
          throw new Error('USERNAME_TAKEN');

        if (userData.lastUsernameChange) {
          const diff = new Date() - userData.lastUsernameChange.toDate();
          const days = diff / (1000 * 60 * 60 * 24);
          if (days < 30) throw new Error(`WAIT_${Math.ceil(30 - days)}_DAYS`);
        }
        updates.username = username;
        updates.lastUsernameChange = new Date();
        history.username = { from: userData.username || null, to: username };
        usernameChanged = username;
      }

      if (bio !== undefined) {
        updates.bio = bio;
        history.bio = { from: userData.bio || null, to: bio };
      }
      if (photoURL !== undefined) {
        updates.photoURL = photoURL;
        history.photoURL = { from: userData.photoURL || null, to: photoURL };
        photoChanged = photoURL;
      }
      if (backgroundURL !== undefined) {
        updates.backgroundURL = backgroundURL;
        history.backgroundURL = { from: userData.backgroundURL || null, to: backgroundURL };
      }

      if (Object.keys(updates).length > 0) {
        updates.updatedAt = new Date();
        t.update(userRef, updates);
        const auditRef = userRef.collection('history').doc();
        t.set(auditRef, {
          changes: history,
          timestamp: new Date(),
          userAgent: req.headers['user-agent'] || 'unknown',
        });
      }
    });

    if (usernameChanged || photoChanged !== null) {
      syncUsernameAndPhoto(uid, usernameChanged, photoChanged).catch((err) => {
        require('../utils/logger').error('syncUsernameAndPhoto failed: %o', err);
      });
    }

    res.status(200).json({ message: 'Perfil atualizado.' });
  } catch (error) {
    if (error.message === 'USERNAME_TAKEN') return next(new AppError('Username em uso.', 400));
    if (error.message?.startsWith('WAIT_')) {
      const days = error.message.split('_')[1];
      return next(new AppError(`Aguarde ${days} dia(s) para trocar o username novamente.`, 400));
    }
    throw error;
  }
});

exports.getPublicProfile = catchAsync(async (req, res, next) => {
  const { username } = req.params;
  const snapshot = await db.collection('users').where('username', '==', username).limit(1).get();
  if (snapshot.empty) return next(new AppError('Não encontrado.', 404));
  const rawData = snapshot.docs[0].data();
  res.status(200).json({
    name: rawData.name,
    username: rawData.username,
    photoURL: rawData.photoURL,
    backgroundURL: rawData.backgroundURL,
    bio: rawData.bio,
    level: rawData.level || 1,
    levelTitle: rawData.levelTitle || 'Espectador',
    totalXp: rawData.totalXp || 0,
    reviewsCount: rawData.reviewsCount || 0,
    watchedCount: rawData.watchedCount || 0,
    followersCount: rawData.followersCount || 0,
    followingCount: rawData.followingCount || 0,
    createdAt: rawData.createdAt,
    trophies: rawData.trophies || [],
    genreCounts: rawData.genreCounts || {},
  });
});

exports.resetPassword = catchAsync(async (req, res, next) => {
  const { email } = req.body;
  if (!email) return res.status(200).json({ message: 'Iniciado.' });
  const userQuery = await db.collection('users').where('email', '==', email).limit(1).get();
  if (!userQuery.empty) {
    const apiKey = env.FIREBASE_WEB_API_KEY;
    await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`,
      { requestType: 'PASSWORD_RESET', email }
    );
  }
  res.status(200).json({ message: 'Solicitação recebida.' });
});

exports.deleteAccount = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  await deleteCollectionData('reviews', uid);
  await deleteCollectionData('comments', uid);
  await deleteCollectionData('interactions', uid);
  await deleteCollectionData('shared_lists', uid);
  const userRef = db.collection('users').doc(uid);
  await deleteSubcollections(userRef);
  await userRef.delete();
  await admin.auth().deleteUser(uid);
  res.status(200).json({ message: 'Excluído com sucesso.' });
});