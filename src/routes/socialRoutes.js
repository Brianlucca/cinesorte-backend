const express = require('express');
const router = express.Router();
const socialController = require('../controllers/socialController');
const reviewController = require('../controllers/reviewController');
const feedController = require('../controllers/feedController');
const listController = require('../controllers/listController');
const { verifyToken, optionalVerify } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { reviewSchema, commentSchema } = require('../schemas/schemas');

router.get('/feed/global', verifyToken, feedController.getGlobalFeed);
router.get('/feed/following', verifyToken, feedController.getFollowingFeed);
router.get('/feed/collections', verifyToken, feedController.getSharedListsFeed);

router.post('/follow', verifyToken, socialController.followUser);
router.delete('/unfollow/:targetUserId', verifyToken, socialController.unfollowUser);
router.get('/check-follow/:targetUserId', verifyToken, socialController.checkFollowStatus);
router.get('/suggestions', verifyToken, socialController.getSuggestions);
router.get('/stats', verifyToken, socialController.getUserStats);
router.get('/profile-stats/:userId', verifyToken, socialController.getProfileStats);
router.get('/match/:targetUserId', verifyToken, socialController.getMatchPercentage);
router.get('/followers/:userId', verifyToken, socialController.getUserFollowersList);
router.get('/following/:userId', verifyToken, socialController.getUserFollowingList);

router.post('/reviews', verifyToken, validate(reviewSchema), reviewController.addReview);
router.put('/reviews/:reviewId', verifyToken, reviewController.updateReview);
router.delete('/reviews/:reviewId', verifyToken, reviewController.deleteReview);
router.get('/reviews/:mediaId', verifyToken, reviewController.getMediaReviews);
router.get('/user-reviews/:username', verifyToken, reviewController.getUserReviews);
router.post('/reviews/:reviewId/like', verifyToken, reviewController.toggleLikeReview);

router.post('/comments', verifyToken, validate(commentSchema), reviewController.addComment);
router.put('/comments/:commentId', verifyToken, reviewController.updateComment);
router.delete('/comments/:commentId', verifyToken, reviewController.deleteComment);
router.get('/comments/:reviewId', verifyToken, reviewController.getComments);

router.post('/share-list', verifyToken, listController.shareList);
router.get('/lists/:username/:listId', verifyToken, listController.getPublicListDetails);

module.exports = router;