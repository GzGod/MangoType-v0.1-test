"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { buildInlineImgTag, normalizeRichHtml } from "@/lib/formatting";
import { createId, type WorkspaceState } from "@/lib/workspace";
import { TENOR_PAGE_SIZE } from "@/components/compose/constants";
import type { TenorGifApiResponse, TenorGifTile, UiLocale } from "@/components/compose/types";
import { mapTenorResults, mergeTenorResults } from "@/components/compose/utils";

type UseTenorPickerArgs = {
  locale: UiLocale;
  tenorApiKey: string;
  t: (en: string, zh: string) => string;
  currentDraft: WorkspaceState["drafts"][number] | undefined;
  editorRefs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  updateCurrentDraft: (
    updater: (draft: WorkspaceState["drafts"][number]) => WorkspaceState["drafts"][number]
  ) => void;
  closePostMenus: () => void;
  setNotice: Dispatch<SetStateAction<string>>;
};

export function useTenorPicker({
  locale,
  tenorApiKey,
  t,
  currentDraft,
  editorRefs,
  updateCurrentDraft,
  closePostMenus,
  setNotice
}: UseTenorPickerArgs) {
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [gifPickerPostId, setGifPickerPostId] = useState<string | null>(null);
  const [gifQuery, setGifQuery] = useState("");
  const [gifResults, setGifResults] = useState<TenorGifTile[]>([]);
  const [gifNextPos, setGifNextPos] = useState<string | null>(null);
  const [gifLoading, setGifLoading] = useState(false);
  const [gifError, setGifError] = useState("");
  const gifSearchRef = useRef<HTMLInputElement | null>(null);
  const gifRequestRef = useRef(0);

  const closeGifPicker = useCallback(() => {
    gifRequestRef.current += 1;
    setGifPickerOpen(false);
    setGifPickerPostId(null);
    setGifQuery("");
    setGifResults([]);
    setGifNextPos(null);
    setGifError("");
    setGifLoading(false);
  }, []);

  const openGifPicker = useCallback(
    (postId: string) => {
      closePostMenus();
      setGifPickerPostId(postId);
      setGifPickerOpen(true);
      setGifQuery("");
      setGifResults([]);
      setGifNextPos(null);
      setGifError("");
    },
    [closePostMenus]
  );

  const fetchTenorGifs = useCallback(
    async (options: { query: string; append: boolean; pos?: string | null }) => {
      const requestId = ++gifRequestRef.current;
      const query = options.query.trim();
      const endpoint = query ? "search" : "trending";
      const params = new URLSearchParams({
        key: tenorApiKey,
        limit: String(TENOR_PAGE_SIZE),
        media_filter: "minimal",
        contentfilter: "medium",
        locale: locale === "zh" ? "zh_CN" : "en_US"
      });
      if (query) {
        params.set("q", query);
      }
      if (options.pos) {
        params.set("pos", options.pos);
      }

      setGifLoading(true);
      setGifError("");

      try {
        const response = await fetch(`https://g.tenor.com/v1/${endpoint}?${params.toString()}`, {
          method: "GET",
          cache: "no-store"
        });
        if (!response.ok) {
          throw new Error(`Tenor request failed: ${response.status}`);
        }
        const payload = (await response.json()) as TenorGifApiResponse;
        if (requestId !== gifRequestRef.current) {
          return;
        }
        const items = mapTenorResults(payload.results ?? []);
        setGifResults((prev) => (options.append ? mergeTenorResults(prev, items) : items));
        setGifNextPos(payload.next !== undefined && payload.next !== null ? String(payload.next) : null);
      } catch (error) {
        if (requestId !== gifRequestRef.current) {
          return;
        }
        console.error(error);
        setGifError(t("Unable to load GIFs. Check network or API key.", "GIF 加载失败，请检查网络或 Tenor Key。"));
        if (!options.append) {
          setGifResults([]);
        }
      } finally {
        if (requestId === gifRequestRef.current) {
          setGifLoading(false);
        }
      }
    },
    [locale, t, tenorApiKey]
  );

  const insertGifToPost = useCallback(
    (postId: string, gif: TenorGifTile) => {
      const editor = editorRefs.current[postId];
      if (editor) {
        const existing = editor.querySelectorAll("img.tf-inline-img").length;
        const mediaCount = currentDraft?.posts.find((p) => p.id === postId)?.media?.length ?? 0;
        if (existing + mediaCount >= 4) {
          closeGifPicker();
          setNotice(t("Max 4 media per tweet.", "每条推文最多 4 个媒体文件。"));
          return;
        }
        const id = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const imgTag = `<p>${buildInlineImgTag(gif.gifUrl, id, gif.title, "gif")}</p>`;
        editor.insertAdjacentHTML("beforeend", imgTag);
        const postText = normalizeRichHtml(editor.innerHTML);
        updateCurrentDraft((draft) => ({
          ...draft,
          posts: draft.posts.map((post) => (post.id === postId ? { ...post, text: postText } : post))
        }));
      } else {
        updateCurrentDraft((draft) => ({
          ...draft,
          posts: draft.posts.map((post) =>
            post.id === postId
              ? {
                  ...post,
                  media: [...(post.media ?? []), { id: createId(), type: "gif", name: gif.title, url: gif.gifUrl }]
                }
              : post
          )
        }));
      }
      closeGifPicker();
      setNotice(t("GIF added.", "已添加 GIF。"));
    },
    [closeGifPicker, currentDraft, editorRefs, setNotice, t, updateCurrentDraft]
  );

  useEffect(() => {
    if (!gifPickerOpen) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      gifSearchRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [gifPickerOpen]);

  useEffect(() => {
    if (!gifPickerOpen) {
      return;
    }
    const timer = window.setTimeout(() => {
      void fetchTenorGifs({
        query: gifQuery,
        append: false
      });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [fetchTenorGifs, gifPickerOpen, gifQuery, locale]);

  return {
    gifPickerOpen,
    gifPickerPostId,
    gifQuery,
    gifResults,
    gifNextPos,
    gifLoading,
    gifError,
    gifSearchRef,
    setGifQuery,
    closeGifPicker,
    openGifPicker,
    fetchTenorGifs,
    insertGifToPost
  };
}
