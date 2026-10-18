import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { invitationLink, parseInvitation, type RelayAddress } from "../src/call/invitation.js";
import { roomKeys } from "../src/call/crypto.js";

interface Fixture {
  input: string;
  code?: string;
  relay?: RelayAddress;
  invalid?: boolean;
}
const fixtures = JSON.parse(
  readFileSync(new URL("../../Tests/Invitations.json", import.meta.url), "utf8"),
) as Fixture[];
test("native and browser parse the same valid and invalid invitations", () => {
  for (const fixture of fixtures) {
    if (fixture.invalid) {
      assert.throws(() => parseInvitation(fixture.input));
      continue;
    }
    const invite = parseInvitation(fixture.input);
    assert.equal(invite.code, fixture.code);
    assert.deepEqual(invite.relay, fixture.relay);
    const link = invitationLink(invite);
    const restored = parseInvitation(link);
    assert.equal(restored.code, fixture.code);
    assert.equal(restored.autoJoin, true);
    if (fixture.relay) assert.deepEqual(restored.relay, fixture.relay);
    assert.ok(!new URL(link).search, "secret and metadata are only in the fragment");
  }
});
test("the shared invite keeps the existing room key and removes one-time join intent", async () => {
  const code = "0123456789abcdef0123456789abcdef";
  const legacy = `sharestream://13.140.153.191:48100/${code}`;
  const link = invitationLink(parseInvitation(legacy));
  assert.equal((await roomKeys(link)).room, (await roomKeys(code)).room);
  const consumed = invitationLink(
    parseInvitation(link),
    "https://stream.whitesquirrel.digital",
    false,
  );
  assert.equal(parseInvitation(consumed).autoJoin, false);
  assert.equal(parseInvitation(consumed).code, code);
});
