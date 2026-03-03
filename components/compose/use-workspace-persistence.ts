"use client";

import { useEffect, type Dispatch, type SetStateAction } from "react";
import {
  LEGACY_STORAGE_KEY,
  WORKSPACE_STORAGE_KEY,
  migrateLegacyState,
  normalizeWorkspaceState,
  type WorkspaceState
} from "@/lib/workspace";
import {
  DRAFT_HISTORY_STORAGE_KEY,
  LOCALE_STORAGE_KEY,
  ONBOARDING_SEEN_KEY,
  THEME_STORAGE_KEY
} from "@/components/compose/constants";
import type { DraftSnapshot, UiLocale, UiTheme, WorkspaceSaveState } from "@/components/compose/types";

type UseWorkspacePersistenceArgs = {
  workspace: WorkspaceState;
  hydrated: boolean;
  theme: UiTheme;
  locale: UiLocale;
  draftHistory: Record<string, DraftSnapshot[]>;
  setWorkspace: Dispatch<SetStateAction<WorkspaceState>>;
  setTheme: Dispatch<SetStateAction<UiTheme>>;
  setLocale: Dispatch<SetStateAction<UiLocale>>;
  setDraftHistory: Dispatch<SetStateAction<Record<string, DraftSnapshot[]>>>;
  setShowOnboarding: Dispatch<SetStateAction<boolean>>;
  setHydrated: Dispatch<SetStateAction<boolean>>;
  setWorkspaceSaveState: Dispatch<SetStateAction<WorkspaceSaveState>>;
  setWorkspaceLastSavedAt: Dispatch<SetStateAction<string | null>>;
};

export function useWorkspacePersistence({
  workspace,
  hydrated,
  theme,
  locale,
  draftHistory,
  setWorkspace,
  setTheme,
  setLocale,
  setDraftHistory,
  setShowOnboarding,
  setHydrated,
  setWorkspaceSaveState,
  setWorkspaceLastSavedAt
}: UseWorkspacePersistenceArgs) {
  useEffect(() => {
    const saved = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (saved) {
      try {
        setWorkspace(normalizeWorkspaceState(JSON.parse(saved) as Partial<WorkspaceState>));
      } catch {
        window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
      }
    } else {
      const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        const migrated = migrateLegacyState(legacy);
        if (migrated) {
          setWorkspace(migrated);
        }
      }
    }

    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === "signature" || storedTheme === "ink" || storedTheme === "sunset") {
      setTheme(storedTheme);
    }

    const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (storedLocale === "zh" || storedLocale === "en") {
      setLocale(storedLocale);
    }

    const storedHistory = window.localStorage.getItem(DRAFT_HISTORY_STORAGE_KEY);
    if (storedHistory) {
      try {
        const parsed = JSON.parse(storedHistory) as Record<string, DraftSnapshot[]>;
        setDraftHistory(parsed);
      } catch {
        window.localStorage.removeItem(DRAFT_HISTORY_STORAGE_KEY);
      }
    }

    if (!window.localStorage.getItem(ONBOARDING_SEEN_KEY)) {
      setShowOnboarding(true);
    }
    setHydrated(true);
  }, [setDraftHistory, setHydrated, setLocale, setShowOnboarding, setTheme, setWorkspace]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    setWorkspaceSaveState("saving");
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspace));
        setWorkspaceSaveState("saved");
        setWorkspaceLastSavedAt(new Date().toISOString());
      } catch {
        setWorkspaceSaveState("failed");
      }
    }, 360);
    return () => window.clearTimeout(timer);
  }, [hydrated, setWorkspaceLastSavedAt, setWorkspaceSaveState, workspace]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [hydrated, theme]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }, [hydrated, locale]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    window.localStorage.setItem(DRAFT_HISTORY_STORAGE_KEY, JSON.stringify(draftHistory));
  }, [draftHistory, hydrated]);
}
