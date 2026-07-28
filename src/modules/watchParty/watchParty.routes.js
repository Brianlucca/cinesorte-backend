const express = require("express");
const controller = require("./watchParty.controller");
const validate = require("../../shared/middleware/validate");
const { verifyToken } = require("../../shared/middleware/auth");
const { createRoomSchema, joinRoomSchema, updateRoomSchema, memberActionSchema, queueItemSchema } = require("./watchParty.schemas");

const router = express.Router();
router.use(verifyToken);
router.get("/rooms/mine", controller.listMyRooms);
router.get("/rooms/public", controller.listPublicRooms);
router.get("/rooms/following", controller.listFollowingRooms);
router.get("/rooms/live-version", controller.getLiveVersion);
router.get("/internal/storage", controller.getStorageStatus);
router.post("/rooms", validate(createRoomSchema), controller.createRoom);
router.post("/rooms/join", validate(joinRoomSchema), controller.joinRoom);
router.get("/rooms/:roomId", controller.getRoom);
router.patch("/rooms/:roomId", validate(updateRoomSchema), controller.updateSettings);
router.delete("/rooms/:roomId", controller.deleteRoom);
router.post("/rooms/:roomId/block", validate(memberActionSchema), controller.blockUser);
router.post("/rooms/:roomId/queue", validate(queueItemSchema), controller.addQueueItem);

module.exports = router;
