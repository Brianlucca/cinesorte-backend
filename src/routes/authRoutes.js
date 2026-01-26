const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { verifyToken } = require("../middleware/authMiddleware");
const { authLimiter } = require("../middleware/securityMiddleware");

router.post("/register", authController.register);
router.post("/login", authLimiter, authController.login);
router.post("/logout", authController.logout);
router.get("/me", verifyToken, authController.getMe);
router.put("/me", verifyToken, authController.updateProfile);
router.delete("/me", verifyToken, authController.deleteAccount);
router.get("/profile/:username", authController.getPublicProfile);
router.get("/search", verifyToken, authController.searchUsers);
router.post("/reset-password", authController.resetPassword);

module.exports = router;