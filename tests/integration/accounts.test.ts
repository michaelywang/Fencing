import { beforeEach, describe, expect, it } from "vitest";
import {
  acceptInvite,
  bootstrapAdmin,
  changePassword,
  completeReset,
  createInvite,
  createResetLinkForUser,
  getInvite,
  login,
  recoverAccount,
  setUserDisabled,
  setUserRole,
  setupStatus,
} from "@/server/services/accounts";
import { validateSessionToken } from "@/server/auth/sessions";
import { verifyPassword, hashPassword } from "@/server/auth/crypto";
import { AppError } from "@/server/errors";
import { makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

const meta = (ip = "203.0.113.5") => ({ ip, userAgent: "vitest", appUrl: "https://team.example" });
const tokenFromUrl = (url: string) => url.split("/").pop()!;

describe("password hashing", () => {
  it("hashes with scrypt and verifies", async () => {
    const h = await hashPassword("a very long passphrase");
    expect(h.startsWith("scrypt$32768$8$3$")).toBe(true);
    expect(await verifyPassword("a very long passphrase", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
});

describe("administrator bootstrap", () => {
  it("requires the setup token and only works once", async () => {
    expect((await setupStatus()).needsSetup).toBe(true);
    await expect(bootstrapAdmin({ setupToken: "wrong-token-xxxxxxxx", name: "Head", email: "head@school.org", password: "long enough pw" }, meta())).rejects.toMatchObject({ status: 403 });
    const first = await bootstrapAdmin({ setupToken: process.env.SETUP_TOKEN!, name: "Head Coach", email: "Head@School.org", password: "long enough pw" }, meta());
    expect(first.user.role).toBe("admin");
    expect(first.user.email).toBe("head@school.org");
    expect((await validateSessionToken(first.token))?.user.id).toBe(first.user.id);
    await expect(bootstrapAdmin({ setupToken: process.env.SETUP_TOKEN!, name: "Evil", email: "evil@x.org", password: "long enough pw" }, meta())).rejects.toMatchObject({ status: 409 });
    expect((await setupStatus()).needsSetup).toBe(false);
  });

  it("is disabled when no setup token is configured", async () => {
    const saved = process.env.SETUP_TOKEN;
    delete process.env.SETUP_TOKEN;
    try {
      await expect(bootstrapAdmin({ setupToken: "", name: "x", email: "x@y.org", password: "long enough pw" }, meta())).rejects.toMatchObject({ status: 503 });
    } finally {
      process.env.SETUP_TOKEN = saved;
    }
  });
});

describe("login", () => {
  it("returns the same error for unknown emails and wrong passwords, and blocks disabled users", async () => {
    const admin = await makeUser("admin", "boss@school.org");
    const coach = await makeUser("coach", "coach@gmail.com");
    const unknown = await login({ email: "nobody@x.org", password: "whatever123" }, meta()).catch((e) => e);
    const wrong = await login({ email: "coach@gmail.com", password: "whatever123" }, meta()).catch((e) => e);
    expect(unknown).toBeInstanceOf(AppError);
    expect(unknown.message).toBe(wrong.message);
    const ok = await login({ email: "COACH@gmail.com ", password: "correct horse battery" }, meta());
    expect(ok.user.id).toBe(coach.id);
    await setUserDisabled(admin, coach.id, true);
    expect(await validateSessionToken(ok.token)).toBeNull(); // sessions revoked
    await expect(login({ email: "coach@gmail.com", password: "correct horse battery" }, meta())).rejects.toMatchObject({ status: 401 });
  });

  it("rate-limits repeated failures for an account", async () => {
    await makeUser("coach", "target@school.org");
    let last: unknown;
    for (let i = 0; i < 11; i++) {
      last = await login({ email: "target@school.org", password: `guess-${i}-xxxx` }, meta(`198.51.100.${i}`)).catch((e) => e);
    }
    expect((last as AppError).status).toBe(429);
  });
});

describe("invites and resets", () => {
  it("lets an admin invite a coach with any email domain; the link is single-use", async () => {
    const admin = await makeUser("admin");
    const invite = await createInvite(admin, { email: "assistant@hotmail.com", role: "coach" }, "https://team.example");
    expect(invite.url.startsWith("https://team.example/invite/")).toBe(true);
    const token = tokenFromUrl(invite.url);
    expect((await getInvite(token))?.email).toBe("assistant@hotmail.com");
    const accepted = await acceptInvite(token, { name: "Assistant Coach", password: "my own password" }, meta());
    expect(accepted.user.role).toBe("coach");
    await expect(acceptInvite(token, { name: "Again", password: "my own password" }, meta())).rejects.toMatchObject({ status: 410 });
    expect(await getInvite(token)).toBeNull();
  });

  it("only admins can invite or manage coaches", async () => {
    const coach = await makeUser("coach");
    await expect(createInvite(coach, { email: "x@y.org", role: "admin" }, "https://t")).rejects.toMatchObject({ status: 403 });
    await expect(setUserRole(coach, coach.id, "admin")).rejects.toMatchObject({ status: 403 });
  });

  it("admin reset links set a new password and sign out old sessions", async () => {
    const admin = await makeUser("admin");
    const coach = await makeUser("coach", "forgetful@school.org");
    const before = await login({ email: "forgetful@school.org", password: "correct horse battery" }, meta());
    const link = await createResetLinkForUser(admin, coach.id, "https://team.example");
    const after = await completeReset(tokenFromUrl(link.url), "brand new password", meta());
    expect(after.user.id).toBe(coach.id);
    expect(await validateSessionToken(before.token)).toBeNull();
    await expect(completeReset(tokenFromUrl(link.url), "another password!", meta())).rejects.toMatchObject({ status: 410 });
    expect((await login({ email: "forgetful@school.org", password: "brand new password" }, meta())).user.id).toBe(coach.id);
  });

  it("keeps at least one administrator", async () => {
    const admin = await makeUser("admin");
    await expect(setUserRole(admin, admin.id, "coach")).rejects.toMatchObject({ status: 409 });
    await expect(setUserDisabled(admin, admin.id, true)).rejects.toMatchObject({ status: 409 });
  });

  it("changing a password requires the current one and revokes other sessions", async () => {
    const coach = await makeUser("coach", "c@school.org");
    const s1 = await login({ email: "c@school.org", password: "correct horse battery" }, meta());
    const s2 = await login({ email: "c@school.org", password: "correct horse battery" }, meta());
    const v1 = (await validateSessionToken(s1.token))!;
    await expect(changePassword(coach, v1.sessionId, "nope", "new password 123")).rejects.toMatchObject({ status: 400 });
    await changePassword(coach, v1.sessionId, "correct horse battery", "new password 123");
    expect(await validateSessionToken(s1.token)).not.toBeNull();
    expect(await validateSessionToken(s2.token)).toBeNull();
  });

  it("break-glass recovery only works while RECOVERY_TOKEN is set", async () => {
    await makeUser("admin", "head@school.org");
    await expect(recoverAccount({ recoveryToken: "x", email: "head@school.org" }, meta())).rejects.toMatchObject({ status: 503 });
    process.env.RECOVERY_TOKEN = "recovery-token-0123456789-abcdef";
    try {
      await expect(recoverAccount({ recoveryToken: "wrong", email: "head@school.org" }, meta("192.0.2.1"))).rejects.toMatchObject({ status: 403 });
      const link = await recoverAccount({ recoveryToken: "recovery-token-0123456789-abcdef", email: "head@school.org" }, meta("192.0.2.2"));
      expect(link.url).toContain("/reset/");
    } finally {
      delete process.env.RECOVERY_TOKEN;
    }
  });
});
