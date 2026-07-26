const { z } = require("zod");

const privacySchema = z.enum(["public", "invite", "followers", "following"]);
const selectedUserIdsSchema = z.array(z.string().min(1).max(128)).max(100);
const createRoomSchema = z.object({
  name: z.string().trim().min(3).max(48),
  service: z.enum(["screen", "local"]),
  privacy: privacySchema.default("invite"),
  selectedUserIds: selectedUserIdsSchema.default([]),
  allowGuestControl: z.boolean().default(false),
});
const joinRoomSchema = z.object({ code: z.string().trim().toUpperCase().min(6).max(8) });
const updateRoomSchema = z.object({
  privacy: privacySchema.optional(),
  selectedUserIds: selectedUserIdsSchema.optional(),
  allowGuestControl: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, "Nenhuma alteração informada.");
const memberActionSchema = z.object({ userId: z.string().min(1).max(128) });
const queueItemSchema = z.object({ videoId: z.string().trim().min(1).max(32), title: z.string().trim().min(1).max(120), thumbnail: z.string().url().optional().nullable() });
const messageSchema = z.object({ body: z.string().trim().min(1).max(500) });

module.exports = { createRoomSchema, joinRoomSchema, updateRoomSchema, memberActionSchema, queueItemSchema, messageSchema };
