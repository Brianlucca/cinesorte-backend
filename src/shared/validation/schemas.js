const { z } = require('zod');

const nameRegex = /^[A-Za-zÀ-ÖØ-öø-ÿ\s]+$/;
const passwordRegex = /^(?=.*[A-Z])(?=.*[!@#$&*.,?_~\-]).{6,}$/;
const safeUrlSchema = z
  .string()
  .url('URL inválida.')
  .refine((value) => value.startsWith('https://'), 'A URL deve usar HTTPS.');

const registerSchema = z.object({
  name: z.string().min(2).max(50).regex(nameRegex),
  nickname: z.string().min(3).max(30).regex(/^[a-z0-9_]+$/),
  email: z.string().email(),
  password: z.string().min(6).regex(passwordRegex),
  turnstileToken: z.string().min(1, 'Verificação de segurança obrigatória.'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  turnstileToken: z.string().min(1, 'Verificação de segurança obrigatória.'),
});

const resendVerificationEmailSchema = z.object({
  email: z.string().email(),
});

const changeEmailSchema = z.object({
  newEmail: z.string().email(),
  currentPassword: z.string().min(1),
});

const verifyCurrentPasswordSchema = z.object({
  currentPassword: z.string().min(1),
});

const confirmEmailChangeSchema = z.object({
  token: z.string().min(32).max(128),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6).regex(passwordRegex),
});

const linkGoogleSchema = z.object({
  idToken: z.string().min(1),
  currentPassword: z.string().min(1),
});

const linkPasswordSchema = z.object({
  idToken: z.string().min(1),
  newPassword: z.string().min(6).regex(passwordRegex),
});

const accountDeletionTokenSchema = z.object({
  token: z.string().min(40).max(256),
});

const profileSchema = z.object({
  name: z.string().min(2).max(50).regex(nameRegex).optional(),
  username: z.string().min(3).max(30).regex(/^[a-z0-9_]+$/).optional(),
  bio: z.string().max(300).optional(),
  photoURL: safeUrlSchema.optional(),
  backgroundURL: safeUrlSchema.optional(),
});

const interactionSchema = z.object({
  mediaId: z.union([z.string(), z.number()]),
  mediaType: z.enum(['movie', 'tv', 'person', 'episode']).optional(),
  action: z.enum(['like', 'dislike', 'watched', 'favorite']),
  mediaTitle: z.string().optional(),
  posterPath: z.string().nullable().optional(),
  backdropPath: z.string().nullable().optional(),
  poster_path: z.string().nullable().optional(),
  backdrop_path: z.string().nullable().optional(),
});

const reviewSchema = z.object({
  mediaId: z.union([z.string(), z.number()]),
  mediaType: z.enum(['movie', 'tv', 'person', 'episode']),
  rating: z.number().min(0).max(10).optional().nullable(),
  text: z.string().max(2000).optional(),
  mediaTitle: z.string().optional(),
  posterPath: z.string().nullable().optional(),
  backdropPath: z.string().nullable().optional(),
});

const reviewUpdateSchema = z.object({
  text: z.string().max(2000).optional(),
  rating: z.number().min(0).max(10).optional().nullable(),
});

const commentSchema = z
  .object({
    reviewId: z.string(),
    text: z.string().max(1000).optional().default(''),
    parentId: z.string().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.text?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Comentário deve ter texto.',
        path: ['text'],
      });
    }
  });

const commentUpdateSchema = z.object({
  text: z.string().trim().min(1, 'Comentário deve ter texto.').max(1000),
});

const listSchema = z.object({
  listId: z.string().optional(),
  listName: z.string().min(1).max(60),
  description: z.string().max(300).optional(),
  isPublic: z.boolean().default(true),
});

const addToListSchema = z.object({
  listId: z.string(),
  mediaItem: z.object({
    id: z.union([z.number(), z.string()]),
    title: z.string().optional(),
    name: z.string().optional(),
    poster_path: z.string().nullable().optional(),
    backdrop_path: z.string().nullable().optional(),
    media_type: z.string().optional(),
    vote_average: z.number().optional(),
    release_date: z.string().nullable().optional(),
    first_air_date: z.string().nullable().optional(),
    year: z.string().nullable().optional(),
  }),
});

const supportTicketSchema = z.object({
  subject: z.enum(['SUGESTAO', 'BUG_REPORT', 'PROBLEMA_CONTA', 'DENUNCIA', 'OUTRO_ASSUNTO']),
  message: z.string().trim().min(10, 'A mensagem deve ter pelo menos 10 caracteres.').max(1000, 'A mensagem pode ter no máximo 1000 caracteres.'),
});

const messageMediaSchema = z.object({
  id: z.union([z.string(), z.number()]),
  mediaId: z.union([z.string(), z.number()]).optional(),
  mediaType: z.enum(['movie', 'tv', 'episode']).optional(),
  title: z.string().trim().min(1).max(160),
  posterPath: z.string().nullable().optional(),
  poster_path: z.string().nullable().optional(),
  backdropPath: z.string().nullable().optional(),
  backdrop_path: z.string().nullable().optional(),
  voteAverage: z.number().min(0).max(10).nullable().optional(),
  vote_average: z.number().min(0).max(10).nullable().optional(),
  releaseDate: z.string().nullable().optional(),
  release_date: z.string().nullable().optional(),
  firstAirDate: z.string().nullable().optional(),
  first_air_date: z.string().nullable().optional(),
  note: z.string().trim().max(500).optional(),
});

const createDirectConversationSchema = z
  .object({
    targetUserId: z.string().trim().min(1).max(128).optional(),
    targetUsername: z.string().trim().min(3).max(30).regex(/^[a-z0-9_]+$/).optional(),
  })
  .refine((data) => data.targetUserId || data.targetUsername, 'Informe o usuario da conversa.');

const createGroupConversationSchema = z.object({
  name: z.string().trim().min(2).max(60),
  memberIds: z.array(z.string().trim().min(1).max(128)).max(30).optional(),
  memberUsernames: z.array(z.string().trim().min(3).max(30).regex(/^[a-z0-9_]+$/)).max(30).optional(),
  photoURL: safeUrlSchema.optional(),
});

const sendMessageSchema = z
  .object({
    text: z.string().trim().max(2000).optional().default(''),
    media: messageMediaSchema.nullable().optional(),
  })
  .refine((data) => data.text.length > 0 || data.media, 'Mensagem deve ter texto ou card de midia.');

const updateGroupConversationSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  photoURL: safeUrlSchema.nullable().optional(),
});

const addGroupMembersSchema = z
  .object({
    memberIds: z.array(z.string().trim().min(1).max(128)).max(30).optional(),
    memberUsernames: z.array(z.string().trim().min(3).max(30).regex(/^[a-z0-9_]+$/)).max(30).optional(),
  })
  .refine((data) => (data.memberIds?.length || 0) > 0 || (data.memberUsernames?.length || 0) > 0, 'Informe membros para adicionar.');

module.exports = {
  registerSchema,
  loginSchema,
  resendVerificationEmailSchema,
  changeEmailSchema,
  verifyCurrentPasswordSchema,
  confirmEmailChangeSchema,
  changePasswordSchema,
  linkGoogleSchema,
  linkPasswordSchema,
  accountDeletionTokenSchema,
  profileSchema,
  interactionSchema,
  reviewSchema,
  reviewUpdateSchema,
  commentSchema,
  commentUpdateSchema,
  listSchema,
  addToListSchema,
  supportTicketSchema,
  createDirectConversationSchema,
  createGroupConversationSchema,
  sendMessageSchema,
  updateGroupConversationSchema,
  addGroupMembersSchema,
};
