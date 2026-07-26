const catchAsync = require("../../shared/utils/catchAsync");
const service = require("./watchParty.service");

exports.createRoom = catchAsync(async (req, res) => {
  const room = await service.createRoom(req.body, req.user);
  res.status(201).json(room);
});
exports.listMyRooms = catchAsync(async (req, res) => {
  res.status(200).json(await service.listMyRooms(req.user.uid));
});
exports.listPublicRooms = catchAsync(async (req, res) => {
  res.status(200).json(await service.listPublicRooms(req.user.uid));
});
exports.listFollowingRooms = catchAsync(async (req, res) => {
  res.status(200).json(await service.listFollowingRooms(req.user.uid));
});
exports.getRoom = catchAsync(async (req, res) => {
  res.status(200).json(await service.getRoom(req.params.roomId, req.user));
});
exports.joinRoom = catchAsync(async (req, res) => {
  res.status(200).json(await service.joinByCode(req.body.code, req.user));
});
exports.updateSettings = catchAsync(async (req, res) => {
  res
    .status(200)
    .json(
      await service.updateSettings(req.params.roomId, req.body, req.user.uid),
    );
});
exports.deleteRoom = catchAsync(async (req, res) => {
  await service.deleteRoom(req.params.roomId, req.user.uid);
  res.status(204).send();
});
exports.blockUser = catchAsync(async (req, res) => {
  await service.blockUser(req.params.roomId, req.body.userId, req.user.uid);
  res.status(204).send();
});
exports.addQueueItem = catchAsync(async (req, res) => {
  res
    .status(201)
    .json(await service.addQueueItem(req.params.roomId, req.body, req.user));
});
exports.getStorageStatus = catchAsync(async (req, res) => {
  res.status(200).json(await service.getStorageStatus(req.user));
});
