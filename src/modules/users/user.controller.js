const { db } = require("../../config/firebase");
const catchAsync = require("../../shared/utils/catchAsync");
const AppError = require("../../shared/errors/AppError");
const { CURRENT_TERMS_VERSION } = require("../../config/legal");
const { rememberLocal } = require("../../shared/cache/cache.service");
const {
  publicProfileKey,
  userSearchKey,
} = require("../../shared/cache/cache.keys");

exports.searchUsers = catchAsync(async (req, res, next) => {
  const query = String(req.query.query || "").trim().toLowerCase();
  if (query.length < 3) return res.status(200).json([]);

  const users = await rememberLocal(userSearchKey(query), 300, async () => {
    const snapshot = await db
      .collection("users")
      .where("username", ">=", query)
      .where("username", "<=", query + "\uf8ff")
      .limit(10)
      .get();

    return snapshot.docs.map((doc) => ({
      name: doc.data().name,
      username: doc.data().username,
      photoURL: doc.data().photoURL,
    }));
  });
  res.status(200).json(users);
});

exports.getUserProfile = catchAsync(async (req, res, next) => {
  const { username } = req.params;
  const cached = await rememberLocal(publicProfileKey(username), 300, async () => {
    const snapshot = await db
      .collection("users")
      .where("username", "==", username)
      .limit(1)
      .get();
    if (snapshot.empty) return { found: false, profile: null };

    const userData = snapshot.docs[0].data();
    return {
      found: true,
      profile: {
        name: userData.name,
        username: userData.username,
        photoURL: userData.photoURL,
        backgroundURL: userData.backgroundURL,
        bio: userData.bio,
        level: userData.level || 1,
        levelTitle: userData.levelTitle || "Espectador",
        totalXp: userData.totalXp || 0,
        reviewsCount: userData.reviewsCount || 0,
        watchedCount: userData.watchedCount || 0,
        followersCount: userData.followersCount || 0,
        followingCount: userData.followingCount || 0,
        createdAt: userData.createdAt,
        trophies: userData.trophies || [],
        genreCounts: userData.genreCounts || {},
      },
    };
  });
  if (!cached.found) return next(new AppError("Usuário não encontrado", 404));

  if (typeof res.set === "function") {
    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  }
  res.status(200).json(cached.profile);
});

exports.acceptTerms = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const { version } = req.body;

  if (version !== CURRENT_TERMS_VERSION) {
    return next(new AppError("Versão dos termos inválida ou desatualizada.", 400));
  }

  await db.collection("users").doc(uid).update({
    termsVersion: version,
    termsAcceptedAt: new Date(),
    termsAcceptedUserAgent: req.headers["user-agent"] || "unknown",
  });
  res.status(200).json({ message: "Termos aceitos." });
});
