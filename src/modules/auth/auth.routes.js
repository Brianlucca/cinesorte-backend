const express = require('express');
const router = express.Router();
const authController = require("./auth.controller");
const userController = require("../users/user.controller");
const { verifyToken } = require("../../shared/middleware/auth");
const { authLimiter, registerLimiter, verificationEmailLimiter } = require("../../shared/middleware/security");
const validate = require("../../shared/middleware/validate");
const {
  registerSchema,
  loginSchema,
  resendVerificationEmailSchema,
  changeEmailSchema,
  verifyCurrentPasswordSchema,
  confirmEmailChangeSchema,
  changePasswordSchema,
  linkGoogleSchema,
  linkPasswordSchema,
  profileSchema,
  supportTicketSchema,
} = require("../../shared/validation/schemas");

router.post('/register', registerLimiter, validate(registerSchema), authController.register);
router.post('/login', authLimiter, validate(loginSchema), authController.login);
router.post(
  '/resend-verification-email',
  verificationEmailLimiter,
  validate(resendVerificationEmailSchema),
  authController.resendVerificationEmail
);
router.post('/auth/google', authLimiter, authController.googleAuth);
router.post('/logout', authController.logout);
router.get('/me', verifyToken, authController.getMe);
router.get('/security', verifyToken, authController.getSecurityOverview);
router.delete('/security/extensions/:tokenId', verifyToken, authController.revokeExtensionDevice);
router.post('/security/verify-password', verifyToken, validate(verifyCurrentPasswordSchema), authController.verifyCurrentPassword);
router.post('/security/change-email', verifyToken, validate(changeEmailSchema), authController.requestEmailChange);
router.post('/security/confirm-email-change', validate(confirmEmailChangeSchema), authController.confirmEmailChange);
router.post('/security/change-password', verifyToken, validate(changePasswordSchema), authController.changePassword);
router.post('/security/link-google', verifyToken, validate(linkGoogleSchema), authController.linkGoogleAccount);
router.post('/security/link-password', verifyToken, validate(linkPasswordSchema), authController.linkPasswordAccount);
router.put('/me', verifyToken, validate(profileSchema), authController.updateProfile);
router.post('/me/delete-request', verifyToken, authController.requestAccountDeletion);
router.delete('/me', verifyToken, authController.deleteAccount);
router.get('/profile/:username', verifyToken, authController.getPublicProfile);
router.get('/search', verifyToken, userController.searchUsers);
router.post('/reset-password', authController.resetPassword);
router.get('/support/tickets', verifyToken, userController.getMySupportTickets);
router.post('/support/tickets', verifyToken, validate(supportTicketSchema), userController.createSupportTicket);

module.exports = router;
