const messageService = require("../services/messageService");
const catchAsync = require("../utils/catchAsync");

function prepareStream(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");
}

function sendStreamEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

exports.listConversations = catchAsync(async (req, res) => {
  const conversations = await messageService.listConversations(req.user.uid);
  res.status(200).json(conversations);
});

exports.listHiddenOwnedGroups = catchAsync(async (req, res) => {
  const conversations = await messageService.listHiddenOwnedGroups(req.user.uid);
  res.status(200).json(conversations);
});

exports.createDirectConversation = catchAsync(async (req, res) => {
  const conversation = await messageService.createDirectConversation(req.user, req.body);
  res.status(200).json(conversation);
});

exports.createGroupConversation = catchAsync(async (req, res) => {
  const conversation = await messageService.createGroupConversation(req.user, req.body);
  res.status(201).json(conversation);
});

exports.getMessages = catchAsync(async (req, res) => {
  const messages = await messageService.getMessages(req.user.uid, req.params.conversationId, req.query);
  res.status(200).json(messages);
});

exports.sendMessage = catchAsync(async (req, res) => {
  const message = await messageService.sendMessage(req.user, req.params.conversationId, req.body);
  res.status(201).json(message);
});

exports.markConversationRead = catchAsync(async (req, res) => {
  const result = await messageService.markConversationRead(req.user.uid, req.params.conversationId);
  res.status(200).json(result);
});

exports.restoreConversation = catchAsync(async (req, res) => {
  const conversation = await messageService.restoreConversationForUser(req.user.uid, req.params.conversationId);
  res.status(200).json(conversation);
});

exports.updateGroupConversation = catchAsync(async (req, res) => {
  const conversation = await messageService.updateGroupConversation(req.user.uid, req.params.conversationId, req.body);
  res.status(200).json(conversation);
});

exports.addGroupMembers = catchAsync(async (req, res) => {
  const conversation = await messageService.addGroupMembers(req.user.uid, req.params.conversationId, req.body);
  res.status(200).json(conversation);
});

exports.removeGroupMember = catchAsync(async (req, res) => {
  const result = await messageService.removeGroupMember(req.user.uid, req.params.conversationId, req.params.memberId);
  res.status(200).json(result);
});

exports.deleteConversationForUser = catchAsync(async (req, res) => {
  const result = await messageService.deleteConversationForUser(req.user.uid, req.params.conversationId);
  res.status(200).json(result);
});

exports.deleteGroupConversation = catchAsync(async (req, res) => {
  const result = await messageService.deleteGroupConversation(req.user.uid, req.params.conversationId);
  res.status(200).json(result);
});

exports.getUnreadCount = catchAsync(async (req, res) => {
  const count = await messageService.getTotalUnreadCount(req.user.uid);
  res.status(200).json({ count });
});

exports.streamConversations = catchAsync(async (req, res) => {
  prepareStream(res);

  const cleanup = await messageService.subscribeConversations(req.user.uid, (payload) => {
    sendStreamEvent(res, "conversations", payload);
  });

  const heartbeat = setInterval(() => {
    res.write(": ping\n\n");
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    cleanup();
    res.end();
  });
});

exports.streamMessages = catchAsync(async (req, res) => {
  prepareStream(res);

  const cleanup = await messageService.subscribeMessages(
    req.user.uid,
    req.params.conversationId,
    (payload) => {
      sendStreamEvent(res, "messages", payload);
    }
  );

  const heartbeat = setInterval(() => {
    res.write(": ping\n\n");
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    cleanup();
    res.end();
  });
});
