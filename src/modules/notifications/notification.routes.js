const express = require('express');
const router = express.Router();
const notificationController = require("./notification.controller");
const { verifyToken } = require("../../shared/middleware/auth");

router.get('/', verifyToken, notificationController.getNotifications);
router.put('/:notificationId/read', verifyToken, notificationController.markAsRead);
router.get('/count', verifyToken, notificationController.getUnreadCount);

module.exports = router;