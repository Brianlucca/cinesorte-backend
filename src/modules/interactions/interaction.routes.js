const express = require('express');
const router = express.Router();
const interactionController = require("./interaction.controller");
const listController = require("../lists/list.controller");
const userController = require("../users/user.controller");
const authController = require("../auth/auth.controller");
const { verifyToken, optionalVerify, requireTerms } = require("../../shared/middleware/auth");
const validate = require("../../shared/middleware/validate");
const { listSchema, addToListSchema, profileSchema, interactionSchema } = require("../../shared/validation/schemas");

router.get('/search', verifyToken, userController.searchUsers);
router.get('/profile/:username', userController.getUserProfile);
router.put('/me', verifyToken, validate(profileSchema), authController.updateProfile);
router.post('/terms', verifyToken, userController.acceptTerms);

router.post('/interact', verifyToken, validate(interactionSchema), interactionController.recordInteraction);
router.get('/interactions', verifyToken, interactionController.getUserInteractions);
router.get('/diary', verifyToken, interactionController.getWatchDiary);

router.post('/lists', verifyToken, requireTerms, validate(listSchema), listController.upsertList);
router.post('/lists/clone', verifyToken, requireTerms, listController.cloneList);
router.post('/lists/add', verifyToken, validate(addToListSchema), listController.addMediaToList);
router.get('/lists/:username', verifyToken, listController.getUserLists);
router.delete('/lists/:listId', verifyToken, listController.deleteList);
router.delete('/lists/:listId/media/:mediaId', verifyToken, listController.removeMediaFromList);

module.exports = router;