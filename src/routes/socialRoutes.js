const express = require('express');
const router = express.Router();
const interactionController = require('../controllers/interactionController');
const socialController = require('../controllers/socialController');
const listController = require('../controllers/listController');
const { verifyToken } = require('../middleware/authMiddleware');

router.post('/interact', verifyToken, interactionController.recordInteraction);
router.get('/interactions', verifyToken, interactionController.getUserInteractions);

router.post('/follow', verifyToken, socialController.followUser);
router.delete('/unfollow/:targetUserId', verifyToken, socialController.unfollowUser);
router.post('/reviews', verifyToken, socialController.addReview);
router.get('/reviews/:mediaId', socialController.getMediaReviews);

router.post('/lists', verifyToken, listController.upsertList);
router.get('/lists', verifyToken, listController.getUserLists);
router.delete('/lists/:listId', verifyToken, listController.deleteList);
router.delete('/lists/:listId/media/:mediaId', verifyToken, listController.removeMediaFromList);

module.exports = router;