const { db } = require("../config/firebase");
const admin = require("firebase-admin");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");

exports.searchUsers = catchAsync(async (req, res, next) => {
  const { query } = req.query;
  if (!query || query.length < 3) return res.status(200).json([]);

  const snapshot = await db
    .collection("users")
    .where("username", ">=", query.toLowerCase())
    .where("username", "<=", query.toLowerCase() + "\uf8ff")
    .limit(10)
    .get();

  const users = snapshot.docs.map((doc) => ({
    name: doc.data().name,
    username: doc.data().username,
    photoURL: doc.data().photoURL,
  }));
  res.status(200).json(users);
});

exports.getUserProfile = catchAsync(async (req, res, next) => {
  const { username } = req.params;
  const snapshot = await db
    .collection("users")
    .where("username", "==", username)
    .limit(1)
    .get();
  if (snapshot.empty) return next(new AppError("Usuário não encontrado", 404));

  const userDoc = snapshot.docs[0];
  const userData = userDoc.data();
  delete userData.email;

  res.status(200).json({ ...userData });
});

exports.acceptTerms = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const { version } = req.body;

  await db
    .collection("users")
    .doc(uid)
    .update({
      termsVersion: version,
      termsAcceptedAt: new Date(),
      termsAcceptedUserAgent: req.headers["user-agent"] || "unknown",
    });
  res.status(200).json({ message: "Termos aceitos." });
});
