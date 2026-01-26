const { auth, db } = require("../config/firebase");
const admin = require('firebase-admin');
const axios = require("axios");
const {
  profileSchema,
  registerSchema,
  containsProfanity,
} = require("../utils/validators");

async function deleteCollectionData(collectionName, userId) {
  const batchSize = 400;
  
  while (true) {
    const snapshot = await db.collection(collectionName)
      .where('userId', '==', userId)
      .limit(batchSize)
      .get();

    if (snapshot.empty) {
      break;
    }

    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    await new Promise(resolve => setTimeout(resolve, 50));
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
      snapshot.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
}

const register = async (req, res) => {
  const validation = registerSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({
      message: "Dados inválidos.",
      errors: validation.error.errors.map((e) => e.message),
    });
  }

  const { email, password, name, nickname } = validation.data;

  if (containsProfanity(name) || containsProfanity(nickname)) {
    return res.status(400).json({ message: "Nome ou Nickname impróprio." });
  }

  try {
    const checkUser = await db
      .collection("users")
      .where("username", "==", nickname)
      .get();

    if (!checkUser.empty) {
      return res.status(400).json({ message: "Este nickname já está em uso." });
    }

    const userRecord = await auth.createUser({
      email,
      password,
      displayName: name,
      emailVerified: false,
    });

    const CURRENT_TERMS_VERSION = "1.0";

    await db
      .collection("users")
      .doc(userRecord.uid)
      .set({
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
      });

    const apiKey = process.env.FIREBASE_WEB_API_KEY;
    try {
      const customToken = await auth.createCustomToken(userRecord.uid);
      const signInResponse = await axios.post(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
        { token: customToken, returnSecureToken: true },
      );
      await axios.post(
        `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`,
        { requestType: "VERIFY_EMAIL", idToken: signInResponse.data.idToken },
      );
    } catch (emailError) {
      console.error("Erro email:", emailError.message);
    }

    res.status(201).json({
      uid: userRecord.uid,
      username: nickname,
      message: "Usuário criado. Verifique seu email.",
    });
  } catch (error) {
    if (error.code === "auth/email-already-exists") {
      return res
        .status(400)
        .json({ message: "Este email já está cadastrado." });
    }
    res.status(500).json({ message: "Erro ao criar conta." });
  }
};

const login = async (req, res) => {
  const { email, password } = req.body;
  const apiKey = process.env.FIREBASE_WEB_API_KEY;

  try {
    const response = await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      { email, password, returnSecureToken: true },
    );

    const userInfo = await auth.getUser(response.data.localId);
    
    if (!userInfo.emailVerified) {
        return res.status(403).json({ message: "Email não verificado. Por favor, cheque sua caixa de entrada." });
    }

    const idToken = response.data.idToken;
    const expiresIn = 60 * 60 * 24 * 5 * 1000;

    const sessionCookie = await auth.createSessionCookie(idToken, {
      expiresIn,
    });

    const options = {
      maxAge: expiresIn,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    };
    res.cookie("authToken", sessionCookie, options);

    const userDoc = await db
      .collection("users")
      .doc(response.data.localId)
      .get();
    const userData = userDoc.data();

    res.status(200).json({
      uid: response.data.localId,
      username: userData?.username,
      photoURL: userData?.photoURL,
      name: userData?.name,
    });
  } catch (error) {
    if (error.response && error.response.status === 403) {
       return res.status(403).json({ message: error.response.data.message || "Email não verificado." });
    }
    res.status(401).json({ message: "Credenciais inválidas." });
  }
};

const logout = (req, res) => {
  res.clearCookie("authToken");
  res.status(200).json({ message: "Logout realizado." });
};

const getMe = async (req, res) => {
  const { uid } = req.user;
  try {
    const doc = await db.collection("users").doc(uid).get();
    if (!doc.exists)
      return res.status(404).json({ message: "Usuário não encontrado" });

    const data = doc.data();
    res.status(200).json({ uid, ...data });
  } catch (e) {
    res.status(500).json({ message: "Erro interno" });
  }
};

const updateProfile = async (req, res) => {
  if (!req.user || !req.user.uid) {
    return res.status(401).json({ message: "Usuário não autenticado." });
  }

  const { uid } = req.user;

  const validation = profileSchema.safeParse(req.body);
  if (!validation.success) {
    return res
      .status(400)
      .json({ errors: validation.error.errors.map((e) => e.message) });
  }

  const { bio, photoURL, backgroundURL, username } = validation.data;

  if (
    (bio && containsProfanity(bio)) ||
    (username && containsProfanity(username))
  ) {
    return res.status(400).json({ message: "Conteúdo impróprio detectado." });
  }

  try {
    const userRef = db.collection("users").doc(uid);

    await db.runTransaction(async (t) => {
      const doc = await t.get(userRef);

      if (!doc.exists) {
        throw new Error("USER_NOT_FOUND");
      }

      const userData = doc.data();
      const updates = {};
      const history = {};

      if (username && username !== userData.username) {
        const checkSnapshot = await t.get(
          db.collection("users").where("username", "==", username).limit(1),
        );

        if (!checkSnapshot.empty) {
          const existingDoc = checkSnapshot.docs[0];
          if (existingDoc.id !== uid) throw new Error("USERNAME_TAKEN");
        }

        if (userData.lastUsernameChange) {
          const diff = new Date() - userData.lastUsernameChange.toDate();
          const days = diff / (1000 * 60 * 60 * 24);
          if (days < 30) throw new Error(`WAIT_${Math.ceil(30 - days)}_DAYS`);
        }

        updates.username = username;
        updates.lastUsernameChange = new Date();
        history.username = { from: userData.username || null, to: username };
      }

      if (bio !== undefined && bio !== userData.bio) {
        updates.bio = bio;
        history.bio = { from: userData.bio || null, to: bio };
      }

      if (photoURL !== undefined && photoURL !== userData.photoURL) {
        updates.photoURL = photoURL;
        history.photoURL = { from: userData.photoURL || null, to: photoURL };
      }

      if (
        backgroundURL !== undefined &&
        backgroundURL !== userData.backgroundURL
      ) {
        updates.backgroundURL = backgroundURL;
        history.backgroundURL = {
          from: userData.backgroundURL || null,
          to: backgroundURL,
        };
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

    res.status(200).json({ message: "Perfil atualizado com sucesso." });
  } catch (error) {
    if (error.message === "USERNAME_TAKEN")
      return res.status(400).json({ message: "Username em uso." });
    if (error.message === "USER_NOT_FOUND")
      return res.status(404).json({ message: "Usuário não encontrado." });
    if (error.message.startsWith("WAIT")) {
      const days = error.message.split("_")[1];
      return res
        .status(400)
        .json({
          message: `Aguarde ${days} dias para trocar o username novamente.`,
        });
    }
    res.status(500).json({ message: "Erro interno ao atualizar perfil." });
  }
};

const getPublicProfile = async (req, res) => {
  const { username } = req.params;
  try {
    const snapshot = await db
      .collection("users")
      .where("username", "==", username)
      .limit(1)
      .get();
    if (snapshot.empty)
      return res.status(404).json({ message: "Não encontrado." });

    const data = snapshot.docs[0].data();
    delete data.email;
    delete data.genreCounts;

    res.status(200).json({ uid: snapshot.docs[0].id, ...data });
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
};

const searchUsers = async (req, res) => {
  const { query } = req.query;
  if (!query || query.length < 3) return res.status(200).json([]);

  try {
    const snapshot = await db
      .collection("users")
      .where("username", ">=", query.toLowerCase())
      .where("username", "<=", query.toLowerCase() + "\uf8ff")
      .limit(10)
      .get();

    const users = snapshot.docs.map((d) => ({ uid: d.id, ...d.data() }));
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
};

const resetPassword = async (req, res) => {
  const { email } = req.body;
  if (!email)
    return res.status(200).json({ message: "Processamento iniciado." });
  try {
    const userQuery = await db
      .collection("users")
      .where("email", "==", email)
      .limit(1)
      .get();
    if (!userQuery.empty) {
      const apiKey = process.env.FIREBASE_WEB_API_KEY;
      await axios.post(
        `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`,
        { requestType: "PASSWORD_RESET", email: email },
      );
    }
    res.status(200).json({ message: "Solicitação recebida." });
  } catch (error) {
    res.status(200).json({ message: "Solicitação recebida." });
  }
};

const deleteAccount = async (req, res) => {
  const { uid } = req.user;
  
  try {
    await deleteCollectionData('reviews', uid);
    await deleteCollectionData('comments', uid);
    await deleteCollectionData('interactions', uid);
    await deleteCollectionData('shared_lists', uid);

    const userRef = db.collection('users').doc(uid);
    await deleteSubcollections(userRef);

    await userRef.delete();
    await admin.auth().deleteUser(uid);

    res.status(200).json({ message: 'Conta e dados excluídos completamente.' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao excluir conta' });
  }
};

module.exports = {
  register,
  login,
  logout,
  getMe,
  updateProfile,
  getPublicProfile,
  searchUsers,
  resetPassword,
  deleteAccount
};