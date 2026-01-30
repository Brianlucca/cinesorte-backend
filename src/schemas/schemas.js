const { z } = require('zod');

const nameRegex = /^[A-Za-zÀ-ÖØ-öø-ÿ\s]+$/;
const passwordRegex = /^(?=.*[A-Z])(?=.*[!@#$&*.,?_~\-]).{6,}$/;

const registerSchema = z.object({
  name: z.string().min(2).max(50).regex(nameRegex),
  nickname: z.string().min(3).max(30).regex(/^[a-z0-9_]+$/),
  email: z.string().email(),
  password: z.string().min(6).regex(passwordRegex)
});

const profileSchema = z.object({
  name: z.string().min(2).max(50).regex(nameRegex).optional(),
  username: z.string().min(3).max(30).regex(/^[a-z0-9_]+$/).optional(),
  bio: z.string().max(300).optional(),
  photoURL: z.string().optional(),
  backgroundURL: z.string().optional()
});

const reviewSchema = z.object({
  mediaId: z.union([z.string(), z.number()]),
  mediaType: z.enum(['movie', 'tv', 'person', 'episode']),
  rating: z.number().min(0).max(10),
  text: z.string().max(2000).optional(),
  mediaTitle: z.string().optional(),
  posterPath: z.string().nullable().optional(),
  backdropPath: z.string().nullable().optional()
});

const commentSchema = z.object({
  reviewId: z.string(),
  text: z.string().min(1).max(1000),
  parentId: z.string().nullable().optional()
});

const listSchema = z.object({
  listId: z.string().optional(),
  listName: z.string().min(1).max(60),
  description: z.string().max(300).optional(),
  isPublic: z.boolean().default(true)
});

const addToListSchema = z.object({
  listId: z.string(),
  mediaItem: z.object({
    id: z.union([z.number(), z.string()]),
    title: z.string().optional(),
    poster_path: z.string().nullable().optional(),
    backdrop_path: z.string().nullable().optional(),
    media_type: z.string().optional(),
    vote_average: z.number().optional()
  })
});

module.exports = { 
  registerSchema, 
  profileSchema, 
  reviewSchema, 
  commentSchema, 
  listSchema, 
  addToListSchema 
};