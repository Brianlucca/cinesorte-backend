const axios = require('axios');
const { auth, db } = require('../config/firebase');
const admin = require('firebase-admin');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const { containsProfanity } = require('../utils/profanity');

async function deleteCollectionData(collectionName, userId) {
  const batchSize = 400;
  while (true) {
    const snapshot = await db.collection(collectionName).where("userId", "==", userId).limit(batchSize).get();
    if (snapshot.empty) break;
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function deleteSubcollections(userRef) {
  const subcollections = ["lists", "followers", "following", "history"];
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

exports.register = catchAsync(async (req, res, next) => {
  try {
    const { email, password, name, nickname } = req.body;
    
    if (containsProfanity(name) || containsProfanity(nickname)) {
      return next(new AppError('Nome ou Nickname impróprio.', 400));
    }

    const checkUser = await db.collection("users").where("username", "==", nickname).get();
    if (!checkUser.empty) {
      return next(new AppError('Este nickname já está em uso.', 400));
    }

    let userRecord;
    try {
      userRecord = await auth.createUser({
        email,
        password,
        displayName: name,
        emailVerified: false,
      });
    } catch (err) {
      throw err;
    }

    const CURRENT_TERMS_VERSION = "1.0";
    await db.collection("users").doc(userRecord.uid).set({
      name,
      username: nickname,
      email,
      createdAt: new Date(),
      role: "user",
      levelTitle: "Espectador",
      reviewsCount: 0,
      genreCounts: {},
      termsVersion: CURRENT_TERMS_VERSION,
      termsAcceptedAt: new Date(),
      termsAcceptedUserAgent: req.headers["user-agent"] || "unknown",
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
      const oobResp = await axios.post(
        `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`,
        { requestType: "VERIFY_EMAIL", idToken }
      );
    } catch (emailError) {
      const errInfo = emailError.response ? emailError.response.data : emailError;
      const { sendAlert } = require('../services/telegramService');
      const logger = require('../utils/logger');
      logger.error('sending verification email failed: %o', errInfo);
      if (process.env.NODE_ENV === 'production') sendAlert(`Falha ao enviar email de verificacao. Erro: ${errInfo.message || JSON.stringify(errInfo)}`);
      try {
        const link = await admin.auth().generateEmailVerificationLink(email);
        await sendAlert(`Verification link generated: ${link}`);
      } catch (adminErr) {
        logger.error('generateEmailVerificationLink failed: %o', adminErr);
      }
    }
    res.status(201).json({ username: nickname, message: "Usuário criado. Verifique seu email." });
  } catch (err) {
    throw err;
  }
});

exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;
  const apiKey = env.FIREBASE_WEB_API_KEY;
  
  try {
    const response = await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      { email, password, returnSecureToken: true }
    );
    
    const userInfo = await auth.getUser(response.data.localId);
    if (!userInfo.emailVerified) {
      return next(new AppError('Email não verificado.', 403));
    }

    const idToken = response.data.idToken;
    const expiresIn = 60 * 60 * 24 * 5 * 1000;
    const sessionCookie = await auth.createSessionCookie(idToken, { expiresIn });
    
    const options = {
      maxAge: expiresIn,
      httpOnly: true,
      secure: true,
      sameSite: "none",
    };

    res.cookie("authToken", sessionCookie, options);
    const userDoc = await db.collection("users").doc(response.data.localId).get();
    const userData = userDoc.data();
    
    res.status(200).json({
      uid: response.data.localId,
      username: userData?.username,
      photoURL: userData?.photoURL,
      name: userData?.name,
      termsVersion: userData?.termsVersion 
    });
  } catch (error) {
    return next(new AppError('Credenciais inválidas.', 401));
  }
});

exports.logout = (req, res) => {
  res.clearCookie("authToken");
  res.status(200).json({ message: "Logout realizado." });
};

exports.getMe = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const doc = await db.collection("users").doc(uid).get();
  if (!doc.exists) return next(new AppError('Usuário não encontrado', 404));
  
  const d = doc.data();
  res.status(200).json({
    uid: uid,
    name: d.name,
    username: d.username,
    email: d.email, 
    photoURL: d.photoURL,
    backgroundURL: d.backgroundURL,
    level: d.level,
    levelTitle: d.levelTitle,
    xp: d.xp,
    totalXp: d.totalXp,
    reviewsCount: d.reviewsCount,
    watchedCount: d.watchedCount,
    followersCount: d.followersCount,
    followingCount: d.followingCount,
    genreCounts: d.genreCounts || {},
    termsVersion: d.termsVersion 
  });
});

exports.updateProfile = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const { bio, photoURL, backgroundURL, username } = req.body;
  
  if ((bio && containsProfanity(bio)) || (username && containsProfanity(username))) {
    return next(new AppError('Conteúdo impróprio.', 400));
  }

  const userRef = db.collection("users").doc(uid);
  
  try {
    await db.runTransaction(async (t) => {
      const doc = await t.get(userRef);
      if (!doc.exists) throw new Error("USER_NOT_FOUND");
      
      const userData = doc.data();
      const updates = {};
      const history = {};
      
      if (username && username !== userData.username) {
        const checkSnapshot = await t.get(db.collection("users").where("username", "==", username).limit(1));
        if (!checkSnapshot.empty && checkSnapshot.docs[0].id !== uid) throw new Error("USERNAME_TAKEN");
        
        if (userData.lastUsernameChange) {
          const diff = new Date() - userData.lastUsernameChange.toDate();
          const days = diff / (1000 * 60 * 60 * 24);
          if (days < 30) throw new Error(`WAIT_${Math.ceil(30 - days)}_DAYS`);
        }
        updates.username = username;
        updates.lastUsernameChange = new Date();
        history.username = { from: userData.username || null, to: username };
      }
      
      if (bio !== undefined) {
        updates.bio = bio;
        history.bio = { from: userData.bio || null, to: bio };
      }
      if (photoURL !== undefined) {
        updates.photoURL = photoURL;
        history.photoURL = { from: userData.photoURL || null, to: photoURL };
      }
      if (backgroundURL !== undefined) {
        updates.backgroundURL = backgroundURL;
        history.backgroundURL = { from: userData.backgroundURL || null, to: backgroundURL };
      }
      
      if (Object.keys(updates).length > 0) {
        updates.updatedAt = new Date();
        t.update(userRef, updates);
        const auditRef = userRef.collection("history").doc();
        t.set(auditRef, {
          changes: history,
          timestamp: new Date(),
          userAgent: req.headers["user-agent"] || "unknown",
        });
      }
    });
    res.status(200).json({ message: "Perfil atualizado." });
  } catch (error) {
    if (error.message === "USERNAME_TAKEN") return next(new AppError('Username em uso.', 400));
    throw error;
  }
});

exports.getPublicProfile = catchAsync(async (req, res, next) => {
  const { username } = req.params;
  const snapshot = await db.collection("users").where("username", "==", username).limit(1).get();
  
  if (snapshot.empty) return next(new AppError('Não encontrado.', 404));
  
  const userDoc = snapshot.docs[0];
  const rawData = userDoc.data();
  
  res.status(200).json({
    name: rawData.name,
    username: rawData.username,
    photoURL: rawData.photoURL,
    backgroundURL: rawData.backgroundURL,
    bio: rawData.bio,
    level: rawData.level || 1,
    levelTitle: rawData.levelTitle || "Espectador",
    totalXp: rawData.totalXp || 0,
    reviewsCount: rawData.reviewsCount || 0,
    watchedCount: rawData.watchedCount || 0,
    followersCount: rawData.followersCount || 0,
    followingCount: rawData.followingCount || 0,
    createdAt: rawData.createdAt,
    trophies: rawData.trophies || [],
    genreCounts: rawData.genreCounts || {}
  });
});

exports.resetPassword = catchAsync(async (req, res, next) => {
  const { email } = req.body;
  if (!email) return res.status(200).json({ message: "Iniciado." });
  
  const userQuery = await db.collection("users").where("email", "==", email).limit(1).get();
  if (!userQuery.empty) {
    const apiKey = env.FIREBASE_WEB_API_KEY;
    await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`,
      { requestType: "PASSWORD_RESET", email: email }
    );
  }
  res.status(200).json({ message: "Solicitação recebida." });
});

exports.deleteAccount = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  await deleteCollectionData("reviews", uid);
  await deleteCollectionData("comments", uid);
  await deleteCollectionData("interactions", uid);
  await deleteCollectionData("shared_lists", uid);
  const userRef = db.collection("users").doc(uid);
  await deleteSubcollections(userRef);
  await userRef.delete();
  await admin.auth().deleteUser(uid);
  res.status(200).json({ message: "Excluído com sucesso." });
});