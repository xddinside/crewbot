// The checks that decide whether the installed run passed, expressed as pure
// functions so they can be exercised on this host against real temporary
// directories. The runner executes the same functions; nothing here shells out
// or reads a package.
//
// Each function returns the values it compared so a report can print the state
// difference rather than a bare "ok".
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** A recorded value that must never survive a migration. */
export function findResidualRoot(value, sourceRoot, label = "value") {
  const found = [];
  const source = resolve(sourceRoot);
  const visit = (node, path) => {
    if (typeof node === "string") {
      if (node.includes(source) || node.includes(`${source}${sep}`)) found.push({ path, value: node });
      return;
    }
    if (Array.isArray(node)) { node.forEach((item, index) => visit(item, `${path}[${index}]`)); return; }
    if (node && typeof node === "object") {
      for (const [key, item] of Object.entries(node)) visit(item, path ? `${path}.${key}` : key);
    }
  };
  visit(value, "");
  return found.length ? { label, root: source, residuals: found } : null;
}

/** True when `child` is inside `parent`. Used to tell an embedded workspace
 * path (which must move) from a user's external project path (which must not). */
export function isInside(parent, child) {
  if (typeof parent !== "string" || typeof child !== "string" || !isAbsolute(parent) || !isAbsolute(child)) return false;
  const from = resolve(parent);
  const to = resolve(child);
  if (from === to) return true;
  const span = relative(from, to);
  return span !== "" && !span.startsWith("..") && !isAbsolute(span);
}

export function assertInside(label, parent, child) {
  if (!isInside(parent, child)) throw new Error(`${label} ${child} is not inside ${parent}`);
  return child;
}

export function assertOutside(label, parent, child) {
  if (isInside(parent, child)) throw new Error(`${label} ${child} must stay outside ${parent}`);
  return child;
}

/** Attachment bytes must be identical, not merely readable. */
export function compareBytes(before, after) {
  if (typeof before !== "string" && typeof after !== "string" && before.byteLength !== after.byteLength) {
    throw new Error(`attachment size changed: ${before.byteLength} -> ${after.byteLength}`);
  }
  const left = digestOf(before);
  const right = digestOf(after);
  if (left !== right) throw new Error(`attachment bytes changed: ${left} != ${right}`);
  return {
    sha256: left,
    bytes: typeof after === "string" ? null : after.byteLength,
  };
}

function digestOf(value) {
  if (typeof value === "string") return value;
  return createHash("sha256").update(value).digest("hex");
}

/** A recovery snapshot must hold the bytes that were there before the move. */
export function compareSnapshots({ before, snapshotDir, expect }) {
  const missing = [];
  const changed = [];
  for (const file of expect) {
    const path = resolve(snapshotDir, file);
    const original = before.get(file);
    if (!original || !existsSync(path)) { missing.push(file); continue; }
    if (createHash("sha256").update(readFileSync(path)).digest("hex") !== original) changed.push(file);
  }
  if (missing.length) throw new Error(`migration recovery snapshot is missing ${missing.join(", ")}`);
  if (changed.length) throw new Error(`migration recovery snapshot does not match the original bytes: ${changed.join(", ")}`);
  return { verified: expect };
}

/**
 * Stable and development identities must not be able to see or write each
 * other's state. `observed` is every path a stable launch created.
 */
export function auditStableDevelopmentSeparation({ home, config, data, cache, development, observed }) {
  const violations = [];
  const forbidden = {
    developmentDataDir: development.dataDir,
    developmentProfileDir: development.profileDir,
    developmentCacheDir: development.cacheDir,
  };
  for (const [label, path] of Object.entries(forbidden)) {
    if (observed.includes(path)) violations.push({ kind: label, path });
  }
  // The owned root is the only place either identity may write.
  for (const entry of observed) {
    if (!isInside(home, entry) && !isInside(config, entry) && !isInside(data, entry) && !isInside(cache, entry)) {
      violations.push({ kind: "outside-the-owned-fixture", path: entry });
    }
  }
  if (violations.length) {
    throw new Error(`stable and development state are not separated: ${JSON.stringify(violations)}`);
  }
  return {
    developmentPaths: forbidden,
    developmentPorts: { server: development.serverPort, webhook: development.webhookPort },
    createdByStableLaunch: observed.length,
  };
}

/**
 * A refused migration must leave both originals readable and say what to do.
 * `warning` is the line the app printed; `nextAction` is the part a person acts on.
 */
export function assertRefusalPreservedOriginals({ legacyDirs, expectedWarningFragments }) {
  const missing = legacyDirs.filter((dir) => !existsSync(dir));
  if (missing.length) throw new Error(`a refused migration destroyed recoverable data: ${missing.join(", ")}`);
  const warnings = expectedWarningFragments.filter((fragment) => !fragment.warning.includes(fragment.text));
  if (warnings.length) {
    throw new Error(`the refusal did not give a usable next action: ${JSON.stringify(warnings)}`);
  }
  return { preserved: legacyDirs };
}

/** An encrypted credential store must not be readable as plaintext, and the
 * operating-system keyring must hold the item that only it can decrypt. */
export function auditCredentialSurvival({
  credentialsFile,
  syntheticSecret,
  secretServiceItems,
  identityName,
  childEnvValue,
  plaintextStillInConfig,
}) {
  const problems = [];
  if (!existsSync(credentialsFile)) problems.push("no credential file was written");
  const blob = existsSync(credentialsFile) ? readFileSync(credentialsFile) : Buffer.alloc(0);
  for (const encoding of ["utf8", "latin1", "hex", "base64"]) {
    if (blob.toString(encoding).includes(syntheticSecret)) problems.push(`the credential file contains the secret as ${encoding}`);
  }
  if (plaintextStillInConfig) problems.push("the plaintext secret is still in config.json");
  const items = secretServiceItems.filter((item) => item.attributes?.application === identityName);
  if (!items.length) {
    problems.push(`the operating-system keyring holds no item for ${identityName}; the backend fell back to basic_text`);
  }
  if (childEnvValue !== syntheticSecret) {
    problems.push(`the app did not use the decrypted credential (server saw ${childEnvValue === undefined ? "nothing" : "a different value"})`);
  }
  if (problems.length) throw new Error(`credential continuity failed: ${problems.join("; ")}`);
  return { keyringItems: items.length, identityName, usedByServerChild: true };
}

/** A regular file, not a symlink or directory, at the exact expected path. */
export function assertRegularFile(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`expected a real file at ${path}`);
  return { path, bytes: stat.size, mode: stat.mode & 0o777 };
}