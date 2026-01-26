const express = require('express');
const router = express.Router();
const interactionController = require('../controllers/interactionController');
const listController = require('../controllers/listController');
const userController = require('../controllers/userController');
const authController = require('../controllers/authController');
const { verifyToken, optionalVerify, requireTerms } = require('../middleware/authMiddleware');



router.get('/search', verifyToken, userController.searchUsers);
router.get('/profile/:username', userController.getUserProfile);
router.put('/me', verifyToken, authController.updateProfile);
router.post('/terms', verifyToken, userController.acceptTerms);
router.post('/interact', verifyToken, interactionController.recordInteraction);
router.get('/interactions', verifyToken, interactionController.getUserInteractions);
router.get('/diary', verifyToken, interactionController.getWatchDiary);
router.post('/lists', verifyToken, requireTerms, listController.upsertList);
router.post('/lists/clone', verifyToken, requireTerms, listController.cloneList);
router.post('/lists/add', verifyToken, listController.addMediaToList);
router.get('/lists/:username', optionalVerify, listController.getUserLists);
router.delete('/lists/:listId', verifyToken, listController.deleteList);
router.delete('/lists/:listId/media/:mediaId', verifyToken, listController.removeMediaFromList);



module.exports = router;