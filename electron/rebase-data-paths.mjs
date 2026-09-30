import { isAbsolute, join } from "node:path";

const PATH_KEYS = new Set([
  "cwd", "pinnedCwd", "workspace", "configDir", "profileDirectory", "agentDir",
  "dataDir", "home", "cli", "path", "filePath", "localPath",
]);
const ATTACHMENT_FIELDS = ["attachments", "images", "fileAttachments", "file", "card"];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validRelative(value) {
  return Boolean(value) && value.length <= 4096 && !isAbsolute(value) && !/[\\\0:]/.test(value) &&
    value.split("/").every((part) => part && part !== "." && part !== ".." && !/[. ]$/.test(part) &&
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}

function rebasePath(value, source, destination) {
  const normalized = value.replaceAll("\\", "/");
  const original = source.replaceAll("\\", "/").replace(/\/$/, "");
  if (normalized !== original && !normalized.startsWith(`${original}/`)) return value;
  const suffix = normalized.slice(original.length).replace(/^\//, "");
  if (suffix && !validRelative(suffix)) return value;
  return suffix ? join(destination, suffix) : destination;
}

/** Rebase known persisted path fields under a moved Crewbot data root.
 *
 * @param value - A parsed persisted object or array.
 * @param source - The previous absolute data root.
 * @param destination - The new absolute data root.
 * @returns Nothing; matching path fields are updated in place.
 */
export function rebasePersistedFields(value, source, destination) {
  if (Array.isArray(value)) {
    for (const item of value) rebasePersistedFields(item, source, destination);
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (PATH_KEYS.has(key) && typeof item === "string") value[key] = rebasePath(item, source, destination);
      else if (typeof item === "object") rebasePersistedFields(item, source, destination);
    }
  }
}

function escapeAttribute(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll("\t", "&#9;").replaceAll("\r", "&#13;").replaceAll("\n", "&#10;");
}

function decodeAttribute(value) {
  return value.replace(/&(quot|lt|gt|amp);|&#(9|10|13);/g, (entity, named, numeric) => {
    if (numeric === "9") return "\t";
    if (numeric === "10") return "\n";
    if (numeric === "13") return "\r";
    if (named === "quot") return '"';
    if (named === "lt") return "<";
    if (named === "gt") return ">";
    if (named === "amp") return "&";
    return entity;
  });
}

const TRANSCRIPT_ATTACHMENT_TAG = /^<attached-(image|file)[\t ]+path="([^"\r\n]*)"(?:[\t ]+name="([^"\r\n]*)")?[\t ]*\/>[\t ]*$/;
const COMMONMARK_BLOCK_TAGS = [
  "address", "article", "aside", "base", "basefont", "blockquote", "body", "caption", "center", "col",
  "colgroup", "dd", "details", "dialog", "dir", "div", "dl", "dt", "fieldset", "figcaption", "figure",
  "footer", "form", "frame", "frameset", "h[1-6]", "head", "header", "hr", "html", "iframe", "legend",
  "li", "link", "main", "menu", "menuitem", "nav", "noframes", "ol", "optgroup", "option", "p",
  "param", "search", "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "title",
  "tr", "track", "ul",
].join("|");
const COMMONMARK_TYPE_1 = /^ {0,3}<(script|pre|style|textarea)(?:[\t ]|>|$)/i;
const COMMONMARK_TYPE_6 = new RegExp(`^ {0,3}</?(?:${COMMONMARK_BLOCK_TAGS})(?:[\\t ]|/?>|$)`, "i");
const HTML_ATTRIBUTE_NAME = "[A-Za-z_:][A-Za-z0-9_.:-]*";
const HTML_ATTRIBUTE_VALUE = `(?:[^\\s"'=<>\\x60]+|'[^']*'|"[^"]*")`;
const HTML_ATTRIBUTE = `(?:[\\t ]+${HTML_ATTRIBUTE_NAME}(?:[\\t ]*=[\\t ]*${HTML_ATTRIBUTE_VALUE})?)`;
const COMMONMARK_TYPE_7 = new RegExp(
  `^ {0,3}(?:<[A-Za-z][A-Za-z0-9-]*${HTML_ATTRIBUTE}*[\\t ]*/?>|</[A-Za-z][A-Za-z0-9-]*[\\t ]*>)[\\t ]*$`,
);

function transcriptFenceMarker(line) {
  let index = 0;
  while (index < line.length && index < 4 && line[index] === " ") index += 1;
  if (index > 3) return null;
  const marker = line[index];
  if (marker !== "`" && marker !== "~") return null;
  const start = index;
  while (index < line.length && line[index] === marker) index += 1;
  const length = index - start;
  return length >= 3 ? { marker, length, remainder: line.slice(index) } : null;
}

function transcriptBlockStarting(line) {
  const lower = line.toLowerCase();
  const commentStart = lower.indexOf("<!--");
  if (commentStart >= 0 && lower.indexOf("-->", commentStart + 4) < 0) {
    return { kind: "untilToken", closingToken: "-->" };
  }
  const content = line.match(/^ {0,3}(.*)$/)?.[1];
  if (content === undefined) return null;
  const lowerContent = content.toLowerCase();
  if (/^<pasted-text(?:[\t >]|$)/i.test(content)) {
    return lowerContent.includes("</pasted-text>") ? null : { kind: "untilToken", closingToken: "</pasted-text>" };
  }
  const typeOne = COMMONMARK_TYPE_1.exec(line);
  if (typeOne) {
    const closingToken = `</${typeOne[1].toLowerCase()}>`;
    return lower.includes(closingToken) ? null : { kind: "untilToken", closingToken };
  }
  if (lowerContent.startsWith("<?")) {
    return lowerContent.indexOf("?>", 2) >= 0 ? null : { kind: "untilToken", closingToken: "?>" };
  }
  if (lowerContent.startsWith("<![cdata[")) {
    return lowerContent.indexOf("]]>", 9) >= 0 ? null : { kind: "untilToken", closingToken: "]]>" };
  }
  if (/^<![A-Za-z]/.test(content)) {
    return content.indexOf(">", 2) >= 0 ? null : { kind: "untilToken", closingToken: ">" };
  }
  if (COMMONMARK_TYPE_6.test(line) || COMMONMARK_TYPE_7.test(line)) return { kind: "untilBlank" };
  return null;
}

/** Rebase saved attachment records and their standalone transcript tags.
 * Quoted prose, code examples, and external paths remain byte-for-byte intact.
 *
 * @param message - A parsed transcript message.
 * @param source - The previous absolute data root.
 * @param destination - The new absolute data root.
 * @returns Nothing; matching attachment paths are updated in place.
 */
export function rebasePersistedMessage(message, source, destination) {
  if (!isRecord(message)) return;
  for (const field of ATTACHMENT_FIELDS) rebasePersistedFields(message[field], source, destination);
  if (typeof message.text !== "string") return;

  const text = message.text;
  const edits = [];
  let fence = null;
  let block = null;
  let offset = 0;
  while (offset < text.length) {
    const newline = text.indexOf("\n", offset);
    const end = newline < 0 ? text.length : newline;
    const rawLine = text.slice(offset, end);
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const marker = transcriptFenceMarker(line);
    if (fence) {
      if (marker && marker.marker === fence.marker && marker.length >= fence.length && /^[\t ]*$/.test(marker.remainder)) fence = null;
    } else if (block) {
      if (block.kind === "untilBlank") {
        if (/^[\t ]*$/.test(line)) block = null;
      } else if (line.toLowerCase().includes(block.closingToken)) {
        block = null;
      }
    } else if (marker) {
      fence = { marker: marker.marker, length: marker.length };
    } else {
      const match = TRANSCRIPT_ATTACHMENT_TAG.exec(line);
      if (match) {
        const path = decodeAttribute(match[2]);
        const rebased = rebasePath(path, source, destination);
        if (rebased !== path) {
          const next = line.replace(`path="${match[2]}"`, `path="${escapeAttribute(rebased)}"`);
          edits.push({ from: offset, to: end, text: `${next}${rawLine.endsWith("\r") ? "\r" : ""}` });
        }
      } else {
        block = transcriptBlockStarting(line);
      }
    }
    if (newline < 0) break;
    offset = newline + 1;
  }
  let next = text;
  for (const edit of edits.reverse()) next = next.slice(0, edit.from) + edit.text + next.slice(edit.to);
  message.text = next;
}
