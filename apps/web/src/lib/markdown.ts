/**
 * Markdown to React elements for the `/architecture` page (D-034, D-061).
 *
 * markdown-it parses (CommonMark plus tables, raw HTML disabled, so `<script>` in a doc is text);
 * this module walks its token stream and builds React elements from a fixed list of tags. No HTML
 * string is ever injected, so nothing in a doc can become markup the page did not choose. Links:
 * http(s) and mailto open in a new tab, in-page anchors stay, and repository-relative links (to
 * files the web app does not serve) render as plain text. Headings get GitHub-style ids.
 *
 * Caller: pages/Architecture.tsx.
 */
import MarkdownIt, { type Token } from "markdown-it";
import { createElement, type ReactNode } from "react";

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });

const ALLOWED = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "strong",
  "em",
  "s",
  "a",
  "br",
  "span",
  "div",
]);

/** GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens. */
export function slug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

function textOf(tokens: readonly Token[] | null): string {
  return (tokens ?? []).map((t) => (t.children ? textOf(t.children) : t.content)).join("");
}

interface Frame {
  tag: string;
  props: Record<string, unknown>;
  children: ReactNode[];
}

function propsFor(token: Token, inlineText: string): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  if (/^h[1-6]$/.test(token.tag)) props.id = slug(inlineText);
  if (token.tag === "ol") {
    const start = token.attrGet("start");
    if (start !== null) props.start = Number(start);
  }
  const style = token.attrGet("style");
  const align =
    typeof style === "string" ? style.match(/text-align:\s*(left|right|center)/)?.[1] : undefined;
  if (align) props.style = { textAlign: align };
  return props;
}

/** Turns a markdown-it token stream (block or inline) into React nodes. */
function build(tokens: readonly Token[], keyPrefix: string): ReactNode[] {
  const root: Frame = { tag: "root", props: {}, children: [] };
  const stack: Frame[] = [root];
  let key = 0;
  const top = () => stack[stack.length - 1] as Frame;
  const emit = (node: ReactNode) => top().children.push(node);
  const element = (tag: string, props: Record<string, unknown>, children: ReactNode[]) =>
    createElement(
      ALLOWED.has(tag) ? tag : "span",
      { key: `${keyPrefix}-${key++}`, ...props },
      ...children,
    );

  tokens.forEach((token, index) => {
    if (token.hidden) return; // tight lists hide their paragraphs
    if (token.nesting === 1) {
      const next = tokens[index + 1];
      const inlineText = next?.type === "inline" ? textOf(next.children) : "";
      if (token.type === "link_open") {
        const href = String(token.attrGet("href") ?? "");
        const external = /^(https?:|mailto:)/i.test(href);
        const anchor = href.startsWith("#");
        stack.push({
          tag: external || anchor ? "a" : "span",
          props: external
            ? { href, target: "_blank", rel: "noreferrer" }
            : anchor
              ? { href }
              : { className: "md-ref" },
          children: [],
        });
        return;
      }
      stack.push({ tag: token.tag, props: propsFor(token, inlineText), children: [] });
      return;
    }
    if (token.nesting === -1) {
      const frame = stack.pop();
      if (!frame || frame === root) return;
      const built = element(frame.tag, frame.props, frame.children);
      // Wide tables scroll inside their own box, never the page (PLAN 6, 390 px).
      emit(frame.tag === "table" ? element("div", { className: "md-table" }, [built]) : built);
      return;
    }
    switch (token.type) {
      case "inline":
        for (const node of build(token.children ?? [], `${keyPrefix}-${key++}`)) emit(node);
        return;
      case "text":
        emit(token.content);
        return;
      case "code_inline":
        emit(element("code", {}, [token.content]));
        return;
      case "softbreak":
        emit("\n");
        return;
      case "hardbreak":
        emit(element("br", {}, []));
        return;
      case "fence":
      case "code_block": {
        const language = token.info.trim().split(/\s+/)[0];
        emit(
          element("pre", { className: "md-pre", tabIndex: 0 }, [
            element("code", language ? { "data-lang": language } : {}, [token.content]),
          ]),
        );
        return;
      }
      case "hr":
        emit(element("hr", {}, []));
        return;
      case "image":
        emit(textOf(token.children) || token.content);
        return;
      default:
        // Anything else (raw HTML is disabled, so none in practice) is shown as its text.
        if (token.content) emit(token.content);
    }
  });
  return root.children;
}

/** The markdown source as React nodes; raw HTML and scripts stay text. */
export function renderMarkdown(source: string, keyPrefix = "md"): ReactNode[] {
  return build(md.parse(source, {}), keyPrefix);
}
