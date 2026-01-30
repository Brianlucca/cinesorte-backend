const AppError = require('../utils/AppError');

module.exports = (schema) => (req, res, next) => {
  try {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const issues = result.error?.issues || result.error?.errors || [];
      const messages = issues.map((e) => e.message).join(', ');
      return next(new AppError(messages || 'Dados inválidos.', 400));
    }

    req.body = result.data;
    next();
  } catch (err) {
    return next(new AppError('Erro interno na validação.', 500));
  }
};