import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

export type TokenClaims = {
  sub: string;
  username: string;
  role: "admin" | "user";
  exp: number;
};

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("base64url");
  const iterations = 210000;
  const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("base64url");
  return `pbkdf2$sha256$${iterations}$${salt}$${hash}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const [scheme, digest, iterationText, salt, storedHash] = encoded.split("$");
  if (scheme !== "pbkdf2" || digest !== "sha256" || !iterationText || !salt || !storedHash) {
    return false;
  }

  const iterations = Number(iterationText);
  const actual = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const expected = Buffer.from(storedHash, "base64url");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function signToken(claims: Omit<TokenClaims, "exp">, secret: string, ttlSeconds = 60 * 60 * 12): string {
  const header = { alg: "HS256", typ: "JWT" };
  const body: TokenClaims = {
    ...claims,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds
  };
  const encodedHeader = base64UrlJson(header);
  const encodedBody = base64UrlJson(body);
  const signature = createHmac("sha256", secret).update(`${encodedHeader}.${encodedBody}`).digest("base64url");
  return `${encodedHeader}.${encodedBody}.${signature}`;
}

export function verifyToken(token: string, secret: string): TokenClaims {
  const [encodedHeader, encodedBody, signature] = token.split(".");
  if (!encodedHeader || !encodedBody || !signature) {
    throw new Error("Malformed token.");
  }

  const expectedSignature = createHmac("sha256", secret).update(`${encodedHeader}.${encodedBody}`).digest("base64url");
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("Invalid token signature.");
  }

  const claims = JSON.parse(Buffer.from(encodedBody, "base64url").toString("utf8")) as TokenClaims;
  if (!claims.sub || !claims.username || !claims.role || !claims.exp) {
    throw new Error("Invalid token claims.");
  }
  if (claims.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("Token expired.");
  }
  return claims;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
