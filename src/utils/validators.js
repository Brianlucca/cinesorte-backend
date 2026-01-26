const z = require("zod");

const nameRegex = /^[A-Za-zÀ-ÖØ-öø-ÿ\s]+$/;
const passwordRegex = /^(?=.*[A-Z])(?=.*[!@#$&*.,?_~\-]).{6,}$/;

const offensivePatterns = [
    /bosta/i, /merda/i, /caralho/i, /porra/i, /puta/i, /puto/i, /vadia/i, /vagabunda/i,
    /piranha/i, /arrombado/i, /arrombada/i, /viado/i, /viadinho/i, /bicha/i, /boiola/i,
    /maricas/i, /traveco/i, /sapatão/i, /baitola/i, /preto de merda/i, /macaco/i, /nigger/i,
    /nigga/i, /senzala/i, /tição/i, /faggot/i, /retardado/i, /mongol/i, /autistinha/i,
    /idiota/i, /imbecil/i, /burro/i, /animal/i, /\bcu\b/i, /pinto/i, /buceta/i, /xoxota/i,
    /piroca/i, /caralhos/i, /cacete/i, /foder/i, /foda-se/i, /chupar/i, /mamada/i,
    /gozar/i, /gozo/i, /nazista/i, /hitler/i, /suicidio/i, /se matar/i,
];

const containsProfanity = (text) => {
    if (!text) return false;
    return offensivePatterns.some(pattern => pattern.test(text));
};

const registerSchema = z.object({
    name: z.string()
        .min(2, "Nome muito curto.")
        .max(50, "Nome muito longo.")
        .regex(nameRegex, "O nome não pode conter números ou símbolos especiais."),
    nickname: z.string()
        .min(3, "Nickname deve ter no mínimo 3 caracteres.")
        .max(30, "Nickname muito longo.")
        .regex(/^[a-z0-9_]+$/, "Nickname deve conter apenas letras minúsculas, números e underline."),
    email: z.string().email("Email inválido."),
    password: z.string()
        .min(6, "A senha deve ter no mínimo 6 caracteres.")
        .regex(passwordRegex, "A senha deve conter pelo menos uma letra maiúscula e um caractere especial (!@#$&*).")
});

const profileSchema = z.object({
    name: z.string().min(2).max(50).regex(nameRegex, "O nome não pode conter números.").optional(),
    username: z.string().min(3).max(30).regex(/^[a-z0-9_]+$/, "Username inválido.").optional(),
    bio: z.string().max(300).optional(),
    photoURL: z.string().optional(),
    backgroundURL: z.string().optional()
});

const reviewSchema = z.object({
    mediaId: z.string().min(1),
    mediaType: z.enum(['movie', 'tv', 'person', 'episode']),
    rating: z.number().min(0).max(10),
    text: z.string().max(2000).optional().or(z.literal("")),
    mediaTitle: z.string().optional(),
    posterPath: z.string().optional().nullable().or(z.literal("")),
    backdropPath: z.string().optional().nullable().or(z.literal(""))
});

const commentSchema = z.object({
    reviewId: z.string(),
    text: z.string().min(1, "O comentário não pode estar vazio.").max(1000, "O comentário é muito longo."),
    parentId: z.string().optional().nullable()
});

const addToListSchema = z.object({
    id: z.number().or(z.string()),
    title: z.string(),
    poster_path: z.string().optional().nullable(),
    backdrop_path: z.string().optional().nullable(),
    media_type: z.string().optional(),
    vote_average: z.number().optional()
});

module.exports = { containsProfanity, registerSchema, profileSchema, reviewSchema, commentSchema, addToListSchema };