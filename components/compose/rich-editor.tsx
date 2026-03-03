"use client";

import clsx from "clsx";
import { useEffect, useRef } from "react";
import { buildInlineImgTag, normalizeRichHtml } from "@/lib/formatting";
import type { DraftKind } from "@/lib/workspace";
import type { UiLocale } from "@/components/compose/types";

type RichEditorProps = {
  value: string;
  variant: DraftKind;
  locale: UiLocale;
  onChange: (next: string) => void;
  onFocus: () => void;
  bindRef: (el: HTMLDivElement | null) => void;
};

export function RichEditor({
  value,
  variant,
  locale,
  onChange,
  onFocus,
  bindRef
}: RichEditorProps) {
  const internalRef = useRef<HTMLDivElement | null>(null);
  const dragImgRef = useRef<HTMLImageElement | null>(null);
  const editorAriaLabel =
    variant === "article"
      ? locale === "zh"
        ? "文章编辑器"
        : "Article editor"
      : variant === "tweet"
        ? locale === "zh"
          ? "推文编辑器"
          : "Tweet editor"
        : locale === "zh"
          ? "线程条目编辑器"
          : "Thread post editor";

  useEffect(() => {
    if (!internalRef.current) {
      return;
    }
    const normalized = normalizeRichHtml(value);
    if (internalRef.current.innerHTML !== normalized) {
      internalRef.current.innerHTML = normalized;
    }
  }, [value]);

  return (
    <div
      ref={(element) => {
        internalRef.current = element;
        bindRef(element);
      }}
      className={clsx("tf-rich-editor", `tf-rich-${variant}`)}
      contentEditable
      role="textbox"
      aria-multiline="true"
      aria-label={editorAriaLabel}
      tabIndex={0}
      suppressContentEditableWarning
      data-placeholder={locale === "zh" ? "开始写作..." : "Write your draft..."}
      onFocus={onFocus}
      onInput={(event) => onChange(normalizeRichHtml(event.currentTarget.innerHTML))}
      onBlur={(event) => onChange(normalizeRichHtml(event.currentTarget.innerHTML))}
      onDragStart={(event) => {
        const target = event.target as HTMLElement;
        if (target.tagName === "IMG" && target.classList.contains("tf-inline-img")) {
          dragImgRef.current = target as HTMLImageElement;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/x-inline-img", "1");
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (event.dataTransfer.types.includes("text/x-inline-img")) {
          event.dataTransfer.dropEffect = "move";
        } else {
          event.dataTransfer.dropEffect = event.dataTransfer.types.includes("Files") ? "copy" : "move";
        }
      }}
      onDragEnd={() => {
        dragImgRef.current = null;
      }}
      onDrop={(event) => {
        const editor = internalRef.current;
        if (!editor) {
          return;
        }

        if (dragImgRef.current && event.dataTransfer.types.includes("text/x-inline-img")) {
          event.preventDefault();
          const img = dragImgRef.current;
          dragImgRef.current = null;
          const imgWrapper = img.closest("p") ?? img;
          const dropY = event.clientY;
          let insertBefore: Node | null = null;
          for (const child of Array.from(editor.childNodes)) {
            const rect = (child as HTMLElement).getBoundingClientRect?.();
            if (rect && dropY < rect.top + rect.height / 2) {
              insertBefore = child;
              break;
            }
          }
          if (insertBefore && insertBefore !== imgWrapper && insertBefore !== imgWrapper.nextSibling) {
            editor.insertBefore(imgWrapper, insertBefore);
          } else if (!insertBefore && imgWrapper !== editor.lastChild) {
            editor.appendChild(imgWrapper);
          }
          onChange(normalizeRichHtml(editor.innerHTML));
          return;
        }

        const files = Array.from(event.dataTransfer.files).filter(
          (f) => f.type.startsWith("image/") || f.type.startsWith("video/")
        );
        if (files.length > 0) {
          event.preventDefault();
          const existing = editor.querySelectorAll("img.tf-inline-img").length;
          const remaining = Math.max(0, 4 - existing);
          const accepted = files.slice(0, remaining);
          if (accepted.length === 0) {
            return;
          }
          let insertHtml = "";
          for (const file of accepted) {
            const url = URL.createObjectURL(file);
            const id = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const type =
              file.type.startsWith("video/") ? "video" : file.type === "image/gif" ? "gif" : "image";
            insertHtml += `<p>${buildInlineImgTag(url, id, file.name, type)}</p>`;
          }
          const dropY = event.clientY;
          let target: Node | null = null;
          for (const child of Array.from(editor.childNodes)) {
            const rect = (child as HTMLElement).getBoundingClientRect?.();
            if (rect && dropY < rect.top + rect.height / 2) {
              target = child;
              break;
            }
          }
          const temp = document.createElement("div");
          temp.innerHTML = insertHtml;
          const frag = document.createDocumentFragment();
          while (temp.firstChild) {
            frag.appendChild(temp.firstChild);
          }
          if (target) {
            editor.insertBefore(frag, target);
          } else {
            editor.appendChild(frag);
          }
          onChange(normalizeRichHtml(editor.innerHTML));
        }
      }}
    />
  );
}
