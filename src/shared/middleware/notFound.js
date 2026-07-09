module.exports = (req, res) => {
  res.status(404).json({
    status: "fail",
    message: `Rota ${req.originalUrl} não encontrada.`,
  });
};
