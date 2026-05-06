const axios = require("axios");
const crypto = require("crypto");
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
const {
  sendAccountDeletionRequestEmail,
  sendAccountDeletionEmail,
  sendLoginAlertEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendWelcomeEmail,
} = require("../services/email");

const normalizeIp = (rawIp = "") => {
  const ip = String(rawIp || "").trim();
  if (!ip) return "";
  if (ip.startsWith("::ffff:")) return ip.slice(7);
  if (ip === "::1") return "127.0.0.1";
  return ip;
};

const isPrivateIp = (ip = "") => /^(127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|fc00:|fe80:|::1)/i.test(ip);

const formatUserAgent = (userAgent = "") => {
  const ua = String(userAgent || "").trim();
  if (!ua) return "não identificado";

  const browser = /Edg\//.test(ua) || /Edge\//.test(ua)
    ? "Microsoft Edge"
    : /OPR\//.test(ua) || /Opera/.test(ua)
    ? "Opera"
    : /CriOS/.test(ua) || (/Chrome\//.test(ua) && /Safari\//.test(ua))
    ? "Chrome"
    : /Firefox\//.test(ua)
    ? "Firefox"
    : /Safari\//.test(ua)
    ? "Safari"
    : /MSIE|Trident\//.test(ua)
    ? "Internet Explorer"
    : /SamsungBrowser\//.test(ua)
    ? "Samsung Internet"
    : "navegador desconhecido";

  const os = /Windows NT 10/.test(ua)
    ? "Windows 10"
    : /Windows NT 6\.3/.test(ua)
    ? "Windows 8.1"
    : /Windows NT 6\.2/.test(ua)
    ? "Windows 8"
    : /Windows NT 6\.1/.test(ua)
    ? "Windows 7"
    : /Mac OS X/.test(ua)
    ? "macOS"
    : /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Linux/.test(ua)
    ? "Linux"
    : "sistema desconhecido";

  const device = /Mobile|iPhone|iPad|iPod|Android/.test(ua) ? "móvel" : "desktop";

  return `${browser} em ${os} (${device})`;
};

const lookupIpLocation = async (ip) => {
  const normalizedIp = normalizeIp(ip);
  if (!normalizedIp || isPrivateIp(normalizedIp)) return null;

  try {
    const response = await axios.get(`https://ipapi.co/${encodeURIComponent(normalizedIp)}/json/`, {
      timeout: 2500,
    });

    const data = response.data || {};
    if (data.error || !data.country_name || typeof data.latitude !== "number" || typeof data.longitude !== "number") {
      return null;
    }

    return {
      city: data.city || null,
      region: data.region || null,
      countryName: data.country_name || null,
      latitude: data.latitude,
      longitude: data.longitude,
    };
  } catch (error) {
    return null;
  }
};
const { resendVerificationEmailForAddress } = require("../services/emailVerificationResendService");

const isProduction = env.NODE_ENV === "production";
const CURRENT_TERMS_VERSION = "4.0";
const ACCOUNT_DELETION_REQUESTS = "account_deletion_requests";
const ACCOUNT_DELETION_TOKEN_BYTES = 32;
const ACCOUNT_DELETION_TOKEN_TTL_MINUTES = 30;

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

const runInBackground = (label, task) => {
  Promise.resolve()
    .then(task)
    .catch((error) => {
      logger.error("%s failed: %s", label, error?.message || error);
    });
};

const hashToken = (token) => crypto.createHash("sha256").update(String(token || "")).digest("hex");

const createSecureToken = () => crypto.randomBytes(ACCOUNT_DELETION_TOKEN_BYTES).toString("hex");

const toDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  return new Date(value);
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

async function sendWelcomeAfterVerification({ userRef, userData = {}, userEmail, userName, username }) {
  if (!userEmail || userData.welcomeEmailSentAt) return;

  await sendWelcomeEmail({
    userEmail,
    userName,
    username,
  });

  await userRef.set(
    {
      emailConfirmedAt: userData.emailConfirmedAt || new Date(),
      welcomeEmailSentAt: new Date(),
    },
    { merge: true }
  );
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

async function deleteExpiredAccountDeletionRequests(uid) {
  const snapshot = await db
    .collection(ACCOUNT_DELETION_REQUESTS)
    .where("uid", "==", uid)
    .where("status", "==", "pending")
    .limit(50)
    .get();

  if (snapshot.empty) return;

  const now = admin.firestore.Timestamp.now();
  const expiredDocs = snapshot.docs.filter((doc) => {
    const request = doc.data() || {};
    const expiresAt = request.expiresAt;
    return expiresAt && expiresAt.toMillis && expiresAt.toMillis() <= now.toMillis();
  });

  if (!expiredDocs.length) return;

  const batch = db.batch();
  expiredDocs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

async function sendLoginSecurityAlert({ req, email, userData }) {
  if (!email) return;

  const normalizedIp = normalizeIp(req.ip || "");
  const accessLocation = await lookupIpLocation(normalizedIp);
  const resetLink = await auth.generatePasswordResetLink(email);

  await sendLoginAlertEmail({
    userEmail: email,
    userName: userData.name || userData.username || "cinéfilo",
    resetLink,
    accessDate: new Date().toLocaleString("pt-BR", { timeZone: "America/Bahia" }),
    ip: normalizedIp || "não identificado",
    userAgent: formatUserAgent(req.headers["user-agent"]),
    location: accessLocation,
  });
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
    const verificationLink = await auth.generateEmailVerificationLink(email);
    const verificationResult = await sendVerificationEmail({
      userEmail: email,
      userName: name,
      username: nickname,
      verificationLink,
    });

    await userRef.set(
      {
        verificationEmailLastSentAt: admin.firestore.Timestamp.now(),
        verificationEmailLastStatus: verificationResult.sent
          ? "sent"
          : verificationResult.queued
            ? "queued"
            : verificationResult.skipped
              ? "skipped"
              : "failed",
        verificationEmailLastError: verificationResult.error || verificationResult.reason || null,
        verificationEmailResendCount: 0,
        updatedAt: new Date(),
      },
      { merge: true }
    );

    if (!verificationResult.sent) {
      logger.warn(
        "verification email not sent immediately: %s",
        verificationResult.error || verificationResult.reason || "queued_or_unknown"
      );
    }
  } catch (emailError) {
    const { sendAlert } = require("../services/telegramService");
    const errInfo = emailError.response ? emailError.response.data : emailError;
    logger.error("sending verification email failed: %o", errInfo);

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

    if (userInfo.emailVerified && !userData.welcomeEmailSentAt) {
      try {
        await sendWelcomeAfterVerification({
          userRef,
          userData,
          userEmail: email,
          userName: userData.name,
          username: userData.username,
        });
      } catch (welcomeError) {
        logger.error("welcome email failed after verification: %s", welcomeError.message || welcomeError);
      }
    } else if (userInfo.emailVerified && !userData.emailConfirmedAt) {
      await userRef.set({ emailConfirmedAt: new Date() }, { merge: true });
    }

    const idToken = response.data.idToken;
    const sessionCookie = await auth.createSessionCookie(idToken, { expiresIn: SESSION_MAX_AGE_MS });

    res.cookie(AUTH_COOKIE_NAME, sessionCookie, sessionCookieOptions);
    if (AUTH_COOKIE_NAME !== LEGACY_AUTH_COOKIE_NAME) {
      res.clearCookie(LEGACY_AUTH_COOKIE_NAME, sessionCookieOptions);
    }

    logAuthEvent(req, "login_success", { uid: response.data.localId, email, username: userData.username || null });
    runInBackground("login security alert email", () =>
      sendLoginSecurityAlert({ req, email, userData })
    );
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
    try {
      await sendWelcomeEmail({ userEmail: email, userName: userData.name, username: userData.username });
      await userRef.set(
        {
          emailConfirmedAt: new Date(),
          welcomeEmailSentAt: new Date(),
        },
        { merge: true }
      );
    } catch (welcomeError) {
      logger.error("welcome email failed on google auth: %s", welcomeError.message || welcomeError);
    }
  }

  logAuthEvent(req, "google_auth_success", { uid, email, username: userData.username });
  runInBackground("google login security alert email", () =>
    sendLoginSecurityAlert({ req, email, userData })
  );
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
    const userData = userDoc.data() || {};

    try {
      const resetLink = await auth.generatePasswordResetLink(email);
      await sendPasswordResetEmail({
        userEmail: email,
        userName: userData.name || userData.username || "cinéfilo",
        resetLink,
      });
      await auth.revokeRefreshTokens(userDoc.id);
      sessionsRevoked = true;
    } catch (noticeError) {
      logger.error("password reset email failed: %s", noticeError.message || noticeError);
    }
  }

  clearSessionCookies(res);
  logAuthEvent(req, "reset_password_requested", { email, userFound: !userQuery.empty, sessionsRevoked });
  setNoStore(res);
  res.status(200).json({ message: "Solicitação recebida." });
});

exports.requestAccountDeletion = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const userRef = db.collection("users").doc(uid);
  const userDoc = await userRef.get();
  if (!userDoc.exists) return next(new AppError("Usuário não encontrado.", 404));

  const userData = userDoc.data() || {};
  if (!userData.email) return next(new AppError("Não foi possível identificar o email da sua conta.", 400));

  const token = createSecureToken();
  const tokenHash = hashToken(token);
  const now = admin.firestore.Timestamp.now();
  const expiresAt = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() + ACCOUNT_DELETION_TOKEN_TTL_MINUTES * 60 * 1000)
  );
  const confirmLink = `${env.FRONTEND_URL.replace(/\/$/, "")}/confirm-delete-account?token=${token}`;

  await deleteExpiredAccountDeletionRequests(uid);
  await deleteAccountDeletionRequests(uid);

  await db.collection(ACCOUNT_DELETION_REQUESTS).doc(tokenHash).set({
    uid,
    status: "pending",
    createdAt: now,
    expiresAt,
  });

  await sendAccountDeletionRequestEmail({
    userEmail: userData.email,
    userName: userData.name || userData.username || "cinéfilo",
    confirmLink,
    expiresInMinutes: ACCOUNT_DELETION_TOKEN_TTL_MINUTES,
  });

  logAuthEvent(req, "account_deletion_requested", { uid });
  setNoStore(res);
  res.status(200).json({
    message: "Enviamos um email para confirmar a exclusão da sua conta.",
  });
});

exports.deleteAccount = exports.requestAccountDeletion;

exports.confirmAccountDeletion = catchAsync(async (req, res, next) => {
  const { token } = req.body;
  const tokenHash = hashToken(token);
  const requestRef = db.collection(ACCOUNT_DELETION_REQUESTS).doc(tokenHash);
  const requestDoc = await requestRef.get();

  if (!requestDoc.exists) return next(new AppError("Link inválido ou expirado.", 400));

  const requestData = requestDoc.data() || {};
  const expiresAt = toDate(requestData.expiresAt);

  if (requestData.status !== "pending" || !expiresAt || expiresAt.getTime() < Date.now()) {
    await requestRef.delete().catch(() => {});
    return next(new AppError("Link inválido ou expirado.", 400));
  }

  const uid = requestData.uid;
  const userRef = db.collection("users").doc(uid);
  const userDoc = await userRef.get();

  await requestRef.set(
    {
      status: "processing",
      confirmedAt: admin.firestore.Timestamp.now(),
    },
    { merge: true }
  );

  if (userDoc.exists) {
    const userData = userDoc.data() || {};
    const userEmail = userData.email;
    const userName = userData.name || userData.username || "cinéfilo";

    await deleteAccountData(uid);

    if (userEmail) {
      try {
        await sendAccountDeletionEmail({ userEmail, userName });
      } catch (emailError) {
        logger.error("account deletion email failed: %s", emailError.message || emailError);
      }
    }
  } else {
    await deleteAccountDeletionRequests(uid);
  }

  logAuthEvent(req, "account_deletion_confirmed", { uid });
  clearSessionCookies(res);
  setNoStore(res);
  res.status(200).json({ message: "Conta excluída com sucesso." });
});
