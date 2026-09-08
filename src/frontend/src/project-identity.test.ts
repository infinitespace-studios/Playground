import assert from "node:assert/strict";
import test from "node:test";
import { folderProjectIdentity } from "./issue051.ts";

test("folder project identities are stable, distinct, valid, and path-redacted", async () => {
  const first = await folderProjectIdentity("/Users/example/Projects/My Game");
  const repeated = await folderProjectIdentity("/Users/example/Projects/My Game");
  const second = await folderProjectIdentity("/Users/example/Projects/Other Game");

  assert.equal(first, repeated);
  assert.notEqual(first, second);
  assert.match(first, /^folder-sha256-[a-f0-9]{64}$/);
  assert.doesNotMatch(first, /Users|Projects|My Game/);
  assert.ok(first.length <= 256);
});

test("Windows path separator and casing differences produce one identity", async () => {
  const backslash = await folderProjectIdentity("C:\\Users\\Example\\MyGame");
  const slash = await folderProjectIdentity("c:/users/example/mygame");
  const extended = await folderProjectIdentity("\\\\?\\C:\\USERS\\EXAMPLE\\MYGAME");

  assert.equal(backslash, slash);
  assert.equal(backslash, extended);
});

test("an empty project root is rejected", async () => {
  await assert.rejects(folderProjectIdentity(""), /empty root path/);
});
