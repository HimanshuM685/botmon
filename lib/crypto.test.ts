import { expect, it } from "vitest";
import { randomBytes } from "node:crypto";

it("encrypt/decrypt round-trips and rejects tampering", async () => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const { encrypt, decrypt } = await import("./crypto");
  const blob = encrypt("secret 😊");
  expect(decrypt(blob)).toBe("secret 😊");
  const bad = Buffer.from(blob, "base64");
  bad[bad.length - 1] ^= 1;
  expect(() => decrypt(bad.toString("base64"))).toThrow();
});
