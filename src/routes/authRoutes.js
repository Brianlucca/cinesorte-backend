const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const userController = require("../controllers/userController");
const { verifyToken } = require("../middleware/auth");
const { authLimiter, registerLimiter } = require("../middleware/security");
const validate = require('../middleware/validate');
const { registerSchema, profileSchema } = require('../schemas/schemas');


router.post("/register", registerLimiter, validate(registerSchema), authController.register);
router.post("/login", authLimiter, authController.login);
router.post("/logout", authController.logout);
router.get("/me", verifyToken, authController.getMe);
router.put("/me", verifyToken, validate(profileSchema), authController.updateProfile);
router.delete("/me", verifyToken, authController.deleteAccount);
router.get("/profile/:username", verifyToken, authController.getPublicProfile);
router.get("/search", verifyToken, userController.searchUsers);
router.post("/reset-password", authController.resetPassword);

module.exports = router;