const axios = require("axios");
const admin = require("firebase-admin");

const { auth, db } = require("../../config/firebase");
const env = require("../../config/env");
const {
  AUTH_COOKIE_NAME,
  LEGACY_AUTH_COOKIE_NAME,
  SESSION_MAX_AGE_MS,
  sessionCookieOptions,
} = require("../../config/cookies");
const { getSessionCookie, clearSessionCookies } = require("../../shared/middleware/auth");
const AppError = require("../../shared/errors/AppError");
const catchAsync = require("../../shared/utils/catchAsync");
const logger = require("../../shared/utils/logger");
const { containsProfanity } = require("../../shared/utils/profanity");

const { resendVerificationEmailForAddress } = require("./emailVerification.service");

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

const parseUserAgent = (userAgent = "") => {
  const browser = /Edg\//i.test(userAgent)
    ? "Microsoft Edge"
    : /Chrome\//i.test(userAgent)
      ? "Google Chrome"
      : /Firefox\//i.test(userAgent)
        ? "Firefox"
        : /Safari\//i.test(userAgent)
          ? "Safari"
          : "Navegador desconhecido";

  const os = /Windows/i.test(userAgent)
    ? "Windows"
    : /Mac OS X|Macintosh/i.test(userAgent)
      ? "macOS"
      : /Android/i.test(userAgent)
        ? "Android"
        : /iPhone|iPad|iPod/i.test(userAgent)
          ? "iOS"
          : /Linux/i.test(userAgent)
            ? "Linux"
            : "Sistema desconhecido";

  const device = /iPad|Tablet/i.test(userAgent)
    ? "Tablet"
    : /Mobile|Android|iPhone|iPod/i.test(userAgent)
      ? "Celular"
      : "Computador";

  return { browser, os, device };
};

const getRequestSecurityContext = (req) => {
  const userAgent = req.headers["user-agent"] || "unknown";
  const forwardedFor = req.headers["x-forwarded-for"];
  const ip = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : forwardedFor?.split(",")[0]?.trim() || req.ip || "unknown";

  return {
    ip,
    userAgent,
    ...parseUserAgent(userAgent),
  };
};

const recordSecurityEvent = async (req, uid, event, metadata = {}) => {
  if (!uid) return;

  try {
    const userRef = db.collection("users").doc(uid);
    if (typeof userRef.collection !== "function") return;

    await userRef.collection("security_events").add({
      event,
      ...metadata,
      ...getRequestSecurityContext(req),
      createdAt: admin.firestore.Timestamp.now(),
    });
  } catch (error) {
    logger.warn("security_event_record_failed", {
      uid,
      event,
      message: error?.message || "unknown",
    });
  }
};

const formatSecurityEvent = (doc) => {
  const data = doc.data() || {};
  return {
    id: doc.id,
    event: data.event || "unknown",
    provider: data.provider || null,
    ip: data.ip || null,
    browser: data.browser || "Navegador desconhecido",
    os: data.os || "Sistema desconhecido",
    device: data.device || "Dispositivo desconhecido",
    userAgent: data.userAgent || null,
    createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt || null,
  };
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

const verifyGoogleIdentityToken = async (googleAccessToken) => {
  if (!env.GOOGLE_CLIENT_ID) {
    throw new AppError("Login com Google não configurado.", 500);
  }

  const tokenInfoResponse = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(googleAccessToken)}`,
    { signal: AbortSignal.timeout(10000) }
  );
  const tokenInfo = await tokenInfoResponse.json().catch(() => ({}));

  if (!tokenInfoResponse.ok) {
    throw new AppError(tokenInfo?.error_description || "Token do Google inválido.", 401);
  }

  const audience = tokenInfo.aud || tokenInfo.audience || tokenInfo.issued_to;
  if (audience !== env.GOOGLE_CLIENT_ID) {
    throw new AppError("Token do Google não pertence ao CineSorte.", 401);
  }

  const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${googleAccessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  const userInfo = await userInfoResponse.json().catch(() => ({}));

  if (!userInfoResponse.ok) {
    throw new AppError(userInfo?.error_description || "Não foi possível validar o Google.", 401);
  }

  if (userInfo.email_verified !== "true" && userInfo.email_verified !== true) {
    throw new AppError("Email do Google não verificado.", 401);
  }

  return {
    googleSub: userInfo.sub || tokenInfo.user_id,
    email: userInfo.email || tokenInfo.email,
    name: userInfo.name,
    picture: userInfo.picture,
  };
};

const signInFirebaseWithGoogle = async (googleAccessToken) => {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${env.FIREBASE_WEB_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestUri: env.FRONTEND_URL,
        postBody: `access_token=${encodeURIComponent(googleAccessToken)}&providerId=google.com`,
        returnIdpCredential: true,
        returnSecureToken: true,
      }),
      signal: AbortSignal.timeout(10000),
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.idToken || !data.localId) {
    throw new Error(data?.error?.message || "firebase_google_sign_in_failed");
  }

  return data;
};

const linkFirebaseGoogleProvider = async (firebaseIdToken, googleAccessToken) => {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${env.FIREBASE_WEB_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idToken: firebaseIdToken,
        requestUri: env.FRONTEND_URL,
        postBody: `access_token=${encodeURIComponent(googleAccessToken)}&providerId=google.com`,
        returnIdpCredential: true,
        returnSecureToken: true,
      }),
      signal: AbortSignal.timeout(10000),
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.idToken || !data.localId) {
    const message = data?.error?.message || "firebase_google_link_failed";
    if (message.includes("FEDERATED_USER_ID_ALREADY_LINKED")) {
      throw new AppError("Esta conta Google já está vinculada a outro usuário.", 409);
    }
    if (message.includes("EMAIL_EXISTS")) {
      throw new AppError("Este email Google já pertence a outra conta.", 409);
    }
    throw new Error(message);
  }

  return data;
};

const reauthenticateWithPassword = async (email, password) => {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${env.FIREBASE_WEB_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
      signal: AbortSignal.timeout(10000),
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.idToken || !data.localId) {
    throw new AppError("Senha atual incorreta.", 401);
  }

  return data;
};

const updateFirebasePassword = async (idToken, newPassword, email = null) => {
  const payload = { idToken, password: newPassword, returnSecureToken: true };
  if (email) payload.email = email;

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${env.FIREBASE_WEB_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.idToken) {
    const message = data?.error?.message || "firebase_password_change_failed";
    if (message.includes("WEAK_PASSWORD")) {
      throw new AppError("A nova senha precisa ter pelo menos 6 caracteres.", 400);
    }
    throw new Error(message);
  }

  return data;
};

const sendFirebaseEmailChangeVerification = async (idToken, newEmail) => {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${env.FIREBASE_WEB_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Firebase-Locale": "pt-BR" },
      body: JSON.stringify({
        requestType: "VERIFY_AND_CHANGE_EMAIL",
        idToken,
        newEmail,
        continueUrl: `${env.FRONTEND_URL.replace(/\/$/, "")}/app/settings?tab=security`,
      }),
      signal: AbortSignal.timeout(10000),
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || "firebase_email_change_failed";
    if (message.includes("EMAIL_EXISTS")) {
      throw new AppError("Este email já está em uso.", 409);
    }
    if (message.includes("INVALID_ID_TOKEN")) {
      throw new AppError("Faça login novamente para alterar o email.", 401);
    }
    throw new Error(message);
  }

  return data;
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

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidUsername(value) {
  return /^[a-z0-9_]{3,30}$/.test(value);
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
    const { sendAlert } = require("../../infrastructure/monitoring/telegram.service");
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
  await recordSecurityEvent(req, userRecord.uid, "register_success", {
    provider: "email",
    email,
    username: nickname,
  });
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

    const loginUpdates = {};
    if (userInfo.email && userInfo.email !== userData.email) {
      loginUpdates.email = userInfo.email;
      loginUpdates.pendingEmailChange = admin.firestore.FieldValue.delete();
      loginUpdates.emailChangeRequestedAt = admin.firestore.FieldValue.delete();
    }
    if (userInfo.emailVerified && !userData.emailConfirmedAt) {
      loginUpdates.emailConfirmedAt = new Date();
    }

    if (Object.keys(loginUpdates).length > 0) {
      await userRef.set(loginUpdates, { merge: true });
    }

    const idToken = response.data.idToken;
    const sessionCookie = await auth.createSessionCookie(idToken, { expiresIn: SESSION_MAX_AGE_MS });

    res.cookie(AUTH_COOKIE_NAME, sessionCookie, sessionCookieOptions);
    if (AUTH_COOKIE_NAME !== LEGACY_AUTH_COOKIE_NAME) {
      res.clearCookie(LEGACY_AUTH_COOKIE_NAME, sessionCookieOptions);
    }

    logAuthEvent(req, "login_success", { uid: response.data.localId, email, username: userData.username || null });
    await recordSecurityEvent(req, response.data.localId, "login_success", {
      provider: userData.provider || "email",
      email,
      username: userData.username || null,
    });
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
  const { idToken, nickname, termsAccepted } = req.body;
  if (!idToken) return next(new AppError("Token do Google ausente.", 400));

  let googleProfile;
  try {
    googleProfile = await verifyGoogleIdentityToken(idToken);
  } catch (error) {
    logAuthEvent(req, "google_auth_failed", { reason: error?.message || "invalid_google_token" });
    if (error instanceof AppError) return next(error);
    return next(new AppError("Token do Google inválido.", 401));
  }

  const { googleSub, email, name, picture } = googleProfile;
  if (!email) return next(new AppError("A conta Google não informou email.", 400));

  const existingByGoogleSub = await db
    .collection("users")
    .where("googleSub", "==", googleSub)
    .limit(1)
    .get();
  const existingByEmail = existingByGoogleSub.empty
    ? await db.collection("users").where("email", "==", email).limit(1).get()
    : null;
  const existingDoc = !existingByGoogleSub.empty
    ? existingByGoogleSub.docs[0]
    : existingByEmail && !existingByEmail.empty
      ? existingByEmail.docs[0]
      : null;

  let uid = existingDoc?.id || null;
  let userRef = uid ? db.collection("users").doc(uid) : null;
  let createdNow = false;
  let userData = existingDoc?.data() || null;
  let firebaseGoogleSession = null;

  if (!existingDoc) {
    const requestedUsername = normalizeUsername(nickname);

    if (!requestedUsername || termsAccepted !== true) {
      const baseUsername = generateUsername(name, googleSub);
      const existing = await db.collection("users").where("username", "==", baseUsername).limit(1).get();
      const suggestedUsername = existing.empty ? baseUsername : `${baseUsername}${Math.floor(Math.random() * 900 + 100)}`;

      logAuthEvent(req, "google_register_profile_required", { googleSub, email, provider: "google" });
      setNoStore(res);
      return res.status(200).json({
        requiresProfile: true,
        provider: "google",
        email: email || null,
        name: name || "Usuário",
        photoURL: picture || null,
        suggestedUsername,
      });
    }

    if (!isValidUsername(requestedUsername)) {
      return next(new AppError("Username inválido. Use letras minúsculas, números ou _.", 400));
    }

    if (containsProfanity(requestedUsername)) {
      return next(new AppError("O username contém conteúdo impróprio. Revise esse campo.", 400));
    }

    const existing = await db.collection("users").where("username", "==", requestedUsername).limit(1).get();
    if (!existing.empty) {
      return next(new AppError("Este username já está em uso.", 400));
    }

    firebaseGoogleSession = await signInFirebaseWithGoogle(idToken);
    uid = firebaseGoogleSession.localId;
    userRef = db.collection("users").doc(uid);

    userData = {
      name: name || "Usuário",
      username: requestedUsername,
      email: email || null,
      provider: "google",
      googleSub,
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
      emailConfirmedAt: new Date(),
    };

    await userRef.set(userData);
    createdNow = true;
  } else {
    firebaseGoogleSession = await signInFirebaseWithGoogle(idToken);
    uid = firebaseGoogleSession.localId;

    if (existingDoc.id !== uid) {
      userRef = db.collection("users").doc(uid);
      const currentDoc = await userRef.get();
      if (!currentDoc.exists) {
        await userRef.set(userData);
      } else {
        userData = currentDoc.data() || userData;
      }
    }

    const updates = {};

    if (picture && !userData.photoURL) updates.photoURL = picture;
    if (!userData.googleSub) updates.googleSub = googleSub;

    if (Object.keys(updates).length > 0) {
      await userRef.update(updates);
      userData = { ...userData, ...updates };
    }
  }

  uid = firebaseGoogleSession.localId;
  const sessionCookie = await auth.createSessionCookie(firebaseGoogleSession.idToken, { expiresIn: SESSION_MAX_AGE_MS });
  res.cookie(AUTH_COOKIE_NAME, sessionCookie, sessionCookieOptions);
  if (AUTH_COOKIE_NAME !== LEGACY_AUTH_COOKIE_NAME) {
    res.clearCookie(LEGACY_AUTH_COOKIE_NAME, sessionCookieOptions);
  }

  if (createdNow) {
    logAuthEvent(req, "register_success", {
      uid,
      email,
      username: userData.username,
      provider: "google",
    });
    await recordSecurityEvent(req, uid, "register_success", {
      provider: "google",
      email,
      username: userData.username,
    });
  }

  logAuthEvent(req, "login_success", {
    uid,
    email,
    username: userData.username,
    provider: "google",
  });
  await recordSecurityEvent(req, uid, "login_success", {
    provider: "google",
    email,
    username: userData.username,
  });
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
      let userData = {};

      try {
        const userDoc = await db.collection("users").doc(decodedClaims.uid).get();
        userData = userDoc.exists ? userDoc.data() || {} : {};
      } catch {}

      await auth.revokeRefreshTokens(decodedClaims.uid);
      logAuthEvent(req, "logout", {
        uid: decodedClaims.uid,
        email: decodedClaims.email || userData.email || null,
        username: userData.username || null,
        provider: userData.provider || null,
      });
      await recordSecurityEvent(req, decodedClaims.uid, "logout", {
        provider: userData.provider || null,
        email: decodedClaims.email || userData.email || null,
        username: userData.username || null,
      });
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
    provider: d.provider || "email",
    termsVersion: d.termsVersion,
  });
});

exports.getSecurityOverview = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const pageSize = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 20) : 8;
  const cursorDate = req.query.cursor ? new Date(req.query.cursor) : null;

  if (req.query.cursor && Number.isNaN(cursorDate.getTime())) {
    return next(new AppError("Cursor de atividades inválido.", 400));
  }

  const userRef = db.collection("users").doc(uid);
  const doc = await userRef.get();
  if (!doc.exists) return next(new AppError("Usuário não encontrado.", 404));

  const userData = doc.data() || {};
  let authProvider = userData.provider || "email";
  let linkedProviders = authProvider === "google" ? ["google"] : ["password"];

  try {
    const authUser = await auth.getUser(uid);
    const providers = authUser.providerData.map((provider) => provider.providerId);
    linkedProviders = providers
      .map((provider) => (provider === "google.com" ? "google" : provider))
      .filter((provider) => provider === "google" || provider === "password");
    if (providers.includes("google.com") && providers.includes("password")) authProvider = "email_google";
    else if (providers.includes("google.com")) authProvider = "google";
    else if (providers.includes("password")) authProvider = "email";
  } catch {}

  let activitiesQuery = userRef
    .collection("security_events")
    .orderBy("createdAt", "desc")
    .limit(pageSize + 1);

  if (cursorDate) {
    activitiesQuery = activitiesQuery.startAfter(admin.firestore.Timestamp.fromDate(cursorDate));
  }

  const activitySnapshot = await activitiesQuery.get();
  const activityDocs = activitySnapshot.docs.slice(0, pageSize);
  const hasMoreActivities = activitySnapshot.docs.length > pageSize;
  const lastActivity = activityDocs[activityDocs.length - 1];
  const lastActivityData = lastActivity?.data() || null;
  const nextActivitiesCursor =
    hasMoreActivities && lastActivityData?.createdAt?.toDate
      ? lastActivityData.createdAt.toDate().toISOString()
      : null;

  setNoStore(res);
  res.status(200).json({
    account: {
      provider: authProvider,
      providers: linkedProviders,
      label:
        authProvider === "email_google"
          ? "Email e Google"
          : authProvider === "google"
            ? "Google"
            : "Email e senha",
      email: userData.email || null,
      pendingEmailChange: userData.pendingEmailChange || null,
      emailConfirmedAt: userData.emailConfirmedAt?.toDate
        ? userData.emailConfirmedAt.toDate().toISOString()
        : userData.emailConfirmedAt || null,
    },
    currentSession: {
      ...getRequestSecurityContext(req),
      authTime: req.user.authTime ? new Date(req.user.authTime).toISOString() : null,
    },
    activities: activityDocs.map(formatSecurityEvent),
    nextActivitiesCursor,
  });
});

exports.changePassword = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const { currentPassword, newPassword } = req.body;
  const authUser = await auth.getUser(uid);
  const providerIds = authUser.providerData.map((provider) => provider.providerId);

  if (!providerIds.includes("password")) {
    return next(new AppError("Esta conta não usa senha do CineSorte.", 400));
  }

  const passwordSession = await reauthenticateWithPassword(authUser.email, currentPassword);
  if (passwordSession.localId !== uid) {
    return next(new AppError("Senha atual incorreta.", 401));
  }

  const updatedSession = await updateFirebasePassword(passwordSession.idToken, newPassword);
  const sessionCookie = await auth.createSessionCookie(updatedSession.idToken, { expiresIn: SESSION_MAX_AGE_MS });

  res.cookie(AUTH_COOKIE_NAME, sessionCookie, sessionCookieOptions);
  if (AUTH_COOKIE_NAME !== LEGACY_AUTH_COOKIE_NAME) {
    res.clearCookie(LEGACY_AUTH_COOKIE_NAME, sessionCookieOptions);
  }

  logAuthEvent(req, "password_changed", { uid, email: authUser.email || null });
  await recordSecurityEvent(req, uid, "password_changed", {
    provider: providerIds.includes("google.com") ? "email_google" : "email",
    email: authUser.email || null,
    username: req.user.username || null,
  });

  setNoStore(res);
  res.status(200).json({ message: "Senha alterada com sucesso." });
});

exports.requestEmailChange = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const { currentPassword } = req.body;
  const newEmail = String(req.body.newEmail || "").trim().toLowerCase();
  const authUser = await auth.getUser(uid);
  const providerIds = authUser.providerData.map((provider) => provider.providerId);

  if (!providerIds.includes("password")) {
    return next(new AppError("Contas Google não alteram email pelo CineSorte.", 400));
  }

  if (newEmail === String(authUser.email || "").toLowerCase()) {
    return next(new AppError("Informe um email diferente do atual.", 400));
  }

  const passwordSession = await reauthenticateWithPassword(authUser.email, currentPassword);
  if (passwordSession.localId !== uid) {
    return next(new AppError("Senha atual incorreta.", 401));
  }

  await sendFirebaseEmailChangeVerification(passwordSession.idToken, newEmail);
  await db.collection("users").doc(uid).set(
    {
      pendingEmailChange: newEmail,
      emailChangeRequestedAt: new Date(),
      updatedAt: new Date(),
    },
    { merge: true }
  );

  logAuthEvent(req, "email_change_requested", { uid, email: authUser.email || null, newEmail });
  await recordSecurityEvent(req, uid, "email_change_requested", {
    provider: providerIds.includes("google.com") ? "email_google" : "email",
    email: authUser.email || null,
    username: req.user.username || null,
  });

  setNoStore(res);
  res.status(200).json({ message: "Enviamos um link de confirmação para o novo email." });
});

exports.linkGoogleAccount = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const { idToken, currentPassword } = req.body;
  const authUser = await auth.getUser(uid);
  const providerIds = authUser.providerData.map((provider) => provider.providerId);

  if (!providerIds.includes("password")) {
    return next(new AppError("Esta ação está disponível apenas para contas com email e senha.", 400));
  }

  if (providerIds.includes("google.com")) {
    return next(new AppError("Google já está vinculado a esta conta.", 400));
  }

  const googleProfile = await verifyGoogleIdentityToken(idToken);
  if (String(googleProfile.email || "").toLowerCase() !== String(authUser.email || "").toLowerCase()) {
    return next(new AppError("Use a conta Google com o mesmo email cadastrado no CineSorte.", 400));
  }

  const passwordSession = await reauthenticateWithPassword(authUser.email, currentPassword);
  if (passwordSession.localId !== uid) {
    return next(new AppError("Senha atual incorreta.", 401));
  }

  const linkedSession = await linkFirebaseGoogleProvider(passwordSession.idToken, idToken);
  if (linkedSession.localId !== uid) {
    return next(new AppError("Não foi possível vincular este Google à conta atual.", 409));
  }

  await db.collection("users").doc(uid).set(
    {
      googleSub: googleProfile.googleSub,
      googleLinkedAt: new Date(),
      provider: "email_google",
      photoURL: req.user.photoURL || googleProfile.picture || null,
      updatedAt: new Date(),
    },
    { merge: true }
  );

  const sessionCookie = await auth.createSessionCookie(linkedSession.idToken, { expiresIn: SESSION_MAX_AGE_MS });
  res.cookie(AUTH_COOKIE_NAME, sessionCookie, sessionCookieOptions);
  if (AUTH_COOKIE_NAME !== LEGACY_AUTH_COOKIE_NAME) {
    res.clearCookie(LEGACY_AUTH_COOKIE_NAME, sessionCookieOptions);
  }

  logAuthEvent(req, "google_linked", { uid, email: authUser.email || null });
  await recordSecurityEvent(req, uid, "google_linked", {
    provider: "email_google",
    email: authUser.email || null,
    username: req.user.username || null,
  });

  setNoStore(res);
  res.status(200).json({ message: "Google vinculado com sucesso." });
});

exports.linkPasswordAccount = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const { idToken, newPassword } = req.body;
  const authUser = await auth.getUser(uid);
  const providerIds = authUser.providerData.map((provider) => provider.providerId);

  if (!providerIds.includes("google.com")) {
    return next(new AppError("Esta ação está disponível apenas para contas Google.", 400));
  }

  if (providerIds.includes("password")) {
    return next(new AppError("Email e senha já estão vinculados a esta conta.", 400));
  }

  const googleProfile = await verifyGoogleIdentityToken(idToken);
  if (String(googleProfile.email || "").toLowerCase() !== String(authUser.email || "").toLowerCase()) {
    return next(new AppError("Use a conta Google com o mesmo email cadastrado no CineSorte.", 400));
  }

  const userRef = db.collection("users").doc(uid);
  const userDoc = await userRef.get();
  const userData = userDoc.exists ? userDoc.data() || {} : {};

  if (userData.googleSub && userData.googleSub !== googleProfile.googleSub) {
    return next(new AppError("Esta conta Google não corresponde ao usuário atual.", 400));
  }

  try {
    await auth.updateUser(uid, {
      email: authUser.email,
      password: newPassword,
      emailVerified: true,
    });
  } catch (error) {
    if (error?.code === "auth/weak-password") {
      return next(new AppError("A nova senha precisa ter pelo menos 6 caracteres.", 400));
    }
    throw error;
  }

  await userRef.set(
    {
      provider: "email_google",
      googleSub: userData.googleSub || googleProfile.googleSub,
      passwordLinkedAt: new Date(),
      emailConfirmedAt: userData.emailConfirmedAt || new Date(),
      updatedAt: new Date(),
    },
    { merge: true }
  );

  logAuthEvent(req, "password_linked", { uid, email: authUser.email || null });
  await recordSecurityEvent(req, uid, "password_linked", {
    provider: "email_google",
    email: authUser.email || null,
    username: req.user.username || null,
  });

  setNoStore(res);
  res.status(200).json({ message: "Email e senha vinculados com sucesso." });
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
