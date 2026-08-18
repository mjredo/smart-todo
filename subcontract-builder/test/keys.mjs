/* Throwaway RSA keys for the tests, in the two PEM shapes DocuSign and Cloudflare
 * hand you. Generated per run — nothing sensitive is ever committed. */
import crypto from "node:crypto";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });

export const pkcs1 = privateKey.export({ type: "pkcs1", format: "pem" });
export const pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" });
export const publicPem = publicKey.export({ type: "spki", format: "pem" });
