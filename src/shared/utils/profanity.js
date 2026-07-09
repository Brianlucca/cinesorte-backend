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

module.exports = { containsProfanity };