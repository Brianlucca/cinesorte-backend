const axios = require("axios");
const admin = require("firebase-admin");

const { auth, db } = require("../config/firebase");
const env = require("../config/env");
const {
  AUTH_COOKIE_NAME,
  LEGACY_AUTH_COOKIE_NAME,
  SESSION_MAX_AGE_MS,
  sessionCookieOptions,
} = require("../config/cookies");
const { getSessionCookie, clearSessionCookies } = require("../middleware/auth");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");
const logger = require("../utils/logger");
const { containsProfanity } = require("../utils/profanity");

const { resendVerificationEmailForAddress } = require("../services/emailVerificationResendService");

const isProduction = env.NODE_ENV === "production";
const CURRENT_TERMS_VERSION = "4.0";
const ACCOUNT_DELETION_REQUESTS = "account_deletion_requests";
const RECENT_LOGIN_MAX_AGE_MS = 5 * 60 * 1000;

const setNoStore = (res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
};

const logAuthEvent = (req, event, details = {}) => {
  logger.info("auth_event", {
    event,
    ip: req.ip || "unknown",
    userAgent: req.headers["user-agent"] || "unknown",
    route: req.originalUrl,
    method: req.method,
    ...details,
  });
};

const sendFirebasePasswordResetEmail = async (email) => {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${env.FIREBASE_WEB_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestType: "PASSWORD_RESET",
        email,
        continueUrl: `${env.FRONTEND_URL.replace(/\/$/, "")}/login`,
      }),
      signal: AbortSignal.timeout(10000),
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || "firebase_password_reset_failed");
  }

  return data;
};

const sendFirebaseVerificationEmailByUid = async (uid) => {
  const customToken = await auth.createCustomToken(uid);
  const signInResponse = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${env.FIREBASE_WEB_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: customToken,
        returnSecureToken: true,
      }),
      signal: AbortSignal.timeout(10000),
    }
  );

  const signInData = await signInResponse.json().catch(() => ({}));
  if (!signInResponse.ok || !signInData.idToken) {
    throw new Error(signInData?.error?.message || "firebase_custom_token_sign_in_failed");
  }

  const sendResponse = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${env.FIREBASE_WEB_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestType: "VERIFY_EMAIL",
        idToken: signInData.idToken,
        continueUrl: `${env.FRONTEND_URL.replace(/\/$/, "")}/login`,
      }),
      signal: AbortSignal.timeout(10000),
    }
  );

  const sendData = await sendResponse.json().catch(() => ({}));
  if (!sendResponse.ok) {
    throw new Error(sendData?.error?.message || "firebase_verification_email_failed");
  }

  return sendData;
};

async function verifyTurnstile(token, ip) {
  if (!isProduction && token === "1x00000000000000000000AA") return true;

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
  const base = (displayName || "user")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 20);
  const suffix = uid.slice(-5).toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${base || "user"}${suffix}`;
}

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

async function syncUsernameAndPhoto(uid, newUsername, newPhoto) {
  const collections = ["reviews", "comments", "shared_lists"];
  const batchSize = 400;

  for (const col of collections) {
    let lastDoc = null;

    while (true) {
      let query = db.collection(col).where("userId", "==", uid).limit(batchSize);
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

async function deleteAccountData(uid) {
  const userRef = db.collection("users").doc(uid);

  await deleteCollectionData("reviews", uid);
  await deleteCollectionData("comments", uid);
  await deleteCollectionData("interactions", uid);
  await deleteCollectionData("shared_lists", uid);

  await deleteSubcollections(userRef);
  await deleteAccountDeletionRequests(uid);
  await userRef.delete();
  await admin.auth().deleteUser(uid);
}

async function deleteAccountDeletionRequests(uid) {
  const snapshot = await db.collection(ACCOUNT_DELETION_REQUESTS).where("uid", "==", uid).limit(50).get();
  if (snapshot.empty) return;

  const batch = db.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

exports.register = catchAsync(async (req, res, next) => {
  const { email, password, name, nickname, turnstileToken } = req.body;

  const turnstileValid = await verifyTurnstile(turnstileToken, req.ip);
  if (!turnstileValid) return next(new AppError("Verificação de segurança falhou.", 400));

  if (containsProfanity(name)) {
    return next(new AppError("O nome contém conteúdo impróprio. Revise esse campo.", 400));
  }

  if (containsProfanity(nickname)) {
    return next(new AppError("O nickname contém conteúdo impróprio. Revise esse campo.", 400));
  }

  const checkUser = await db.collection("users").where("username", "==", nickname).limit(1).get();
  if (!checkUser.empty) {
    return next(new AppError("Este username já está em uso.", 400));
  }

  const userRecord = await auth.createUser({
    email,
    password,
    displayName: name,
    emailVerified: false,
  });

  const userRef = db.collection("users").doc(userRecord.uid);

  await userRef.set({
    name,
    username: nickname,
    email,
    provider: "email",
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
    likedMediaIds: [],
  });

  try {
    await sendFirebaseVerificationEmailByUid(userRecord.uid);

    await userRef.set(
      {
        verificationEmailLastSentAt: admin.firestore.Timestamp.now(),
        verificationEmailLastStatus: "sent",
        verificationEmailLastError: null,
        verificationEmailProvider: "firebase",
        verificationEmailResendCount: 0,
        updatedAt: new Date(),
      },
      { merge: true }
    );
  } catch (emailError) {
    const { sendAlert } = require("../services/telegramService");
    const errInfo = emailError.response ? emailError.response.data : emailError;
    logger.error("firebase verification email failed: %o", errInfo);

    await userRef.set(
      {
        verificationEmailLastSentAt: admin.firestore.Timestamp.now(),
        verificationEmailLastStatus: "failed",
        verificationEmailLastError: errInfo.message || JSON.stringify(errInfo),
        verificationEmailResendCount: 0,
        updatedAt: new Date(),
      },
      { merge: true }
    );

    if (isProduction) {
      sendAlert(
        `Falha ao enviar email de confirmação de conta. Erro: ${
          errInfo.message || JSON.stringify(errInfo)
        }`
      );
    }
  }

  logAuthEvent(req, "register_success", { uid: userRecord.uid, email, username: nickname });
  setNoStore(res);
  res.status(201).json({ username: nickname, message: "Usuário criado. Verifique seu email." });
});

exports.login = catchAsync(async (req, res, next) => {
  const { email, password, turnstileToken } = req.body;

  const turnstileValid = await verifyTurnstile(turnstileToken, req.ip);
  if (!turnstileValid) return next(new AppError("Verificação de segurança falhou.", 400));

  const apiKey = env.FIREBASE_WEB_API_KEY;

  try {
    const response = await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      { email, password, returnSecureToken: true }
    );

    const userInfo = await auth.getUser(response.data.localId);
    if (!userInfo.emailVerified) return next(new AppError("Email não verificado.", 403));

    const userRef = db.collection("users").doc(response.data.localId);
    const userDoc = await userRef.get();
    const userData = userDoc.data() || {};

    if (userInfo.emailVerified && !userData.emailConfirmedAt) {
      await userRef.set({ emailConfirmedAt: new Date() }, { merge: true });
    }

    const idToken = response.data.idToken;
    const sessionCookie = await auth.createSessionCookie(idToken, { expiresIn: SESSION_MAX_AGE_MS });

    res.cookie(AUTH_COOKIE_NAME, sessionCookie, sessionCookieOptions);
    if (AUTH_COOKIE_NAME !== LEGACY_AUTH_COOKIE_NAME) {
      res.clearCookie(LEGACY_AUTH_COOKIE_NAME, sessionCookieOptions);
    }

    logAuthEvent(req, "login_success", { uid: response.data.localId, email, username: userData.username || null });
    setNoStore(res);
    res.status(200).json({
      uid: response.data.localId,
      username: userData.username,
      photoURL: userData.photoURL,
      name: userData.name,
      termsVersion: userData.termsVersion,
    });
  } catch (error) {
    logAuthEvent(req, "login_failed", {
      email,
      reason: error?.response?.data?.error?.message || error?.message || "invalid_credentials",
    });
    return next(new AppError("Credenciais inválidas.", 401));
  }
});

exports.resendVerificationEmail = catchAsync(async (req, res) => {
  const { email } = req.body;

  try {
    const result = await resendVerificationEmailForAddress({ email });
    logAuthEvent(req, "verification_email_resend_requested", {
      email,
      status: result.status,
      reason: result.reason || null,
    });
  } catch (error) {
    logger.error("verification email resend request failed: %s", error.message || error);
    logAuthEvent(req, "verification_email_resend_requested", {
      email,
      status: "failed",
      reason: error.message || "unknown_error",
    });
  }

  setNoStore(res);
  res.status(200).json({
    message: "Se houver uma conta pendente para este email, enviaremos uma nova confirmação.",
  });
});

exports.googleAuth = catchAsync(async (req, res, next) => {
  const { idToken } = req.body;
  if (!idToken) return next(new AppError("Token do Google ausente.", 400));

  let decoded;
  try {
    decoded = await auth.verifyIdToken(idToken);
  } catch (error) {
    logAuthEvent(req, "google_auth_failed", { reason: error?.message || "invalid_google_token" });
    return next(new AppError("Token do Google inválido.", 401));
  }

  const { uid, email, name, picture } = decoded;
  const userRef = db.collection("users").doc(uid);
  const userDoc = await userRef.get();
  let createdNow = false;
  let userData;

  if (!userDoc.exists) {
    const baseUsername = generateUsername(name, uid);
    const existing = await db.collection("users").where("username", "==", baseUsername).limit(1).get();
    const finalUsername = existing.empty ? baseUsername : `${baseUsername}${Math.floor(Math.random() * 900 + 100)}`;

    userData = {
      name: name || "Usuário",
      username: finalUsername,
      email: email || null,
      provider: "google",
      createdAt: new Date(),
      role: "user",
      levelTitle: "Espectador",
      reviewsCount: 0,
      genreCounts: {},
      termsVersion: CURRENT_TERMS_VERSION,
      termsAcceptedAt: new Date(),
      termsAcceptedUserAgent: req.headers["user-agent"] || "unknown",
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
      likedMediaIds: [],
    };

    await userRef.set(userData);
    createdNow = true;
  } else {
    userData = userDoc.data() || {};
    const updates = {};

    if (picture && !userData.photoURL) updates.photoURL = picture;
    if (!userData.termsVersion) updates.termsVersion = CURRENT_TERMS_VERSION;
    if (!userData.termsAcceptedAt) updates.termsAcceptedAt = new Date();
    if (!userData.termsAcceptedUserAgent) updates.termsAcceptedUserAgent = req.headers["user-agent"] || "unknown";

    if (Object.keys(updates).length > 0) {
      await userRef.update(updates);
      userData = { ...userData, ...updates };
    }
  }

  const sessionCookie = await auth.createSessionCookie(idToken, { expiresIn: SESSION_MAX_AGE_MS });
  res.cookie(AUTH_COOKIE_NAME, sessionCookie, sessionCookieOptions);
  if (AUTH_COOKIE_NAME !== LEGACY_AUTH_COOKIE_NAME) {
    res.clearCookie(LEGACY_AUTH_COOKIE_NAME, sessionCookieOptions);
  }

  if (createdNow && email) {
    await userRef.set({ emailConfirmedAt: new Date() }, { merge: true });
  }

  logAuthEvent(req, "google_auth_success", { uid, email, username: userData.username });
  setNoStore(res);
  res.status(200).json({
    uid,
    username: userData.username,
    photoURL: userData.photoURL,
    name: userData.name,
    termsVersion: userData.termsVersion,
  });
});

exports.logout = catchAsync(async (req, res) => {
  const sessionCookie = getSessionCookie(req);
  if (sessionCookie) {
    try {
      const decodedClaims = await auth.verifySessionCookie(sessionCookie, false);
      await auth.revokeRefreshTokens(decodedClaims.uid);
      logAuthEvent(req, "logout", { uid: decodedClaims.uid, email: decodedClaims.email || null });
    } catch {}
  }

  clearSessionCookies(res);
  setNoStore(res);
  res.status(200).json({ message: "Logout realizado." });
});

exports.getMe = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const doc = await db.collection("users").doc(uid).get();
  if (!doc.exists) return next(new AppError("Usuário não encontrado.", 404));

  const d = doc.data() || {};
  setNoStore(res);
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

  if (bio && containsProfanity(bio)) {
    return next(new AppError("A biografia contém conteúdo impróprio. Revise esse campo.", 400));
  }

  if (username && containsProfanity(username)) {
    return next(new AppError("O username contém conteúdo impróprio. Revise esse campo.", 400));
  }

  const userRef = db.collection("users").doc(uid);
  let usernameChanged = null;
  let photoChanged = null;

  try {
    await db.runTransaction(async (t) => {
      const doc = await t.get(userRef);
      if (!doc.exists) throw new Error("USER_NOT_FOUND");

      const userData = doc.data();
      const updates = {};
      const history = {};

      if (username && username !== userData.username) {
        const checkSnapshot = await db.collection("users").where("username", "==", username).limit(1).get();
        if (!checkSnapshot.empty && checkSnapshot.docs[0].id !== uid) {
          throw new Error("USERNAME_TAKEN");
        }

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

        const auditRef = userRef.collection("history").doc();
        t.set(auditRef, {
          changes: history,
          timestamp: new Date(),
          userAgent: req.headers["user-agent"] || "unknown",
        });
      }
    });

    if (usernameChanged || photoChanged !== null) {
      syncUsernameAndPhoto(uid, usernameChanged, photoChanged).catch((err) => {
        logger.error("syncUsernameAndPhoto failed: %o", err);
      });
    }

    setNoStore(res);
    res.status(200).json({ message: "Perfil atualizado." });
  } catch (error) {
    if (error.message === "USERNAME_TAKEN") return next(new AppError("Username em uso.", 400));

    if (error.message?.startsWith("WAIT_")) {
      const days = error.message.split("_")[1];
      return next(new AppError(`Aguarde ${days} dia(s) para trocar o username novamente.`, 400));
    }

    throw error;
  }
});

exports.getPublicProfile = catchAsync(async (req, res, next) => {
  const { username } = req.params;
  const snapshot = await db.collection("users").where("username", "==", username).limit(1).get();
  if (snapshot.empty) return next(new AppError("Não encontrado.", 404));

  const rawData = snapshot.docs[0].data();
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
    genreCounts: rawData.genreCounts || {},
  });
});

exports.resetPassword = catchAsync(async (req, res, next) => {
  const { email } = req.body;
  if (!email) {
    clearSessionCookies(res);
    logAuthEvent(req, "reset_password_requested", { email: null, userFound: false, sessionsRevoked: false });
    setNoStore(res);
    return res.status(200).json({ message: "Solicitação recebida." });
  }

  const userQuery = await db.collection("users").where("email", "==", email).limit(1).get();
  let sessionsRevoked = false;

  if (!userQuery.empty) {
    const userDoc = userQuery.docs[0];
    try {
      await sendFirebasePasswordResetEmail(email);
      await auth.revokeRefreshTokens(userDoc.id);
      sessionsRevoked = true;
    } catch (noticeError) {
      logger.error("firebase password reset email failed: %s", noticeError.message || noticeError);
    }
  }

  clearSessionCookies(res);
  logAuthEvent(req, "reset_password_requested", { email, userFound: !userQuery.empty, sessionsRevoked });
  setNoStore(res);
  res.status(200).json({ message: "Solicitação recebida." });
});

exports.deleteAccount = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const { confirmText } = req.body || {};

  if (confirmText !== "DELETAR CONTA") {
    return next(new AppError("Digite DELETAR CONTA para confirmar a exclusão.", 400));
  }

  const authTime = Number(req.user.authTime || 0);
  if (!authTime || Date.now() - authTime > RECENT_LOGIN_MAX_AGE_MS) {
    clearSessionCookies(res);
    return next(new AppError("Por segurança, faça login novamente antes de excluir sua conta.", 401));
  }

  const userRef = db.collection("users").doc(uid);
  const userDoc = await userRef.get();
  if (!userDoc.exists) return next(new AppError("Usuário não encontrado.", 404));

  await deleteAccountData(uid);

  logAuthEvent(req, "account_deletion_confirmed", { uid });
  clearSessionCookies(res);
  setNoStore(res);
  res.status(200).json({ message: "Conta excluída com sucesso." });
});

exports.requestAccountDeletion = exports.deleteAccount;
