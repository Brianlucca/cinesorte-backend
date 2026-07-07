const express = require("express");
const messageController = require("../controllers/messageController");
const { verifyToken } = require("../middleware/auth");
const validate = require("../middleware/validate");
const {
  addGroupMembersSchema,
  createDirectConversationSchema,
  createGroupConversationSchema,
  sendMessageSchema,
  updateGroupConversationSchema,
} = require("../schemas/schemas");

const router = express.Router();

router.use(verifyToken);

router.get("/stream", messageController.streamConversations);
router.get("/conversations", messageController.listConversations);
router.get("/conversations/hidden-owned", messageController.listHiddenOwnedGroups);
router.post("/conversations/direct", validate(createDirectConversationSchema), messageController.createDirectConversation);
router.post("/conversations/group", validate(createGroupConversationSchema), messageController.createGroupConversation);
router.get("/conversations/:conversationId/stream", messageController.streamMessages);
router.get("/conversations/:conversationId/messages", messageController.getMessages);
router.post("/conversations/:conversationId/messages", validate(sendMessageSchema), messageController.sendMessage);
router.post("/conversations/:conversationId/read", messageController.markConversationRead);
router.post("/conversations/:conversationId/restore", messageController.restoreConversation);
router.patch("/conversations/:conversationId/group", validate(updateGroupConversationSchema), messageController.updateGroupConversation);
router.post("/conversations/:conversationId/members", validate(addGroupMembersSchema), messageController.addGroupMembers);
router.delete("/conversations/:conversationId/members/:memberId", messageController.removeGroupMember);
router.delete("/conversations/:conversationId", messageController.deleteConversationForUser);
router.delete("/conversations/:conversationId/group", messageController.deleteGroupConversation);
router.get("/unread-count", messageController.getUnreadCount);

module.exports = router;
