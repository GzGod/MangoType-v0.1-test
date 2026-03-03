"use client";

import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { PaneTab, UiLocale } from "@/components/compose/types";
import type { WorkspaceState } from "@/lib/workspace";

type DraftItem = WorkspaceState["drafts"][number];
type DraftPost = DraftItem["posts"][number];

type UseGlobalShortcutsArgs = {
  locale: UiLocale;
  t: (en: string, zh: string) => string;
  paneTab: PaneTab;
  activeView: WorkspaceState["activeView"];
  currentDraft: DraftItem | undefined;
  currentPost: DraftPost | undefined;
  drafts: WorkspaceState["drafts"];
  selectedDraftId: string;
  addDraftSnapshot: (draft: DraftItem, label: string, source: "manual" | "auto") => void;
  setNotice: Dispatch<SetStateAction<string>>;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleSidebar: () => void;
  togglePreviewView: () => void;
  publishCurrentDraft: () => void | Promise<void>;
  queueCurrentDraft: () => void;
  insertPostBelow: (postId: string) => void;
  movePostDown: (postId: string) => void;
  openUploadForPost: (postId: string) => void;
  setMediaMenuPostId: Dispatch<SetStateAction<string | null>>;
  setAiMenuPostId: Dispatch<SetStateAction<string | null>>;
  setMoreMenuPostId: Dispatch<SetStateAction<string | null>>;
  setDraftPickerOpen: Dispatch<SetStateAction<boolean>>;
  setTemplateLibraryOpen: Dispatch<SetStateAction<boolean>>;
  setHistoryOpen: Dispatch<SetStateAction<boolean>>;
  setShortcutsOpen: Dispatch<SetStateAction<boolean>>;
  closeGifPicker: () => void;
  setSelectionToolbar: Dispatch<
    SetStateAction<{
      visible: boolean;
      x: number;
      y: number;
      postId: string | null;
    }>
  >;
};

export function useGlobalShortcuts({
  locale,
  t,
  paneTab,
  activeView,
  currentDraft,
  currentPost,
  drafts,
  selectedDraftId,
  addDraftSnapshot,
  setNotice,
  openCommandPalette,
  closeCommandPalette,
  toggleSidebar,
  togglePreviewView,
  publishCurrentDraft,
  queueCurrentDraft,
  insertPostBelow,
  movePostDown,
  openUploadForPost,
  setMediaMenuPostId,
  setAiMenuPostId,
  setMoreMenuPostId,
  setDraftPickerOpen,
  setTemplateLibraryOpen,
  setHistoryOpen,
  setShortcutsOpen,
  closeGifPicker,
  setSelectionToolbar
}: UseGlobalShortcutsArgs) {
  useEffect(() => {
    function onEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      setMediaMenuPostId(null);
      setAiMenuPostId(null);
      setMoreMenuPostId(null);
      setDraftPickerOpen(false);
      closeCommandPalette();
      setTemplateLibraryOpen(false);
      setHistoryOpen(false);
      setShortcutsOpen(false);
      closeGifPicker();
      setSelectionToolbar((prev) => ({ ...prev, visible: false, postId: null }));
    }
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [
    closeCommandPalette,
    closeGifPicker,
    setAiMenuPostId,
    setDraftPickerOpen,
    setHistoryOpen,
    setMediaMenuPostId,
    setMoreMenuPostId,
    setSelectionToolbar,
    setShortcutsOpen,
    setTemplateLibraryOpen
  ]);

  useEffect(() => {
    function onGlobalShortcuts(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      const withMod = event.ctrlKey || event.metaKey;

      if (withMod && key === "k") {
        event.preventDefault();
        openCommandPalette();
        return;
      }
      if (withMod && (key === "/" || key === "?")) {
        event.preventDefault();
        toggleSidebar();
        return;
      }
      if (withMod && event.shiftKey && key === "t") {
        event.preventDefault();
        setTemplateLibraryOpen(true);
        return;
      }
      if (withMod && event.shiftKey && key === "h") {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (withMod && event.shiftKey && key === "p") {
        event.preventDefault();
        togglePreviewView();
        return;
      }
      if (withMod && event.shiftKey && key === "v") {
        event.preventDefault();
        const activeDraft = drafts.find((item) => item.id === selectedDraftId) ?? drafts[0];
        if (!activeDraft) {
          return;
        }
        addDraftSnapshot(activeDraft, "Manual", "manual");
        setNotice(t("Version snapshot saved.", "版本快照已保存。"));
      }
    }
    window.addEventListener("keydown", onGlobalShortcuts);
    return () => window.removeEventListener("keydown", onGlobalShortcuts);
  }, [
    addDraftSnapshot,
    drafts,
    openCommandPalette,
    selectedDraftId,
    setNotice,
    setShortcutsOpen,
    setTemplateLibraryOpen,
    t,
    togglePreviewView,
    toggleSidebar
  ]);

  useEffect(() => {
    function onEditorShortcuts(event: KeyboardEvent) {
      if (paneTab !== "drafts" || activeView !== "compose" || !currentDraft || !currentPost) {
        return;
      }

      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void publishCurrentDraft();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === "s") {
        event.preventDefault();
        queueCurrentDraft();
        return;
      }

      if (currentDraft.kind !== "thread") {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && key === "j") {
        event.preventDefault();
        insertPostBelow(currentPost.id);
        return;
      }
      if (event.altKey && event.key === "ArrowDown") {
        event.preventDefault();
        movePostDown(currentPost.id);
        return;
      }
      if (event.ctrlKey && event.shiftKey && key === "i") {
        event.preventDefault();
        openUploadForPost(currentPost.id);
      }
    }
    window.addEventListener("keydown", onEditorShortcuts);
    return () => window.removeEventListener("keydown", onEditorShortcuts);
  }, [
    activeView,
    currentDraft,
    currentPost,
    insertPostBelow,
    movePostDown,
    openUploadForPost,
    paneTab,
    publishCurrentDraft,
    queueCurrentDraft
  ]);
}
