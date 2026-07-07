"use client";

import MarkdownIt from "markdown-it";
import type { JSONContent } from "@tiptap/core";

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: true,
});

type Token = ReturnType<typeof markdown.parse>[number];

const DEFAULT_DOC: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Press '/' for commands" }],
    },
  ],
};

function textNode(text: string, marks?: JSONContent["marks"]): JSONContent {
  const node: JSONContent = { type: "text", text };
  if (marks?.length) node.marks = marks as JSONContent["marks"];
  return node;
}

function cloneMarks(marks: JSONContent["marks"] = []) {
  return marks.map((mark) => ({ ...mark }));
}

function convertInlineChildren(
  children: NonNullable<Token["children"]>,
  options?: { stripTaskPrefix?: boolean }
): JSONContent[] {
  const result: JSONContent[] = [];
  const activeMarks: JSONContent["marks"] = [];
  let strippedTaskPrefix = !options?.stripTaskPrefix;
  let taskPrefixBuffer = "";

  const pushText = (value: string) => {
    if (!value) return;
    result.push(textNode(value, cloneMarks(activeMarks)));
  };

  for (let i = 0; i < children.length; i += 1) {
    const token = children[i];

    if (options?.stripTaskPrefix && !strippedTaskPrefix && token.type === "text") {
      taskPrefixBuffer += token.content;
      const match = taskPrefixBuffer.match(/^\[( |x|X)\]\s+([\s\S]*)$/);
      if (match) {
        strippedTaskPrefix = true;
        taskPrefixBuffer = "";
        pushText(match[2]);
        continue;
      }
      if (taskPrefixBuffer.length > 12) {
        strippedTaskPrefix = true;
        pushText(taskPrefixBuffer);
        taskPrefixBuffer = "";
        continue;
      }
      continue;
    }

    if (token.type === "text") {
      pushText(token.content);
      continue;
    }

    if (token.type === "softbreak" || token.type === "hardbreak") {
      result.push({ type: "hardBreak" });
      continue;
    }

    if (token.type === "code_inline") {
      result.push(textNode(token.content, [...cloneMarks(activeMarks), { type: "code" }]));
      continue;
    }

    if (token.type === "image") {
      result.push({
        type: "image",
        attrs: {
          src: token.attrGet("src") || "",
          alt: token.attrGet("alt") || token.content || "",
          title: token.attrGet("title") || undefined,
        },
      });
      continue;
    }

    if (token.type === "link_open") {
      activeMarks.push({
        type: "link",
        attrs: {
          href: token.attrGet("href") || "",
          target: token.attrGet("target") || "_blank",
          rel: token.attrGet("rel") || "noreferrer noopener nofollow",
          title: token.attrGet("title") || undefined,
        },
      });
      continue;
    }

    if (token.type === "link_close") {
      activeMarks.pop();
      continue;
    }

    if (token.type === "strong_open") {
      activeMarks.push({ type: "bold" });
      continue;
    }
    if (token.type === "strong_close") {
      activeMarks.pop();
      continue;
    }

    if (token.type === "em_open") {
      activeMarks.push({ type: "italic" });
      continue;
    }
    if (token.type === "em_close") {
      activeMarks.pop();
      continue;
    }

    if (token.type === "s_open") {
      activeMarks.push({ type: "strike" });
      continue;
    }
    if (token.type === "s_close") {
      activeMarks.pop();
      continue;
    }

    if (token.type === "mark_open") {
      activeMarks.push({ type: "highlight" });
      continue;
    }
    if (token.type === "mark_close") {
      activeMarks.pop();
      continue;
    }

    if (token.type === "text_special") {
      pushText(token.content);
      continue;
    }
  }

  if (taskPrefixBuffer && !strippedTaskPrefix) {
    pushText(taskPrefixBuffer);
  }

  return result;
}

function findMatchingClose(tokens: Token[], startIndex: number, openType: string, closeType: string) {
  let depth = 0;
  for (let i = startIndex; i < tokens.length; i += 1) {
    if (tokens[i].type === openType) depth += 1;
    if (tokens[i].type === closeType) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return tokens.length - 1;
}

function parseBlocks(tokens: Token[], startIndex = 0, endIndex = tokens.length): JSONContent[] {
  const result: JSONContent[] = [];

  for (let i = startIndex; i < endIndex; i += 1) {
    const token = tokens[i];

    if (!token || token.hidden) continue;

    if (token.type === "heading_open") {
      const level = Number(token.tag.replace("h", "")) || 1;
      const inlineToken = tokens[i + 1];
      const content = inlineToken?.type === "inline" && inlineToken.children
        ? convertInlineChildren(inlineToken.children)
        : [];
      result.push({
        type: "heading",
        attrs: { level },
        content: content.length ? content : undefined,
      });
      i = findMatchingClose(tokens, i, "heading_open", "heading_close");
      continue;
    }

    if (token.type === "paragraph_open") {
      const inlineToken = tokens[i + 1];
      const content = inlineToken?.type === "inline" && inlineToken.children
        ? convertInlineChildren(inlineToken.children)
        : [];
      if (content.length) {
        result.push({ type: "paragraph", content });
      } else {
        result.push({ type: "paragraph" });
      }
      i = findMatchingClose(tokens, i, "paragraph_open", "paragraph_close");
      continue;
    }

    if (token.type === "blockquote_open") {
      const close = findMatchingClose(tokens, i, "blockquote_open", "blockquote_close");
      result.push({
        type: "blockquote",
        content: parseBlocks(tokens, i + 1, close),
      });
      i = close;
      continue;
    }

    if (token.type === "bullet_list_open" || token.type === "ordered_list_open") {
      const close = findMatchingClose(tokens, i, token.type, token.type.replace("_open", "_close"));
      const listItems = parseListItems(tokens, i + 1, close);
      result.push({
        type: token.type === "bullet_list_open" ? "bulletList" : "orderedList",
        attrs: token.type === "ordered_list_open"
          ? { start: Number(token.attrGet("start") || token.attrGet("order") || 1) }
          : undefined,
        content: listItems,
      });
      i = close;
      continue;
    }

    if (token.type === "fence" || token.type === "code_block") {
      result.push({
        type: "codeBlock",
        attrs: {
          language: token.info?.trim() || undefined,
        },
        content: token.content ? [{ type: "text", text: token.content.replace(/\n$/, "") }] : undefined,
      });
      continue;
    }

    if (token.type === "hr") {
      result.push({ type: "horizontalRule" });
      continue;
    }

    if (token.type === "table_open") {
      const close = findMatchingClose(tokens, i, "table_open", "table_close");
      result.push(parseTable(tokens.slice(i, close + 1)));
      i = close;
      continue;
    }

    if (token.type === "inline" && token.children) {
      const content = convertInlineChildren(token.children);
      if (content.length) {
        result.push({ type: "paragraph", content });
      }
      continue;
    }

    if (token.type === "image") {
      result.push({
        type: "image",
        attrs: {
          src: token.attrGet("src") || "",
          alt: token.attrGet("alt") || token.content || undefined,
          title: token.attrGet("title") || undefined,
        },
      });
      continue;
    }
  }

  return result;
}

function parseListItems(tokens: Token[], startIndex: number, endIndex: number): JSONContent[] {
  const items: JSONContent[] = [];

  for (let i = startIndex; i < endIndex; i += 1) {
    const token = tokens[i];
    if (token.type !== "list_item_open") continue;

    const close = findMatchingClose(tokens, i, "list_item_open", "list_item_close");
    const innerTokens = tokens.slice(i + 1, close);
    const isTask = innerTokens.some((inner) => {
      const inline = inner.type === "inline" ? inner : null;
      const firstText = inline?.children?.[0];
      return Boolean(firstText && firstText.type === "text" && /^\[( |x|X)\]\s+/.test(firstText.content));
    });

    const content = parseBlocks(innerTokens);

    if (isTask) {
      const inline = innerTokens.find((inner) => inner.type === "inline");
      const firstText = inline?.children?.[0];
      const checked = Boolean(firstText && firstText.type === "text" && /^\[(x|X)\]/.test(firstText.content));
      items.push({
        type: "taskItem",
        attrs: { checked },
        content: content.length ? content : [{ type: "paragraph" }],
      });
    } else {
      items.push({
        type: "listItem",
        content: content.length ? content : [{ type: "paragraph" }],
      });
    }

    i = close;
  }

  return items;
}

function parseTable(tokens: Token[]): JSONContent {
  const rows: JSONContent[] = [];
  let currentRow: JSONContent | null = null;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];

    if (token.type === "tr_open") {
      currentRow = { type: "tableRow", content: [] };
      continue;
    }

    if (token.type === "tr_close") {
      if (currentRow) rows.push(currentRow);
      currentRow = null;
      continue;
    }

    if (!currentRow) continue;

    if (token.type === "th_open" || token.type === "td_open") {
      const closeType = token.type === "th_open" ? "th_close" : "td_close";
      const close = findMatchingClose(tokens, i, token.type, closeType);
      const inlineToken = tokens.slice(i + 1, close).find((inner) => inner.type === "inline");
      const content = inlineToken?.children ? convertInlineChildren(inlineToken.children) : [];

      currentRow.content?.push({
        type: token.type === "th_open" ? "tableHeader" : "tableCell",
        content: content.length ? [{ type: "paragraph", content }] : [{ type: "paragraph" }],
      });
      i = close;
    }
  }

  return {
    type: "table",
    content: rows.length ? rows : [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph" }] }] }],
  };
}

function escapeMarkdown(text: string) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/#/g, "\\#")
    .replace(/\|/g, "\\|");
}

function normalizeText(text: string) {
  return text.replace(/\u00a0/g, " ");
}

function serializeMarks(text: string, marks: NonNullable<JSONContent["marks"]> = []) {
  let value = normalizeText(text);
  const ordered = [...marks].sort((a, b) => {
    const rank = (mark: string) => {
      if (mark === "link") return 0;
      if (mark === "bold") return 1;
      if (mark === "italic") return 2;
      if (mark === "strike") return 3;
      if (mark === "underline") return 4;
      if (mark === "highlight") return 5;
      if (mark === "code") return 6;
      return 10;
    };

    return rank(a.type) - rank(b.type);
  });

  const codeMark = ordered.find((mark) => mark.type === "code");
  if (codeMark) {
    return `\`${value.replace(/`/g, "\\`")}\``;
  }

  const linkMark = ordered.find((mark) => mark.type === "link");
  if (linkMark) {
    const attrs = linkMark.attrs as { href?: string };
    value = `[${value}](${attrs.href || ""})`;
  }

  if (ordered.some((mark) => mark.type === "bold")) {
    value = `**${value}**`;
  }

  if (ordered.some((mark) => mark.type === "italic")) {
    value = `*${value}*`;
  }

  if (ordered.some((mark) => mark.type === "strike")) {
    value = `~~${value}~~`;
  }

  if (ordered.some((mark) => mark.type === "underline")) {
    value = `<u>${value}</u>`;
  }

  if (ordered.some((mark) => mark.type === "highlight")) {
    value = `==${value}==`;
  }

  return value;
}

function serializeInline(node?: JSONContent): string {
  if (!node) return "";

  if (node.type === "text") {
    return serializeMarks(escapeMarkdown(node.text || ""), node.marks as NonNullable<JSONContent["marks"]>);
  }

  if (node.type === "hardBreak") {
    return "  \n";
  }

  if (node.type === "image") {
    const attrs = node.attrs as { alt?: string; src?: string; title?: string };
    const alt = escapeMarkdown(String(attrs.alt || ""));
    const src = String(attrs.src || "");
    const title = attrs.title ? ` "${String(attrs.title).replace(/"/g, '\\"')}"` : "";
    return `![${alt}](${src}${title})`;
  }

  return "";
}

function serializeInlineContent(nodes?: JSONContent[]) {
  return (nodes || []).map(serializeInline).join("");
}

function serializeParagraph(node: JSONContent) {
  return serializeInlineContent(node.content);
}

function serializeTable(node: JSONContent) {
  const rows = node.content || [];
  const matrix = rows.map((row) =>
    (row.content || []).map((cell) =>
      serializeInlineContent(cell.content?.[0]?.content || cell.content || [])
        .replace(/\s+/g, " ")
        .trim()
    )
  );

  if (!matrix.length) return "";

  const header = matrix[0];
  const separator = header.map(() => "---");
  const body = matrix.slice(1);

  return [
    `| ${header.join(" | ")} |`,
    `| ${separator.join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function serializeNode(node: JSONContent): string {
  switch (node.type) {
    case "paragraph":
      return serializeParagraph(node);
    case "heading": {
      const attrs = node.attrs as { level?: number };
      const level = Number(attrs.level || 1);
      return `${"#".repeat(Math.min(Math.max(level, 1), 6))} ${serializeParagraph(node)}`;
    }
    case "bulletList":
      return (node.content || [])
        .map((item) => {
          const lines = serializeBlockItem(item).split("\n");
          return [`- ${lines[0] || ""}`, ...lines.slice(1).map((line) => `  ${line}`)].join("\n");
        })
        .join("\n");
    case "orderedList": {
      const attrs = node.attrs as { start?: number };
      const start = Number(attrs.start || 1);
      return (node.content || [])
        .map((item, index) => {
          const lines = serializeBlockItem(item).split("\n");
          const prefix = `${start + index}. `;
          return [`${prefix}${lines[0] || ""}`, ...lines.slice(1).map((line) => `   ${line}`)].join("\n");
        })
        .join("\n");
    }
    case "taskList":
      return (node.content || [])
        .map((item) => {
          const attrs = item.attrs as { checked?: boolean };
          const checked = Boolean(attrs.checked);
          const lines = serializeBlockItem(item).split("\n");
          return [`- [${checked ? "x" : " "}] ${lines[0] || ""}`, ...lines.slice(1).map((line) => `  ${line}`)].join("\n");
        })
        .join("\n");
    case "blockquote":
      return (node.content || [])
        .map((child) => serializeNode(child).split("\n").map((line) => `> ${line}`).join("\n"))
        .join("\n");
    case "codeBlock": {
      const attrs = node.attrs as { language?: string };
      const language = String(attrs.language || "");
      const code = (node.content || []).map((line) => (line.text || "")).join("");
      return ["```" + language, code.replace(/\n$/, ""), "```"].join("\n");
    }
    case "horizontalRule":
      return "---";
    case "table":
      return serializeTable(node);
    case "image":
      return serializeInline(node);
    case "listItem":
    case "taskItem":
      return serializeBlockItem(node);
    case "hardBreak":
      return "";
    default:
      return serializeInlineContent(node.content);
  }
}

function serializeBlockItem(node: JSONContent) {
  const blocks = (node.content || []).map((child) => serializeNode(child)).filter(Boolean);
  if (!blocks.length) return "";
  return blocks.join("\n");
}

export function markdownToTiptapContent(markdownText: string): JSONContent {
  const parsed = markdown.parse(markdownText || "", {});
  const content = parseBlocks(parsed);

  return {
    type: "doc",
    content: content.length ? content : DEFAULT_DOC.content,
  };
}

export function tiptapContentToMarkdown(content: JSONContent | null | undefined): string {
  if (!content || content.type !== "doc") return "";
  return (content.content || [])
    .map((node) => serializeNode(node).trimEnd())
    .filter(Boolean)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n");
}

export function looksLikeMarkdown(input: string) {
  const text = input.trim();
  if (!text) return false;

  return [
    /^#{1,6}\s/m,
    /^\s*[-*+]\s+/m,
    /^\s*\d+\.\s+/m,
    /^\s*>\s+/m,
    /^\s*```/m,
    /^\s*---\s*$/m,
    /\[[^\]]+\]\([^)]+\)/m,
    /!\[[^\]]*\]\([^)]+\)/m,
    /^\s*\|.*\|.*$/m,
    /^\s*-\s+\[[ xX]\]\s+/m,
  ].some((pattern) => pattern.test(text));
}

export { DEFAULT_DOC as DEFAULT_DOCUMENT_CONTENT };
