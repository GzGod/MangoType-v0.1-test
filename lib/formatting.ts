export type TweetFormatMode = "plain" | "unicode";

export type PreviewBlockType = "h1" | "h2" | "h3" | "quote" | "list" | "p" | "empty";

export interface PreviewBlock {
  type: PreviewBlockType;
  text: string;
}

interface InlineChunk {
  text: string;
  bold: boolean;
  italic: boolean;
}

interface RichBlock {
  type: PreviewBlockType;
  chunks: InlineChunk[];
}

const BOLD_UPPER_A = 0x1d400;
const BOLD_LOWER_A = 0x1d41a;
const BOLD_DIGIT_0 = 0x1d7ce;
const ITALIC_UPPER_A = 0x1d434;
const ITALIC_LOWER_A = 0x1d44e;
const BOLD_ITALIC_UPPER_A = 0x1d468;
const BOLD_ITALIC_LOWER_A = 0x1d482;

export function toRichHtml(input: string): string {
  if (!input.trim()) {
    return "<p><br></p>";
  }
  if (/<[a-z][\s\S]*>/i.test(input.trim())) {
    return normalizeRichHtml(input);
  }
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const result: string[] = [];
  let listBuffer: string[] = [];

  const flushList = () => {
    if (listBuffer.length === 0) {
      return;
    }
    result.push(`<ul>${listBuffer.join("")}</ul>`);
    listBuffer = [];
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      result.push("<p><br></p>");
      return;
    }
    if (trimmed.startsWith("### ")) {
      flushList();
      result.push(`<h3>${inlineMarkdownToHtml(trimmed.slice(4))}</h3>`);
      return;
    }
    if (trimmed.startsWith("## ")) {
      flushList();
      result.push(`<h2>${inlineMarkdownToHtml(trimmed.slice(3))}</h2>`);
      return;
    }
    if (trimmed.startsWith("# ")) {
      flushList();
      result.push(`<h1>${inlineMarkdownToHtml(trimmed.slice(2))}</h1>`);
      return;
    }
    if (trimmed.startsWith("> ")) {
      flushList();
      result.push(`<blockquote>${inlineMarkdownToHtml(trimmed.slice(2))}</blockquote>`);
      return;
    }
    if (/^(?:-|\*)\s+/.test(trimmed)) {
      listBuffer.push(`<li>${inlineMarkdownToHtml(trimmed.replace(/^(?:-|\*)\s+/, ""))}</li>`);
      return;
    }
    flushList();
    result.push(`<p>${inlineMarkdownToHtml(trimmed)}</p>`);
  });
  flushList();
  return normalizeRichHtml(result.join(""));
}

export function normalizeRichHtml(input: string): string {
  if (!input.trim()) {
    return "<p><br></p>";
  }
  if (typeof window === "undefined") {
    return input;
  }
  const container = window.document.createElement("div");
  container.innerHTML = input;
  sanitizeNode(container);
  if (!container.innerHTML.trim()) {
    return "<p><br></p>";
  }
  return container.innerHTML;
}

export function toTweetText(input: string, mode: TweetFormatMode): string {
  const blocks = parseBlocks(input);
  return blocks
    .map((block) => {
      const content = renderChunks(block.chunks, mode);
      if (!content && block.type !== "empty") {
        return "";
      }
      if (block.type === "h1") {
        return `◆ ${content}`;
      }
      if (block.type === "h2") {
        return `▹ ${content}`;
      }
      if (block.type === "h3") {
        return `▸ ${content}`;
      }
      if (block.type === "quote") {
        return `❝ ${content}`;
      }
      if (block.type === "list") {
        return `• ${content}`;
      }
      if (block.type === "empty") {
        return "";
      }
      return content;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

export function toLintText(input: string): string {
  const blocks = parseBlocks(input);
  return blocks
    .map((block) => renderChunks(block.chunks, "plain"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

export function toArticleDocument(posts: string[]): string {
  return posts
    .map((html) => blocksToMarkdown(parseBlocks(html)))
    .filter((text) => text.trim().length > 0)
    .join("\n\n");
}

export function toArticleHtmlDocument(posts: string[]): string {
  const sections = posts
    .map((html) => normalizeRichHtml(html))
    .filter((html) => html.replace(/<[^>]+>/g, "").trim().length > 0)
    .map((html) => `<section>${html}</section>`);
  return sections.join("<hr/>");
}

export function parsePreviewBlocks(
  input: string,
  mode: TweetFormatMode
): PreviewBlock[] {
  return parseBlocks(input).map((block) => ({
    type: block.type,
    text: renderChunks(block.chunks, mode)
  }));
}

function parseBlocks(input: string): RichBlock[] {
  if (!input.trim()) {
    return [{ type: "empty", chunks: [{ text: "", bold: false, italic: false }] }];
  }

  if (typeof window === "undefined") {
    return parseFallback(input);
  }

  const container = window.document.createElement("div");
  container.innerHTML = normalizeRichHtml(input);
  const blocks: RichBlock[] = [];

  Array.from(container.childNodes).forEach((node) => {
    if (node.nodeType === window.Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text.trim()) {
        blocks.push({
          type: "p",
          chunks: [{ text, bold: false, italic: false }]
        });
      }
      return;
    }

    if (node.nodeType !== window.Node.ELEMENT_NODE) {
      return;
    }

    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();

    if (tag === "ul" || tag === "ol") {
      Array.from(element.children).forEach((child) => {
        if (child.tagName.toLowerCase() === "li") {
          blocks.push({
            type: "list",
            chunks: extractChunks(child, false, false)
          });
        }
      });
      return;
    }

    blocks.push({
      type: mapTagToBlock(tag),
      chunks: extractChunks(element, false, false)
    });
  });

  return blocks.length > 0
    ? blocks
    : [{ type: "empty", chunks: [{ text: "", bold: false, italic: false }] }];
}

function parseFallback(input: string): RichBlock[] {
  const text = input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|h3|blockquote|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) {
    return [{ type: "empty", chunks: [{ text: "", bold: false, italic: false }] }];
  }
  return text.split("\n").map((line) => ({
    type: "p",
    chunks: [{ text: line, bold: false, italic: false }]
  }));
}

function mapTagToBlock(tag: string): PreviewBlockType {
  if (tag === "h1") {
    return "h1";
  }
  if (tag === "h2") {
    return "h2";
  }
  if (tag === "h3") {
    return "h3";
  }
  if (tag === "blockquote") {
    return "quote";
  }
  return "p";
}

function extractChunks(
  node: Node,
  inheritedBold: boolean,
  inheritedItalic: boolean
): InlineChunk[] {
  if (typeof window === "undefined") {
    return [{ text: node.textContent ?? "", bold: inheritedBold, italic: inheritedItalic }];
  }

  if (node.nodeType === window.Node.TEXT_NODE) {
    return [
      {
        text: node.textContent ?? "",
        bold: inheritedBold,
        italic: inheritedItalic
      }
    ];
  }

  if (node.nodeType !== window.Node.ELEMENT_NODE) {
    return [];
  }

  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();
  const bold = inheritedBold || tag === "strong" || tag === "b";
  const italic = inheritedItalic || tag === "em" || tag === "i";

  if (tag === "br") {
    return [{ text: "\n", bold, italic }];
  }

  return Array.from(element.childNodes).flatMap((child) =>
    extractChunks(child, bold, italic)
  );
}

function renderChunks(chunks: InlineChunk[], mode: TweetFormatMode): string {
  return chunks
    .map((chunk) => applyTextStyle(chunk.text, chunk.bold, chunk.italic, mode))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function applyTextStyle(
  text: string,
  bold: boolean,
  italic: boolean,
  mode: TweetFormatMode
): string {
  if (mode === "plain" || (!bold && !italic)) {
    return text;
  }
  return Array.from(text)
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      if (bold && italic) {
        if (code >= 65 && code <= 90) {
          return String.fromCodePoint(BOLD_ITALIC_UPPER_A + (code - 65));
        }
        if (code >= 97 && code <= 122) {
          return String.fromCodePoint(BOLD_ITALIC_LOWER_A + (code - 97));
        }
        if (code >= 48 && code <= 57) {
          return String.fromCodePoint(BOLD_DIGIT_0 + (code - 48));
        }
        return char;
      }
      if (bold) {
        if (code >= 65 && code <= 90) {
          return String.fromCodePoint(BOLD_UPPER_A + (code - 65));
        }
        if (code >= 97 && code <= 122) {
          return String.fromCodePoint(BOLD_LOWER_A + (code - 97));
        }
        if (code >= 48 && code <= 57) {
          return String.fromCodePoint(BOLD_DIGIT_0 + (code - 48));
        }
      }
      if (italic) {
        if (code >= 65 && code <= 90) {
          return String.fromCodePoint(ITALIC_UPPER_A + (code - 65));
        }
        if (code >= 97 && code <= 122) {
          return String.fromCodePoint(ITALIC_LOWER_A + (code - 97));
        }
      }
      return char;
    })
    .join("");
}

function blocksToMarkdown(blocks: RichBlock[]): string {
  return blocks
    .map((block) => {
      const content = block.chunks.map((chunk) => toMarkdownChunk(chunk)).join("").trim();
      if (!content && block.type !== "empty") {
        return "";
      }
      if (block.type === "h1") {
        return `# ${content}`;
      }
      if (block.type === "h2") {
        return `## ${content}`;
      }
      if (block.type === "h3") {
        return `### ${content}`;
      }
      if (block.type === "quote") {
        return `> ${content}`;
      }
      if (block.type === "list") {
        return `- ${content}`;
      }
      if (block.type === "empty") {
        return "";
      }
      return content;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function toMarkdownChunk(chunk: InlineChunk): string {
  const text = chunk.text.replace(/\n/g, " ").trim();
  if (!text) {
    return "";
  }
  if (chunk.bold && chunk.italic) {
    return `***${text}***`;
  }
  if (chunk.bold) {
    return `**${text}**`;
  }
  if (chunk.italic) {
    return `*${text}*`;
  }
  return text;
}

function inlineMarkdownToHtml(input: string): string {
  const escaped = escapeHtml(input);
  const boldProtected = escaped.replace(/\*\*([^*]+)\*\*/g, (_, content: string) => {
    return `{{B:${content}}}`;
  });
  const italicProtected = boldProtected.replace(/\*([^*]+)\*/g, (_, content: string) => {
    return `{{I:${content}}}`;
  });
  return italicProtected
    .replace(/\{\{B:([^}]+)\}\}/g, "<strong>$1</strong>")
    .replace(/\{\{I:([^}]+)\}\}/g, "<em>$1</em>");
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeNode(root: HTMLElement): void {
  const allowed = new Set([
    "p",
    "br",
    "strong",
    "b",
    "em",
    "i",
    "h1",
    "h2",
    "h3",
    "blockquote",
    "ul",
    "ol",
    "li",
    "div"
  ]);

  Array.from(root.querySelectorAll("*")).forEach((element) => {
    const tag = element.tagName.toLowerCase();
    if (!allowed.has(tag)) {
      const text = window.document.createTextNode(element.textContent ?? "");
      element.replaceWith(text);
      return;
    }
    Array.from(element.attributes).forEach((attribute) => {
      element.removeAttribute(attribute.name);
    });
    if (tag === "div") {
      const replacement = window.document.createElement("p");
      replacement.innerHTML = element.innerHTML || "<br>";
      element.replaceWith(replacement);
    }
    if (tag === "b") {
      const replacement = window.document.createElement("strong");
      replacement.innerHTML = element.innerHTML;
      element.replaceWith(replacement);
    }
    if (tag === "i") {
      const replacement = window.document.createElement("em");
      replacement.innerHTML = element.innerHTML;
      element.replaceWith(replacement);
    }
  });
}
