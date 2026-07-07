const crypto = require("crypto");
const serviceAccount = require("../../serviceAccountKey.json");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey() {
  const secret =
    process.env.MESSAGE_ENCRYPTION_SECRET ||
    process.env.SESSION_SECRET ||
    serviceAccount.private_key ||
    serviceAccount.project_id;

  return crypto.createHash("sha256").update(String(secret)).digest();
}

function encryptText(text = "") {
  if (!text) return null;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);

  return {
    v: 1,
    alg: ALGORITHM,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    value: encrypted.toString("base64"),
  };
}

function decryptText(payload) {
  if (!payload) return "";
  if (typeof payload === "string") return payload;

  try {
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      getKey(),
      Buffer.from(payload.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payload.value, "base64")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    return "";
  }
}

module.exports = { encryptText, decryptText };
