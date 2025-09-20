const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const listController = require('../controllers/listController');
const { verifyToken } = require('../middleware/authMiddleware');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.get('/me', verifyToken, authController.getMe);

router.post('/lists', verifyToken, listController.saveList);
router.get('/lists', verifyToken, listController.getLists);
router.delete('/lists/:listId', verifyToken, listController.deleteList);
router.delete('/lists/:listId/movies/:movieId', verifyToken, listController.removeMovieFromList);

module.exports = router;