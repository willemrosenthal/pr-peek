import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt, KEY_BYTES } from "./crypto";

const key = randomBytes(KEY_BYTES);
const token = "gho_exampletoken1234567890";

describe("encrypt and decrypt", () => {
  it("round trips", () => {
    expect(decrypt(encrypt(token, key), key)).toBe(token);
  });

  it("never stores the plain text", () => {
    expect(encrypt(token, key)).not.toContain(token);
  });

  it("gives a different result each time for the same input", () => {
    expect(encrypt(token, key)).not.toBe(encrypt(token, key));
  });

  it("fails with the wrong key", () => {
    const blob = encrypt(token, key);
    expect(() => decrypt(blob, randomBytes(KEY_BYTES))).toThrow();
  });

  it("fails if the data was changed", () => {
    const [version, iv, tag, ciphertext = ""] = encrypt(token, key).split(":");
    const flipped = Buffer.from(ciphertext, "base64");
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    const tampered = [version, iv, tag, flipped.toString("base64")].join(":");
    expect(() => decrypt(tampered, key)).toThrow();
  });

  it("rejects values that aren't in the expected format", () => {
    expect(() => decrypt("not-encrypted", key)).toThrow(/Unrecognized/);
    expect(() => decrypt("v2:a:b:c", key)).toThrow(/Unrecognized/);
  });

  it("tries each key in turn, so values from a previous key still read", () => {
    const previous = randomBytes(KEY_BYTES);
    const old = encrypt(token, previous);

    expect(decrypt(old, [key, previous])).toBe(token);
    expect(() => decrypt(old, [key])).toThrow();
  });
});
