import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const IV_BYTES = 12;
export const KEY_BYTES = 32;

// Stored as "v1:<iv>:<authTag>:<ciphertext>", each part base64. The version lets us rotate keys later.
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const parts = [iv, authTag, ciphertext].map((b) => b.toString("base64"));
  return [VERSION, ...parts].join(":");
}

// Throws if the data was changed or the key is wrong.
export function decrypt(blob: string, key: Buffer): string {
  const [version, iv, authTag, ciphertext, ...rest] = blob.split(":");
  if (version !== VERSION || !iv || !authTag || !ciphertext || rest.length) {
    throw new Error("Unrecognized encrypted value");
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
