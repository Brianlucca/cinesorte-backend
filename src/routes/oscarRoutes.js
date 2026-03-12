const express = require('express');
const oscarController = require('../controllers/oscarController');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.use(verifyToken);

router.post('/vote', oscarController.submitVote);
router.get('/my-votes', oscarController.getUserVotes);
router.get('/results', oscarController.getAllVotes);

module.exports = router;