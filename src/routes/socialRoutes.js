const express = require('express');
const router = express.Router();

// Importando os 4 controladores organizados
const socialController = require('../controllers/socialController');
const reviewController = require('../controllers/reviewController');
const feedController = require('../controllers/feedController');
const listController = require('../controllers/listController');

const { verifyToken, optionalVerify } = require('../middleware/authMiddleware');

router.get('/feed/global', optionalVerify, feedController.getGlobalFeed);
router.get('/feed/following', verifyToken, feedController.getFollowingFeed);
router.get('/feed/collections', feedController.getSharedListsFeed);

router.post('/follow', verifyToken, socialController.followUser);
router.delete('/unfollow/:targetUserId', verifyToken, socialController.unfollowUser);
router.get('/check-follow/:targetUserId', verifyToken, socialController.checkFollowStatus);
router.get('/suggestions', verifyToken, socialController.getSuggestions);
router.get('/stats', verifyToken, socialController.getUserStats);
router.get('/profile-stats/:userId', socialController.getProfileStats);
router.get('/match/:targetUserId', verifyToken, socialController.getMatchPercentage);
router.get('/followers/:userId', socialController.getUserFollowersList);
router.get('/following/:userId', socialController.getUserFollowingList);

router.post('/reviews', verifyToken, reviewController.addReview);
router.delete('/reviews/:reviewId', verifyToken, reviewController.deleteReview);
router.get('/reviews/:mediaId', optionalVerify, reviewController.getMediaReviews);
router.get('/user-reviews/:username', optionalVerify, reviewController.getUserReviews);
router.post('/reviews/:reviewId/like', verifyToken, reviewController.toggleLikeReview);
router.post('/comments', verifyToken, reviewController.addComment);
router.delete('/comments/:commentId', verifyToken, reviewController.deleteComment);
router.get('/comments/:reviewId', reviewController.getComments);

router.post('/share-list', verifyToken, listController.shareList);
router.get('/lists/:username/:listId', listController.getPublicListDetails);

module.exports = router;