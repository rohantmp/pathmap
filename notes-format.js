// Small, safe prose format shared by visual editing, notes preview and exports.
const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function closing(text, token, start) {
  let position = text.indexOf(token, start);
  while (position >= 0) {
    let slashes = 0;
    for (let i = position - 1; i >= 0 && text[i] === "\\"; i--) slashes++;
    if (slashes % 2 === 0) return position;
    position = text.indexOf(token, position + token.length);
  }
  return -1;
}
function inline(text, depth = 0) {
  if (depth > 20) return escapeHTML(text);
  let out = "";
  for (let i = 0; i < text.length; ) {
    if (
      text[i] === "\\" &&
      i + 1 < text.length &&
      /[\\`*_{}\[\]()#+\-.!<>]/.test(text[i + 1])
    ) {
      out += escapeHTML(text[i + 1]);
      i += 2;
      continue;
    }
    const marker = ["***", "**", "__", "*"].find((token) =>
      text.startsWith(token, i),
    );
    if (marker) {
      const end = closing(text, marker, i + marker.length);
      if (end > i + marker.length) {
        const tags =
          marker === "***"
            ? ["strong", "em"]
            : marker === "**"
              ? ["strong"]
              : marker === "__"
                ? ["u"]
                : ["em"];
        out +=
          tags.map((t) => `<${t}>`).join("") +
          inline(text.slice(i + marker.length, end), depth + 1) +
          tags
            .toReversed()
            .map((t) => `</${t}>`)
            .join("");
        i = end + marker.length;
        continue;
      }
    }
    out += escapeHTML(text[i++]);
  }
  return out;
}
export function markdownLite(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  let html = "",
    paragraph = [],
    list = null;
  const flush = () => {
    if (paragraph.length) {
      html += `<p>${paragraph.map((line) => inline(line)).join("<br>")}</p>`;
      paragraph = [];
    }
  };
  const close = () => {
    if (list) {
      html += `</${list}>`;
      list = null;
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      close();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flush();
      close();
      const level = heading[1].length + 1;
      html += `<h${level}>${inline(heading[2])}</h${level}>`;
      continue;
    }
    const bullet = line.match(/^(?:([-*•])\s+|(\d+)[.)]\s+)(.*)$/);
    if (bullet) {
      flush();
      const type = bullet[2] ? "ol" : "ul";
      if (list !== type) {
        close();
        html += `<${type}>`;
        list = type;
      }
      html += `<li>${inline(bullet[3])}</li>`;
      continue;
    }
    close();
    paragraph.push(line);
  }
  flush();
  close();
  return html;
}
const escapeMarkdown = (text) =>
  text.replace(/\u200b/g, "").replace(/[\\*_#]/g, "\\$&");
function inlineMarkdown(node) {
  if (node.nodeType === 3) return escapeMarkdown(node.nodeValue || "");
  if (node.nodeType !== 1) return "";
  const tag = node.tagName.toLowerCase();
  if (["script", "style", "iframe", "object"].includes(tag)) return "";
  if (tag === "br") return "\n";
  let text = [...node.childNodes].map(inlineMarkdown).join("");
  if (!text) return "";
  const style = node.style;
  if (
    tag === "b" ||
    tag === "strong" ||
    style.fontWeight === "bold" ||
    +style.fontWeight >= 600
  )
    text = `**${text}**`;
  if (tag === "i" || tag === "em" || style.fontStyle === "italic")
    text = `*${text}*`;
  if (tag === "u" || style.textDecoration.includes("underline"))
    text = `__${text}__`;
  return text;
}
const blockTags = new Set(["p", "div", "h1", "h2", "h3", "h4", "ul", "ol"]);
function blockMarkdown(node) {
  if (node.nodeType !== 1) return inlineMarkdown(node);
  const tag = node.tagName.toLowerCase();
  if (tag === "ul" || tag === "ol")
    return [...node.children]
      .filter((c) => c.tagName === "LI")
      .map(
        (li, i) =>
          `${tag === "ol" ? `${i + 1}.` : "-"} ${[...li.childNodes].map(inlineMarkdown).join("").trim()}`,
      )
      .join("\n");
  if (
    [...node.children].some((child) =>
      blockTags.has(child.tagName.toLowerCase()),
    )
  )
    return [...node.childNodes].map(blockMarkdown).filter(Boolean).join("\n\n");
  const text = inlineMarkdown(node).trim();
  if (/^h[1-4]$/.test(tag))
    return "#".repeat(Math.max(1, +tag[1] - 1)) + " " + text;
  return text
    .replace(/^(\s*)([-+>] )/gm, "$1\\$2")
    .replace(/^(\s*\d+)([.)] )/gm, "$1\\$2");
}
export function richToMarkdown(root) {
  // Some browsers leave plain text nodes around block elements while editing.
  let result = "",
    pending = "";
  const flush = () => {
    if (pending.trim()) {
      result += (result ? "\n\n" : "") + pending.trim();
      pending = "";
    }
  };
  for (const node of root.childNodes) {
    if (node.nodeType === 1 && blockTags.has(node.tagName.toLowerCase())) {
      flush();
      const block = blockMarkdown(node);
      if (block) result += (result ? "\n\n" : "") + block;
    } else pending += inlineMarkdown(node);
  }
  flush();
  return result.replace(/\n{3,}/g, "\n\n").trim();
}
