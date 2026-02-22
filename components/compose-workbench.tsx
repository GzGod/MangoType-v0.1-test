"use client";

import clsx from "clsx";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import type { Session } from "next-auth";
import {
  applyAllFixes,
  applyRuleFix,
  lintText,
  parseWhitelistInput,
  RULE_DEFINITIONS,
  type RuleIssue
} from "@/lib/rule-engine";
import {
  normalizeRichHtml,
  toRichHtml,
  toArticleDocument,
  toArticleHtmlDocument,
  toLintText,
  toTweetText
} from "@/lib/formatting";
import {
  appendActivityLogs,
  buildQueueItem,
  createActivityLog,
  createDefaultWorkspaceState,
  createDraft,
  createId,
  DRAFT_KIND_LABELS,
  formatDateTime,
  LEGACY_STORAGE_KEY,
  migrateLegacyState,
  normalizeWorkspaceState,
  publishQueueItem,
  retryQueueItem,
  sortPublishedDesc,
  sortQueueAsc,
  WORKSPACE_STORAGE_KEY,
  type DraftKind,
  type WorkspaceState
} from "@/lib/workspace";
import { computeAnalytics, formatNumber } from "@/lib/dashboard";
import { getXCount } from "@/lib/x-count";

type PaneTab = "drafts" | "scheduled" | "posted";
type PublishState =
  | "idle"
  | "blocked"
  | "scheduling"
  | "scheduled"
  | "publishing"
  | "published";
type UiTheme = "signature" | "ink" | "sunset";
type UiLocale = "en" | "zh";
type WorkspaceSaveState = "saving" | "saved" | "failed";
type QuickCommand = {
  id: string;
  label: string;
  hint: string;
  keywords: string;
  run: () => void | Promise<void>;
};
type DraftTemplate = {
  id: string;
  name: string;
  kind: DraftKind;
  title: string;
  description: string;
  posts: string[];
};
type DraftSnapshot = {
  id: string;
  draftId: string;
  createdAt: string;
  label: string;
  signature: string;
  kind: DraftKind;
  title: string;
  topic?: string;
  posts: WorkspaceState["drafts"][number]["posts"];
  selectedPostId: string;
};
type TenorMediaVariant = {
  url?: string;
  preview?: string;
  dims?: number[];
};
type TenorGifApiItem = {
  id: string;
  title?: string;
  content_description?: string;
  media?: Array<{
    gif?: TenorMediaVariant;
    tinygif?: TenorMediaVariant;
    mediumgif?: TenorMediaVariant;
    nanogif?: TenorMediaVariant;
  }>;
};
type TenorGifApiResponse = {
  results?: TenorGifApiItem[];
  next?: string | number;
};
type TenorGifTile = {
  id: string;
  title: string;
  gifUrl: string;
  previewUrl: string;
  width: number;
  height: number;
};
type XPublishResponse = {
  data?: {
    id?: string;
  };
  error?: string;
  message?: string;
  status?: number;
  details?: {
    detail?: string;
    title?: string;
    errors?: Array<{
      message?: string;
    }>;
  };
};

const ONBOARDING_SEEN_KEY = "hanfully_v2_onboarding_seen";
const THEME_STORAGE_KEY = "hanfully_v2_theme";
const DRAFT_HISTORY_STORAGE_KEY = "hanfully_v2_draft_history";
const LOCALE_STORAGE_KEY = "hanfully_v2_locale";
const TENOR_DEFAULT_KEY = "LIVDSRZULELA";
const TENOR_PAGE_SIZE = 24;
const TOPIC_FILTER_ALL = "__all_topics__";
const TOPIC_FILTER_UNTAGGED = "__untagged__";
const THEME_OPTIONS: Array<{ id: UiTheme; label: string }> = [
  { id: "signature", label: "Signature" },
  { id: "ink", label: "Ink" },
  { id: "sunset", label: "Sunset" }
];

const DRAFT_OPTIONS: Array<{
  kind: DraftKind;
  title: string;
  description: string;
}> = [
  {
    kind: "tweet",
    title: "Tweet",
    description: "Single post, 280-char focused."
  },
  {
    kind: "thread",
    title: "Thread",
    description: "Multi-post flow, same as current layout."
  },
  {
    kind: "article",
    title: "Article",
    description: "Long-form editor with title and subtitle styles."
  }
];

const TEMPLATE_LIBRARY: DraftTemplate[] = [
  {
    id: "tweet-product-launch",
    name: "Product Launch Tweet",
    kind: "tweet",
    title: "Launch Tweet",
    description: "Clear product launch post with CTA.",
    posts: [
      "<p>We shipped a new feature to help creators plan one week of content in one session.</p><p>Built for solo founders and brand teams.</p><p>Reply if you want the workflow template.</p>"
    ]
  },
  {
    id: "tweet-hot-take",
    name: "Hot Take Tweet",
    kind: "tweet",
    title: "Hot Take Tweet",
    description: "One opinion + one reason + one question.",
    posts: [
      "<p>Most content growth problems are clarity problems, not distribution problems.</p><p>Structure first, channels second.</p><p>Do you agree?</p>"
    ]
  },
  {
    id: "thread-playbook",
    name: "Playbook Thread",
    kind: "thread",
    title: "Playbook Thread",
    description: "Hook + framework + CTA thread.",
    posts: [
      "If you build content for growth, this 3-step workflow is enough.\n\nInput -> Shape -> Distribute.",
      "Input: collect 3 real audience questions every day.\n\nDo not start from opinions, start from questions.",
      "Shape: keep one post focused on one idea.\n\nUse structure: claim -> reason -> example.",
      "Distribute: repurpose one idea into Tweet, Thread, and Article.\n\nConsistency compounds.",
      "If helpful, I can share a copy-paste SOP next."
    ]
  },
  {
    id: "thread-story",
    name: "Story Thread",
    kind: "thread",
    title: "Story Thread",
    description: "Narrative flow for personal story.",
    posts: [
      "It took me 6 months to realize low output was not a motivation problem.",
      "I used to force myself to write everything in one sitting. It always got stuck.",
      "Then I switched to a 3-step loop: write the point, add proof, add examples.",
      "That cut my writing time from 2 hours to about 35 minutes.",
      "If you feel blocked, try this for one week."
    ]
  },
  {
    id: "article-framework",
    name: "Framework Article",
    kind: "article",
    title: "Framework Article",
    description: "Structured article with title/subtitle/body.",
    posts: [
      "<h1>A Minimal Content System</h1><h2>From random output to repeatable quality</h2><p>Most creators rely on inspiration, so quality and cadence are unstable.</p><p>A better path is process: topic, structure, expression, distribution.</p><h3>1. Topic</h3><p>Capture audience questions weekly and prioritize by frequency.</p><h3>2. Structure</h3><p>Lead with the point, then add proof, then suggest action.</p><h3>3. Distribution</h3><p>Repurpose one core idea into Tweet, Thread, and Article.</p>"
    ]
  },
  {
    id: "article-case-study",
    name: "Case Study Article",
    kind: "article",
    title: "Case Study Article",
    description: "Case-study article skeleton.",
    posts: [
      "<h1>How We Built a 30-Day Content Cadence</h1><h2>What changed in strategy and execution</h2><p>This case study covers how a new account moved from random posting to a stable weekly pipeline.</p><h3>Background</h3><p>Topics were scattered and tone shifted post to post.</p><h3>Approach</h3><p>We standardized topic framing, writing structure, and daily review metrics.</p><h3>Result</h3><p>Output became consistent and engagement improved week over week.</p><blockquote>Reliable systems beat occasional viral hits.</blockquote>"
    ]
  }
];

type AiRewritePreset =
  | "fix_grammar"
  | "improve_writing"
  | "punchier"
  | "condense"
  | "rephrase"
  | "expand"
  | "structure"
  | "positive"
  | "thread_start"
  | "emoji"
  | "announcement";

const AI_PRESETS: Array<{ id: AiRewritePreset; label: string }> = [
  { id: "fix_grammar", label: "Fix grammar" },
  { id: "improve_writing", label: "Improve writing" },
  { id: "punchier", label: "Make it punchier" },
  { id: "condense", label: "Condense" },
  { id: "rephrase", label: "Rephrase / Mix it up" },
  { id: "expand", label: "Expand & Elaborate" },
  { id: "structure", label: "Improve structure & spacing" },
  { id: "positive", label: "Rewrite in a positive tone" },
  { id: "thread_start", label: "Rewrite as thread start" },
  { id: "emoji", label: "Add emoji" },
  { id: "announcement", label: "Rewrite as announcement" }
];

const X_WHO_TO_FOLLOW = [
  { name: "MangoType", handle: "@mangotype", initials: "M", avatarBg: "#FFE8BF", avatarFg: "#C26D00" },
  { name: "Fabrizio Rinaldi", handle: "@linuz90", initials: "F", avatarBg: "#EDE9FF", avatarFg: "#6D28D9" },
  { name: "Francesco Di Lorenzo", handle: "@frankdilo", initials: "F", avatarBg: "#D1FAE5", avatarFg: "#047857" },
  { name: "Rajat Kapoor", handle: "@rajatkapoor", initials: "R", avatarBg: "#FEE2E2", avatarFg: "#B91C1C" },
  { name: "Thomas Chris", handle: "@tomchris", initials: "T", avatarBg: "#E0F2FE", avatarFg: "#0369A1" },
  { name: "Gaile", handle: "@gailemango", initials: "G", avatarBg: "#FCE7F3", avatarFg: "#BE185D" }
];

function draftKindLabel(kind: DraftKind, locale: UiLocale): string {
  if (locale === "zh") {
    if (kind === "tweet") {
      return "推文";
    }
    if (kind === "thread") {
      return "线程";
    }
    return "文章";
  }
  return DRAFT_KIND_LABELS[kind];
}

function draftOptionCopy(kind: DraftKind, locale: UiLocale): { title: string; description: string } {
  if (locale === "zh") {
    if (kind === "tweet") {
      return { title: "推文", description: "单条发布，280 字限制。" };
    }
    if (kind === "thread") {
      return { title: "线程", description: "多条连续发布，适合展开表达。" };
    }
    return { title: "文章", description: "长文编辑，支持主标题和副标题。" };
  }
  if (kind === "tweet") {
    return { title: "Tweet", description: "Single post, 280-char focused." };
  }
  if (kind === "thread") {
    return { title: "Thread", description: "Multi-post flow, same as current layout." };
  }
  return { title: "Article", description: "Long-form editor with title and subtitle styles." };
}

function themeLabel(theme: UiTheme, locale: UiLocale): string {
  if (locale === "zh") {
    if (theme === "signature") {
      return "经典";
    }
    if (theme === "ink") {
      return "墨色";
    }
    return "日落";
  }
  if (theme === "signature") {
    return "Signature";
  }
  if (theme === "ink") {
    return "Ink";
  }
  return "Sunset";
}

function normalizeTenorDims(value?: number[]): [number, number] | null {
  if (!value || value.length < 2) {
    return null;
  }
  const width = Number(value[0]);
  const height = Number(value[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return [width, height];
}

function mapTenorResults(items: TenorGifApiItem[]): TenorGifTile[] {
  return items
    .map((item) => {
      const media = item.media?.[0];
      const animated = media?.gif ?? media?.tinygif ?? media?.mediumgif ?? media?.nanogif;
      if (!animated?.url) {
        return null;
      }
      const previewUrl = media?.tinygif?.url ?? animated.preview ?? animated.url;
      const dims = normalizeTenorDims(animated.dims) ?? normalizeTenorDims(media?.tinygif?.dims) ?? [320, 320];
      return {
        id: item.id,
        title: (item.title || item.content_description || "Tenor GIF").trim(),
        gifUrl: animated.url,
        previewUrl,
        width: dims[0],
        height: dims[1]
      };
    })
    .filter((item): item is TenorGifTile => item !== null);
}

function mergeTenorResults(prev: TenorGifTile[], next: TenorGifTile[]): TenorGifTile[] {
  const seen = new Set(prev.map((item) => item.id));
  const merged = [...prev];
  next.forEach((item) => {
    if (seen.has(item.id)) {
      return;
    }
    seen.add(item.id);
    merged.push(item);
  });
  return merged;
}

function normalizeTopicLabel(value: string | undefined): string {
  if (!value) {
    return "";
  }
  return value.replace(/\s+/g, " ").trim().slice(0, 28);
}

function computeRetryTimeIso(fromIso: string, attempt: number): string {
  const retryMinutes = [2, 10, 30];
  const index = Math.max(0, Math.min(retryMinutes.length - 1, attempt - 1));
  const next = new Date(new Date(fromIso).getTime() + retryMinutes[index] * 60 * 1000);
  return next.toISOString();
}

function resolveXPublishErrorMessage(
  payload: XPublishResponse | null,
  fallbackStatus: number,
  locale: UiLocale
): string {
  const detail = payload?.details;
  const firstDetailError = detail?.errors?.find((item) => typeof item.message === "string")?.message;
  const bestMessage =
    payload?.message ??
    detail?.detail ??
    firstDetailError ??
    detail?.title ??
    payload?.error;

  if (bestMessage && bestMessage.trim().length > 0) {
    return bestMessage;
  }

  return locale === "zh"
    ? `发布失败（HTTP ${fallbackStatus}）。`
    : `Publishing failed (HTTP ${fallbackStatus}).`;
}

export function ComposeWorkbench() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(createDefaultWorkspaceState);
  const [paneTab, setPaneTab] = useState<PaneTab>("drafts");
  const [hydrated, setHydrated] = useState(false);
  const [notice, setNotice] = useState("");
  const [draftPickerOpen, setDraftPickerOpen] = useState(false);
  const [mediaMenuPostId, setMediaMenuPostId] = useState<string | null>(null);
  const [aiMenuPostId, setAiMenuPostId] = useState<string | null>(null);
  const [moreMenuPostId, setMoreMenuPostId] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [targetUploadPostId, setTargetUploadPostId] = useState<string | null>(null);
  const [publishState, setPublishState] = useState<PublishState>("idle");
  const [theme, setTheme] = useState<UiTheme>("signature");
  const [locale, setLocale] = useState<UiLocale>("en");
  const [workspaceSaveState, setWorkspaceSaveState] = useState<WorkspaceSaveState>("saved");
  const [workspaceLastSavedAt, setWorkspaceLastSavedAt] = useState<string | null>(null);
  const [topicFilter, setTopicFilter] = useState<string>(TOPIC_FILTER_ALL);
  const [newDraftTopic, setNewDraftTopic] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [templateLibraryOpen, setTemplateLibraryOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [gifPickerPostId, setGifPickerPostId] = useState<string | null>(null);
  const [gifQuery, setGifQuery] = useState("");
  const [gifResults, setGifResults] = useState<TenorGifTile[]>([]);
  const [gifNextPos, setGifNextPos] = useState<string | null>(null);
  const [gifLoading, setGifLoading] = useState(false);
  const [gifError, setGifError] = useState("");
  const [previewMobile, setPreviewMobile] = useState(false);
  const [draftHistory, setDraftHistory] = useState<Record<string, DraftSnapshot[]>>({});
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [authConfig, setAuthConfig] = useState({
    ready: true,
    hasAuthSecret: true,
    hasTwitterProvider: true,
    checked: false
  });
  const [selectionToolbar, setSelectionToolbar] = useState<{
    visible: boolean;
    x: number;
    y: number;
    postId: string | null;
  }>({
    visible: false,
    x: 0,
    y: 0,
    postId: null
  });
  const editorRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const commandRef = useRef<HTMLDivElement | null>(null);
  const templateRef = useRef<HTMLDivElement | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const shortcutRef = useRef<HTMLDivElement | null>(null);
  const gifSearchRef = useRef<HTMLInputElement | null>(null);
  const gifRequestRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { data: session, status: authStatus } = useSession();
  const t = (en: string, zh: string) => (locale === "zh" ? zh : en);
  const authReady = authConfig.ready;
  const authMissingHint =
    !authConfig.hasTwitterProvider && !authConfig.hasAuthSecret
      ? t("Set AUTH_TWITTER_ID / AUTH_TWITTER_SECRET and NEXTAUTH_SECRET.", "请配置 AUTH_TWITTER_ID / AUTH_TWITTER_SECRET 与 NEXTAUTH_SECRET。")
      : !authConfig.hasTwitterProvider
        ? t("Set AUTH_TWITTER_ID and AUTH_TWITTER_SECRET.", "请配置 AUTH_TWITTER_ID 与 AUTH_TWITTER_SECRET。")
        : !authConfig.hasAuthSecret
          ? t("Set NEXTAUTH_SECRET.", "请配置 NEXTAUTH_SECRET。")
          : "";
  const authorIdentity = useMemo(() => resolveAuthorIdentity(session), [session]);
  const profileSubtitle = authorIdentity.signedIn ? authorIdentity.handle : t("Workspace", "工作区");
  const tenorApiKey = (process.env.NEXT_PUBLIC_TENOR_API_KEY ?? TENOR_DEFAULT_KEY).trim() || TENOR_DEFAULT_KEY;

  useEffect(() => {
    let active = true;
    async function loadAuthConfig() {
      try {
        const response = await fetch("/api/auth/config-status", {
          method: "GET",
          cache: "no-store"
        });
        if (!response.ok) {
          throw new Error("auth-config-failed");
        }
        const payload = (await response.json()) as {
          ready?: boolean;
          hasAuthSecret?: boolean;
          hasTwitterProvider?: boolean;
        };
        if (!active) {
          return;
        }
        setAuthConfig({
          ready: Boolean(payload.ready),
          hasAuthSecret: Boolean(payload.hasAuthSecret),
          hasTwitterProvider: Boolean(payload.hasTwitterProvider),
          checked: true
        });
      } catch {
        if (!active) {
          return;
        }
        setAuthConfig((prev) => ({
          ...prev,
          ready: false,
          checked: true
        }));
      }
    }
    void loadAuthConfig();
    return () => {
      active = false;
    };
  }, []);

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
  }, []);

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
  }, [hydrated, workspace]);

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

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = window.setTimeout(() => setNotice(""), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (publishState === "idle" || publishState === "scheduling" || publishState === "publishing") {
      return;
    }
    const timer = window.setTimeout(() => setPublishState("idle"), 1800);
    return () => window.clearTimeout(timer);
  }, [publishState]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    void runDueJobs({ silent: true });
    const timer = window.setInterval(() => {
      void runDueJobs({ silent: true });
    }, 25000);
    return () => window.clearInterval(timer);
  }, [hydrated, workspace.queue]);

  useEffect(() => {
    if (!draftPickerOpen) {
      return;
    }
    function onClick(event: MouseEvent) {
      if (!pickerRef.current) {
        return;
      }
      if (event.target instanceof Node && !pickerRef.current.contains(event.target)) {
        setDraftPickerOpen(false);
      }
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [draftPickerOpen]);

  useEffect(() => {
    if (!commandOpen) {
      return;
    }
    function onClick(event: MouseEvent) {
      if (!(event.target instanceof HTMLElement)) {
        return;
      }
      if (event.target.closest("[data-command-trigger='1']")) {
        return;
      }
      if (commandRef.current?.contains(event.target)) {
        return;
      }
      setCommandOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [commandOpen]);

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
  }, [gifPickerOpen, gifQuery, locale]);

  useEffect(() => {
    function onGlobalClick(event: MouseEvent) {
      if (!(event.target instanceof HTMLElement)) {
        return;
      }
      if (!event.target.closest(".tf-post-tools")) {
        setMediaMenuPostId(null);
        setAiMenuPostId(null);
        setMoreMenuPostId(null);
      }
    }
    window.addEventListener("mousedown", onGlobalClick);
    return () => window.removeEventListener("mousedown", onGlobalClick);
  }, []);

  useEffect(() => {
    function onEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      setMediaMenuPostId(null);
      setAiMenuPostId(null);
      setMoreMenuPostId(null);
      setDraftPickerOpen(false);
      setCommandOpen(false);
      setCommandQuery("");
      setTemplateLibraryOpen(false);
      setHistoryOpen(false);
      setShortcutsOpen(false);
      closeGifPicker();
      setSelectionToolbar((prev) => ({ ...prev, visible: false, postId: null }));
    }
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, []);

  useEffect(() => {
    function onGlobalShortcuts(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      const withMod = event.ctrlKey || event.metaKey;

      if (withMod && key === "k") {
        event.preventDefault();
        setCommandOpen(true);
        return;
      }
      if (withMod && (key === "/" || key === "?")) {
        event.preventDefault();
        setSidebarCollapsed((prev) => !prev);
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
        const activeDraft =
          workspace.drafts.find((item) => item.id === workspace.selectedDraftId) ??
          workspace.drafts[0];
        if (!activeDraft) {
          return;
        }
        addDraftSnapshot(activeDraft, "Manual", "manual");
        setNotice(t("Version snapshot saved.", "版本快照已保存。"));
      }
    }
    window.addEventListener("keydown", onGlobalShortcuts);
    return () => window.removeEventListener("keydown", onGlobalShortcuts);
  }, [locale, workspace.activeView, workspace.drafts, workspace.selectedDraftId]);

  useEffect(() => {
    if (sidebarCollapsed && commandOpen) {
      setCommandOpen(false);
      setCommandQuery("");
    }
  }, [sidebarCollapsed, commandOpen]);

  const currentDraft =
    workspace.drafts.find((item) => item.id === workspace.selectedDraftId) ??
    workspace.drafts[0];

  const currentPost = currentDraft
    ? currentDraft.posts.find((post) => post.id === currentDraft.selectedPostId) ??
      currentDraft.posts[0]
    : undefined;

  const previewEnabled = !!currentDraft && currentDraft.kind !== "article";
  const threadPreview = currentDraft?.kind === "thread";
  const localizedDraftOptions = useMemo(
    () =>
      DRAFT_OPTIONS.map((option) => ({
        ...option,
        ...draftOptionCopy(option.kind, locale)
      })),
    [locale]
  );
  const localizedAiPresets = useMemo(() => {
    if (locale !== "zh") {
      return AI_PRESETS;
    }
    return AI_PRESETS.map((preset) => {
      const zhLabelMap: Record<AiRewritePreset, string> = {
        fix_grammar: "修正语法",
        improve_writing: "优化表达",
        punchier: "更有力度",
        condense: "精简内容",
        rephrase: "改写 / 换表达",
        expand: "扩展展开",
        structure: "优化结构与间距",
        positive: "改成积极语气",
        thread_start: "改成线程开头",
        emoji: "添加 Emoji",
        announcement: "改成公告语气"
      };
      return {
        ...preset,
        label: zhLabelMap[preset.id]
      };
    });
  }, [locale]);

  const articleHeading = useMemo(() => {
    if (!currentDraft || currentDraft.kind !== "article" || !currentPost) {
      return { title: "", subtitle: "" };
    }
    return extractArticleHeading(currentPost.text);
  }, [currentDraft, currentPost]);

  useEffect(() => {
    if (paneTab !== "drafts" || workspace.activeView !== "compose") {
      setSelectionToolbar((prev) => ({ ...prev, visible: false, postId: null }));
      return;
    }

    function resolveSelectionToolbar() {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        setSelectionToolbar((prev) => ({ ...prev, visible: false, postId: null }));
        return;
      }

      const range = selection.getRangeAt(0);
      const anchorNode = range.commonAncestorContainer;
      const matchedEntry = Object.entries(editorRefs.current).find(
        ([, element]) => !!element && element.contains(anchorNode)
      );

      if (!matchedEntry) {
        setSelectionToolbar((prev) => ({ ...prev, visible: false, postId: null }));
        return;
      }

      const [postId] = matchedEntry;
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setSelectionToolbar((prev) => ({ ...prev, visible: false, postId: null }));
        return;
      }

      setSelectionToolbar({
        visible: true,
        x: rect.left + rect.width / 2,
        y: rect.top - 10,
        postId
      });

      if (currentDraft?.selectedPostId !== postId) {
        selectPost(postId);
      }
    }

    document.addEventListener("selectionchange", resolveSelectionToolbar);
    window.addEventListener("resize", resolveSelectionToolbar);
    window.addEventListener("scroll", resolveSelectionToolbar, true);
    return () => {
      document.removeEventListener("selectionchange", resolveSelectionToolbar);
      window.removeEventListener("resize", resolveSelectionToolbar);
      window.removeEventListener("scroll", resolveSelectionToolbar, true);
    };
  }, [paneTab, workspace.activeView, currentDraft?.selectedPostId]);

  useEffect(() => {
    if (workspace.activeView !== "preview") {
      return;
    }
    if (!currentDraft || currentDraft.kind !== "article") {
      return;
    }
    updateWorkspace((prev) => ({
      ...prev,
      activeView: "compose"
    }));
    setNotice(t("Article preview is not supported yet.", "文章暂不支持预览。"));
  }, [workspace.activeView, currentDraft?.id, currentDraft?.kind]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (paneTab !== "drafts" || workspace.activeView !== "compose" || !currentDraft || !currentPost) {
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
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentDraft, currentPost, paneTab, workspace.activeView]);

  const whitelistTerms = useMemo(
    () => parseWhitelistInput(workspace.whitelistInput),
    [workspace.whitelistInput]
  );

  const allPosts = useMemo(
    () => workspace.drafts.flatMap((draft) => draft.posts),
    [workspace.drafts]
  );

  const tweetOutputByPost = useMemo(() => {
    return allPosts.reduce<Record<string, string>>((acc, post) => {
      acc[post.id] = toTweetText(post.text, workspace.tweetFormatMode);
      return acc;
    }, {});
  }, [allPosts, workspace.tweetFormatMode]);

  const countByPost = useMemo(() => {
    return allPosts.reduce<Record<string, ReturnType<typeof getXCount>>>((acc, post) => {
      acc[post.id] = getXCount(tweetOutputByPost[post.id] ?? "");
      return acc;
    }, {});
  }, [allPosts, tweetOutputByPost]);

  const issuesByPost = useMemo(() => {
    return allPosts.reduce<Record<string, RuleIssue[]>>((acc, post) => {
      acc[post.id] = lintText(toLintText(post.text), workspace.ruleState, whitelistTerms);
      return acc;
    }, {});
  }, [allPosts, whitelistTerms, workspace.ruleState]);

  const selectedIssues = currentPost ? issuesByPost[currentPost.id] ?? [] : [];
  const selectedTweetOutput = currentPost ? tweetOutputByPost[currentPost.id] ?? "" : "";

  const currentDraftTweetText = useMemo(() => {
    if (!currentDraft) {
      return "";
    }
    return currentDraft.posts
      .map((post) => tweetOutputByPost[post.id] ?? "")
      .filter((text) => text.trim().length > 0)
      .join("\n\n");
  }, [currentDraft, tweetOutputByPost]);

  const publishReady = currentDraft
    ? currentDraft.posts.every((post) => countByPost[post.id]?.valid)
    : false;

  const analytics = useMemo(() => computeAnalytics(workspace.published), [workspace.published]);

  const queueStats = useMemo(() => {
    const failed = workspace.queue.filter((item) => item.status === "failed").length;
    const pending = workspace.queue.length - failed;
    const waitingRetry = workspace.queue.filter(
      (item) => item.status === "failed" && !!item.nextRetryAt
    ).length;
    return {
      total: workspace.queue.length,
      pending,
      failed,
      waitingRetry
    };
  }, [workspace.queue]);

  const recentActivity = useMemo(() => workspace.activity.slice(0, 8), [workspace.activity]);

  const articlePlain = useMemo(() => {
    if (!currentDraft) {
      return "";
    }
    return toArticleDocument(currentDraft.posts.map((post) => post.text));
  }, [currentDraft]);

  const articleHtml = useMemo(() => {
    if (!currentDraft) {
      return "";
    }
    return toArticleHtmlDocument(currentDraft.posts.map((post) => post.text));
  }, [currentDraft]);

  const draftItems = useMemo(() => {
    return workspace.drafts.map((draft) => {
      const firstPreview =
        draft.posts
          .map((post) => toLintText(post.text).replace(/\s+/g, " ").trim())
          .find((value) => value.length > 0) ?? (locale === "zh" ? "空草稿" : "Empty draft");
      const issueCount = draft.posts.reduce(
        (sum, post) => sum + (issuesByPost[post.id]?.length ?? 0),
        0
      );
      const weightedChars = draft.posts.reduce(
        (sum, post) => sum + (countByPost[post.id]?.weightedLength ?? 0),
        0
      );
      const hardLimit = draft.kind === "article" ? 1800 : Math.max(280, draft.posts.length * 280);
      const usageRatio = Math.max(0, Math.min(1.35, weightedChars / hardLimit));
      const overLimit = draft.posts.some((post) => !(countByPost[post.id]?.valid ?? true));
      return {
        id: draft.id,
        kind: draft.kind,
        title: draft.title,
        topic: normalizeTopicLabel(draft.topic),
        preview: firstPreview.slice(0, 70),
        postCount: draft.posts.length,
        issueCount,
        updatedAt: draft.updatedAt,
        weightedChars,
        usageRatio,
        overLimit
      };
    });
  }, [countByPost, issuesByPost, locale, workspace.drafts]);

  const currentDraftSignature = useMemo(
    () => (currentDraft ? serializeDraftSignature(currentDraft) : ""),
    [currentDraft]
  );

  const topicFilterOptions = useMemo(() => {
    const grouped = new Map<string, number>();
    let untaggedCount = 0;
    draftItems.forEach((item) => {
      if (!item.topic) {
        untaggedCount += 1;
        return;
      }
      grouped.set(item.topic, (grouped.get(item.topic) ?? 0) + 1);
    });
    const sortedTopics = Array.from(grouped.entries()).sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return a[0].localeCompare(b[0], locale === "zh" ? "zh-Hans" : "en");
    });
    const options: Array<{ value: string; label: string; count: number }> = [
      {
        value: TOPIC_FILTER_ALL,
        label: locale === "zh" ? "全部话题" : "All topics",
        count: draftItems.length
      },
      ...sortedTopics.map(([topic, count]) => ({
        value: topic,
        label: topic,
        count
      }))
    ];
    if (untaggedCount > 0) {
      options.push({
        value: TOPIC_FILTER_UNTAGGED,
        label: locale === "zh" ? "未分组" : "Untagged",
        count: untaggedCount
      });
    }
    return options;
  }, [draftItems, locale]);

  const visibleDraftItems = useMemo(() => {
    if (topicFilter === TOPIC_FILTER_ALL) {
      return draftItems;
    }
    if (topicFilter === TOPIC_FILTER_UNTAGGED) {
      return draftItems.filter((item) => !item.topic);
    }
    return draftItems.filter((item) => item.topic === topicFilter);
  }, [draftItems, topicFilter]);

  const topicSuggestions = useMemo(() => {
    const fromFilters = topicFilterOptions
      .filter((option) => option.value !== TOPIC_FILTER_ALL && option.value !== TOPIC_FILTER_UNTAGGED)
      .map((option) => option.label);
    if (topicFilter !== TOPIC_FILTER_ALL && topicFilter !== TOPIC_FILTER_UNTAGGED) {
      const fromCurrent = normalizeTopicLabel(topicFilter);
      if (fromCurrent) {
        fromFilters.unshift(fromCurrent);
      }
    }
    return Array.from(new Set(fromFilters)).slice(0, 6);
  }, [topicFilter, topicFilterOptions]);

  const groupedDraftItems = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; label: string; items: Array<(typeof draftItems)[number]> }
    >();
    visibleDraftItems.forEach((item) => {
      const key = item.topic || TOPIC_FILTER_UNTAGGED;
      const label = item.topic || (locale === "zh" ? "未分组" : "Untagged");
      const existing = groups.get(key);
      if (existing) {
        existing.items.push(item);
        return;
      }
      groups.set(key, {
        key,
        label,
        items: [item]
      });
    });
    return Array.from(groups.values()).sort((a, b) => {
      const aUntagged = a.key === TOPIC_FILTER_UNTAGGED;
      const bUntagged = b.key === TOPIC_FILTER_UNTAGGED;
      if (aUntagged !== bUntagged) {
        return aUntagged ? 1 : -1;
      }
      if (b.items.length !== a.items.length) {
        return b.items.length - a.items.length;
      }
      return a.label.localeCompare(b.label, locale === "zh" ? "zh-Hans" : "en");
    });
  }, [draftItems, locale, visibleDraftItems]);

  const saveIndicator = useMemo(() => {
    const lastSaved = workspaceLastSavedAt ? formatSavedClock(workspaceLastSavedAt, locale) : "";
    if (workspaceSaveState === "saving") {
      return {
        label: t("Saving...", "保存中..."),
        detail: lastSaved ? t(`Last saved ${lastSaved}`, `上次保存 ${lastSaved}`) : ""
      };
    }
    if (workspaceSaveState === "failed") {
      return {
        label: t("Save failed", "保存失败"),
        detail: lastSaved ? t(`Last saved ${lastSaved}`, `上次保存 ${lastSaved}`) : ""
      };
    }
    return {
      label: t("Saved", "已保存"),
      detail: lastSaved ? t(`at ${lastSaved}`, `${lastSaved}`) : ""
    };
  }, [locale, t, workspaceLastSavedAt, workspaceSaveState]);

  const currentDraftHistory = currentDraft ? draftHistory[currentDraft.id] ?? [] : [];

  const previewTimelinePosts = useMemo(() => {
    if (!currentDraft) {
      return [];
    }
    return currentDraft.posts.map((post, index) => {
      const rawText =
        currentDraft.kind === "article" ? toLintText(post.text) : tweetOutputByPost[post.id] ?? "";
      const text = rawText.trim() || (locale === "zh" ? "（空）" : "(Empty)");
      const base = Math.max(1, Math.floor(text.length / 18));
      return {
        id: post.id,
        index,
        text,
        media: (post.media ?? []).map((item) => ({
          id: item.id,
          type: item.type,
          name: item.name,
          url: item.url
        })),
        replies: 2 + base,
        reposts: 5 + base * 2,
        likes: 20 + base * 5,
        views: 500 + base * 120
      };
    });
  }, [currentDraft, locale, tweetOutputByPost]);

  useEffect(() => {
    if (paneTab !== "drafts" && topicFilter !== TOPIC_FILTER_ALL) {
      setTopicFilter(TOPIC_FILTER_ALL);
      return;
    }
    if (topicFilter === TOPIC_FILTER_ALL) {
      return;
    }
    const validFilters = new Set(topicFilterOptions.map((item) => item.value));
    if (!validFilters.has(topicFilter)) {
      setTopicFilter(TOPIC_FILTER_ALL);
    }
  }, [paneTab, topicFilter, topicFilterOptions]);

  function addDraftSnapshot(
    draft: WorkspaceState["drafts"][number],
    label: string,
    mode: "manual" | "auto" = "manual"
  ) {
    const signature = serializeDraftSignature(draft);
    const nowIso = new Date().toISOString();
    const selectedPostId = draft.posts.some((post) => post.id === draft.selectedPostId)
      ? draft.selectedPostId
      : draft.posts[0]?.id ?? createId();
    const snapshotBase: Omit<DraftSnapshot, "id" | "createdAt" | "label"> = {
      draftId: draft.id,
      signature,
      kind: draft.kind,
      title: draft.title,
      topic: draft.topic,
      posts: clonePosts(draft.posts),
      selectedPostId
    };

    setDraftHistory((prev) => {
      const prevList = prev[draft.id] ?? [];
      const latest = prevList[0];
      const resolvedManualLabel =
        label === "Manual" ? nextManualSnapshotLabel(prevList) : label;
      const autoLabel = formatSnapshotTimestamp(nowIso);
      if (latest && latest.signature === signature) {
        if (mode === "manual") {
          const manualSnapshot: DraftSnapshot = {
            ...snapshotBase,
            id: createId(),
            createdAt: nowIso,
            label: resolvedManualLabel
          };
          return { ...prev, [draft.id]: [manualSnapshot, ...prevList].slice(0, 24) };
        }
        return prev;
      }

      if (mode === "auto" && latest) {
        const elapsed = Date.now() - new Date(latest.createdAt).getTime();
        if (elapsed < 45_000 && isTimestampSnapshotLabel(latest.label)) {
          const mergedTop: DraftSnapshot = {
            ...snapshotBase,
            id: latest.id,
            createdAt: nowIso,
            label: autoLabel
          };
          return { ...prev, [draft.id]: [mergedTop, ...prevList.slice(1)] };
        }
      }

      const snapshot: DraftSnapshot = {
        ...snapshotBase,
        id: createId(),
        createdAt: nowIso,
        label: mode === "auto" ? autoLabel : resolvedManualLabel
      };
      return { ...prev, [draft.id]: [snapshot, ...prevList].slice(0, 24) };
    });
  }

  function saveCurrentDraftSnapshot() {
    if (!currentDraft) {
      return;
    }
    addDraftSnapshot(currentDraft, "Manual", "manual");
    setNotice(t("Version snapshot saved.", "版本快照已保存。"));
  }

  function restoreDraftSnapshot(snapshotId: string) {
    if (!currentDraft) {
      return;
    }
    const target = (draftHistory[currentDraft.id] ?? []).find((item) => item.id === snapshotId);
    if (!target) {
      return;
    }
    updateWorkspace((prev) => {
      const nextDrafts = prev.drafts.map((draft) => {
        if (draft.id !== target.draftId) {
          return draft;
        }
        return {
          ...draft,
          kind: target.kind,
          title: target.title,
          topic: target.topic,
          posts: clonePosts(target.posts),
          selectedPostId: target.selectedPostId,
          updatedAt: new Date().toISOString()
        };
      });
      return {
        ...prev,
        drafts: nextDrafts,
        selectedDraftId: target.draftId,
        activeView: "compose"
      };
    });
    setPaneTab("drafts");
    setHistoryOpen(false);
    setNotice(t("Draft restored from version history.", "已从版本历史恢复草稿。"));
  }

  function removeDraftSnapshot(snapshotId: string) {
    if (!currentDraft) {
      return;
    }
    setDraftHistory((prev) => {
      const prevList = prev[currentDraft.id] ?? [];
      const nextList = prevList.filter((item) => item.id !== snapshotId);
      return { ...prev, [currentDraft.id]: nextList };
    });
  }

  function applyTemplate(template: DraftTemplate, mode: "replace" | "new") {
    const templatePosts = template.posts.map((text) => ({
      id: createId(),
      text: toRichHtml(text),
      media: []
    }));
    const selectedPostId = templatePosts[0]?.id ?? createId();

    if (mode === "replace" && currentDraft) {
      const replaced = {
        ...currentDraft,
        kind: template.kind,
        title: template.title,
        posts: templatePosts,
        selectedPostId,
        updatedAt: new Date().toISOString()
      };
      updateCurrentDraft(() => replaced);
      addDraftSnapshot(replaced, "Template", "manual");
      openComposeView("drafts");
      setTemplateLibraryOpen(false);
      setNotice(
        locale === "zh" ? `已应用模板：${template.name}。` : `Template applied: ${template.name}.`
      );
      return;
    }

    const fresh = createDraft(template.kind, {
      title: template.title,
      posts: templatePosts
    });
    updateWorkspace((prev) => ({
      ...prev,
      drafts: [fresh, ...prev.drafts],
      selectedDraftId: fresh.id,
      activeView: "compose"
    }));
    setPaneTab("drafts");
    addDraftSnapshot(fresh, "Template", "manual");
    setTemplateLibraryOpen(false);
    setNotice(
      locale === "zh" ? `已创建模板草稿：${template.name}。` : `Template created: ${template.name}.`
    );
  }

  useEffect(() => {
    if (!hydrated || !currentDraft) {
      return;
    }
    const timer = window.setTimeout(() => {
      addDraftSnapshot(currentDraft, "Autosave", "auto");
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [currentDraft?.id, currentDraftSignature, hydrated]);

  function updateWorkspace(updater: (prev: WorkspaceState) => WorkspaceState) {
    setWorkspace((prev) => normalizeWorkspaceState(updater(prev)));
  }

  function updateCurrentDraft(
    updater: (draft: WorkspaceState["drafts"][number]) => WorkspaceState["drafts"][number]
  ) {
    updateWorkspace((prev) => {
      const nextDrafts = prev.drafts.map((draft) => {
        if (draft.id !== prev.selectedDraftId) {
          return draft;
        }
        return {
          ...updater(draft),
          updatedAt: new Date().toISOString()
        };
      });
      return { ...prev, drafts: nextDrafts };
    });
  }

  function selectDraft(draftId: string) {
    updateWorkspace((prev) => ({
      ...prev,
      selectedDraftId: draftId,
      activeView: "compose"
    }));
  }

  function createNewDraft(kind: DraftKind, topicOverride?: string) {
    const normalizedOverride = normalizeTopicLabel(topicOverride);
    const seedTopic = normalizedOverride
      ? normalizedOverride
      : topicFilter !== TOPIC_FILTER_ALL && topicFilter !== TOPIC_FILTER_UNTAGGED
        ? normalizeTopicLabel(topicFilter)
        : undefined;
    const fresh = createDraft(kind, { topic: seedTopic });
    updateWorkspace((prev) => ({
      ...prev,
      drafts: [fresh, ...prev.drafts],
      selectedDraftId: fresh.id,
      activeView: "compose"
    }));
    setPaneTab("drafts");
    setDraftPickerOpen(false);
    setNewDraftTopic("");
    addDraftSnapshot(fresh, "Created", "manual");
    setNotice(
      locale === "zh"
        ? `已创建${draftKindLabel(kind, locale)}草稿${seedTopic ? `（${seedTopic}）` : ""}。`
        : `Created ${draftKindLabel(kind, locale)} draft${seedTopic ? ` in ${seedTopic}` : ""}.`
    );
  }

  function removeDraft(id: string) {
    updateWorkspace((prev) => {
      if (prev.drafts.length <= 1) {
        return prev;
      }
      const nextDrafts = prev.drafts.filter((draft) => draft.id !== id);
      const nextSelectedId = nextDrafts.some((draft) => draft.id === prev.selectedDraftId)
        ? prev.selectedDraftId
        : nextDrafts[0].id;
      return {
        ...prev,
        drafts: nextDrafts,
        selectedDraftId: nextSelectedId
      };
    });
    setDraftHistory((prev) => {
      if (!(id in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function updateDraftTitle(nextTitle: string) {
    updateCurrentDraft((draft) => ({
      ...draft,
      title: nextTitle
    }));
  }

  function updateDraftTopic(nextTopic: string, commit = false) {
    const topic = commit ? normalizeTopicLabel(nextTopic) : nextTopic.slice(0, 28);
    updateCurrentDraft((draft) => ({
      ...draft,
      topic: topic.length > 0 ? topic : undefined
    }));
  }

  function updatePostHtml(postId: string, html: string) {
    updateCurrentDraft((draft) => ({
      ...draft,
      posts: draft.posts.map((post) =>
        post.id === postId ? { ...post, text: normalizeRichHtml(html) } : post
      )
    }));
  }

  function updateArticleHeadingField(field: "title" | "subtitle", value: string) {
    if (!currentDraft || currentDraft.kind !== "article" || !currentPost) {
      return;
    }

    const parsed = splitArticleBlocks(currentPost.text);
    const nextTitle = field === "title" ? value : parsed.title;
    const nextSubtitle = field === "subtitle" ? value : parsed.subtitle;
    const nextHtml = buildArticleHtml(nextTitle, nextSubtitle, parsed.bodyHtml);
    updatePostHtml(currentPost.id, nextHtml);
  }

  function selectPost(postId: string) {
    updateCurrentDraft((draft) => ({
      ...draft,
      selectedPostId: postId
    }));
  }

  function insertPostBelow(postId: string) {
    if (!currentDraft || currentDraft.kind !== "thread") {
      return;
    }
    const nextPost = { id: createId(), text: "<p><br></p>", media: [] };
    updateCurrentDraft((draft) => {
      const index = draft.posts.findIndex((post) => post.id === postId);
      const insertAt = index >= 0 ? index + 1 : draft.posts.length;
      const posts = [...draft.posts];
      posts.splice(insertAt, 0, nextPost);
      return {
        ...draft,
        posts,
        selectedPostId: nextPost.id
      };
    });
    setNotice(t("Added post below.", "已在下方新增一条。"));
  }

  function addPostToThread() {
    if (!currentPost) {
      return;
    }
    insertPostBelow(currentPost.id);
  }

  function removePostFromThread(postId: string) {
    if (!currentDraft || currentDraft.kind !== "thread") {
      return;
    }
    updateCurrentDraft((draft) => {
      if (draft.posts.length <= 1) {
        return draft;
      }
      const posts = draft.posts.filter((post) => post.id !== postId);
      const selectedPostId = posts.some((post) => post.id === draft.selectedPostId)
        ? draft.selectedPostId
        : posts[0].id;
      return { ...draft, posts, selectedPostId };
    });
    setNotice(t("Post deleted.", "已删除该条。"));
  }

  function movePostDown(postId: string) {
    if (!currentDraft || currentDraft.kind !== "thread") {
      return;
    }
    updateCurrentDraft((draft) => {
      const index = draft.posts.findIndex((post) => post.id === postId);
      if (index < 0 || index >= draft.posts.length - 1) {
        return draft;
      }
      const posts = [...draft.posts];
      const next = posts[index + 1];
      posts[index + 1] = posts[index];
      posts[index] = next;
      return {
        ...draft,
        posts
      };
    });
    setNotice(t("Moved post down.", "已下移该条。"));
  }

  function addPollToPost(postId: string) {
    updateCurrentDraft((draft) => ({
      ...draft,
      posts: draft.posts.map((post) =>
        post.id === postId
          ? {
              ...post,
              poll: post.poll
                ? undefined
                : {
                    question: "What do you think?",
                    options: ["Option 1", "Option 2"]
                  }
            }
          : post
      )
    }));
    setNotice(t("Poll toggled.", "已切换投票。"));
  }

  function openUploadForPost(postId: string) {
    setTargetUploadPostId(postId);
    setMediaMenuPostId(postId);
    fileInputRef.current?.click();
  }

  function closeGifPicker() {
    gifRequestRef.current += 1;
    setGifPickerOpen(false);
    setGifPickerPostId(null);
    setGifQuery("");
    setGifResults([]);
    setGifNextPos(null);
    setGifError("");
    setGifLoading(false);
  }

  function openGifPicker(postId: string) {
    setMediaMenuPostId(null);
    setAiMenuPostId(null);
    setMoreMenuPostId(null);
    setGifPickerPostId(postId);
    setGifPickerOpen(true);
    setGifQuery("");
    setGifResults([]);
    setGifNextPos(null);
    setGifError("");
  }

  async function fetchTenorGifs(options: { query: string; append: boolean; pos?: string | null }) {
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
  }

  function insertGifToPost(postId: string, gif: TenorGifTile) {
    updateCurrentDraft((draft) => ({
      ...draft,
      posts: draft.posts.map((post) =>
        post.id === postId
          ? {
              ...post,
              media: [
                ...(post.media ?? []),
                {
                  id: createId(),
                  type: "gif",
                  name: gif.title,
                  url: gif.gifUrl
                }
              ]
            }
          : post
      )
    }));
    closeGifPicker();
    setNotice(t("GIF added.", "已添加 GIF。"));
  }

  function handleUploadChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const postId = targetUploadPostId;
    if (!postId || files.length === 0) {
      event.target.value = "";
      return;
    }
    const mediaItems = files.map((file) => ({
      id: createId(),
      type: file.type.startsWith("video/")
        ? ("video" as const)
        : file.type === "image/gif"
          ? ("gif" as const)
          : ("image" as const),
      name: file.name,
      url: URL.createObjectURL(file)
    }));
    updateCurrentDraft((draft) => ({
      ...draft,
      posts: draft.posts.map((post) =>
        post.id === postId
          ? {
              ...post,
              media: [
                ...(post.media ?? []),
                ...mediaItems
              ]
            }
          : post
      )
    }));
    setTargetUploadPostId(null);
    setMediaMenuPostId(null);
    event.target.value = "";
    setNotice(
      locale === "zh"
        ? `已附加 ${files.length} 个文件。`
        : `Attached ${files.length} file${files.length > 1 ? "s" : ""}.`
    );
  }

  function removeMedia(postId: string, mediaId: string) {
    const targetMedia = currentDraft?.posts
      .find((post) => post.id === postId)
      ?.media?.find((media) => media.id === mediaId);
    if (targetMedia?.url?.startsWith("blob:")) {
      URL.revokeObjectURL(targetMedia.url);
    }
    updateCurrentDraft((draft) => ({
      ...draft,
      posts: draft.posts.map((post) =>
        post.id === postId
          ? {
              ...post,
              media: (post.media ?? []).filter((media) => media.id !== mediaId)
            }
          : post
      )
    }));
  }

  function getEditorForPost(postId: string): HTMLDivElement | null {
    return editorRefs.current[postId] ?? null;
  }

  function getCurrentEditor(): HTMLDivElement | null {
    if (!currentPost) {
      return null;
    }
    return getEditorForPost(currentPost.id);
  }

  function applyInline(command: "bold" | "italic", targetPostId?: string) {
    const postId = targetPostId ?? currentPost?.id;
    const editor = postId ? getEditorForPost(postId) : null;
    if (!editor || !postId) {
      setNotice(t("Focus an editor first.", "请先聚焦编辑器。"));
      return;
    }
    editor.focus();
    document.execCommand(command, false);
    updatePostHtml(postId, editor.innerHTML);
  }

  function applyBlock(type: "h1" | "h2" | "h3" | "blockquote" | "ul", targetPostId?: string) {
    if (!currentDraft) {
      return;
    }
    const postId = targetPostId ?? currentPost?.id;
    if (!postId) {
      return;
    }
    if ((type === "h1" || type === "h2" || type === "h3") && currentDraft.kind !== "article") {
      setNotice(t("Headings are available in Article drafts.", "仅文章草稿可使用标题。"));
      return;
    }
    const editor = getEditorForPost(postId);
    if (!editor) {
      setNotice(t("Focus an editor first.", "请先聚焦编辑器。"));
      return;
    }
    editor.focus();
    if (type === "ul") {
      document.execCommand("insertUnorderedList", false);
    } else if (type === "blockquote") {
      document.execCommand("formatBlock", false, "BLOCKQUOTE");
    } else {
      document.execCommand("formatBlock", false, type.toUpperCase());
    }
    updatePostHtml(postId, editor.innerHTML);
  }

  function applyAllFixesToCurrentDraft() {
    if (!currentDraft) {
      return;
    }
    updateCurrentDraft((draft) => ({
      ...draft,
      posts: draft.posts.map((post) => ({
        ...post,
        text: toRichHtml(applyAllFixes(toLintText(post.text), workspace.ruleState, whitelistTerms))
      }))
    }));
    setNotice(t("Applied spacing and punctuation fixes.", "已应用间距与标点修复。"));
  }

  function applySingleFixForPost(postId: string, issue: RuleIssue) {
    const targetPost = currentDraft?.posts.find((post) => post.id === postId);
    if (!targetPost) {
      return;
    }
    const lintSource = toLintText(targetPost.text);
    const fixed = applyRuleFix(lintSource, issue.ruleId, whitelistTerms);
    if (fixed === lintSource) {
      setNotice(t("No auto-fix change for this issue.", "该问题当前没有可自动修复内容。"));
      return;
    }
    updatePostHtml(postId, toRichHtml(fixed));
    setNotice(locale === "zh" ? `${issue.ruleId} 已修复。` : `${issue.ruleId} fixed.`);
  }

  function applySingleFix(issue: RuleIssue) {
    if (!currentPost) {
      return;
    }
    applySingleFixForPost(currentPost.id, issue);
  }

  function rewriteByPreset(
    source: string,
    preset: AiRewritePreset,
    customPrompt?: string
  ): string {
    const input = source.trim();
    if (!input) {
      return source;
    }

    if (customPrompt) {
      const prompt = customPrompt.toLowerCase();
      if (prompt.includes("grammar")) {
        return rewriteByPreset(input, "fix_grammar");
      }
      if (prompt.includes("condense") || prompt.includes("short")) {
        return rewriteByPreset(input, "condense");
      }
      if (prompt.includes("emoji")) {
        return rewriteByPreset(input, "emoji");
      }
      return `${input}\n\n${customPrompt}`;
    }

    if (preset === "fix_grammar") {
      return applyAllFixes(input, workspace.ruleState, whitelistTerms);
    }
    if (preset === "improve_writing") {
      return input
        .replace(/\bvery\b/gi, "really")
        .replace(/\s{2,}/g, " ")
        .replace(/([.!?。！？])\s*/g, "$1 ");
    }
    if (preset === "punchier") {
      return input
        .replace(/\bmaybe\b/gi, "")
        .replace(/\bjust\b/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    }
    if (preset === "condense") {
      const sentences = input
        .split(/(?<=[.!?。！？])/)
        .map((item) => item.trim())
        .filter(Boolean);
      if (sentences.length <= 1) {
        return input.length > 160 ? `${input.slice(0, 157).trim()}...` : input;
      }
      return sentences.slice(0, Math.max(1, Math.ceil(sentences.length * 0.65))).join(" ");
    }
    if (preset === "rephrase") {
      return input
        .replace(/\bbut\b/gi, "yet")
        .replace(/\band\b/gi, "plus");
    }
    if (preset === "expand") {
      return `${input}\n\nAdditionally, include one practical example to make the point concrete.`;
    }
    if (preset === "structure") {
      return input
        .replace(/[;；]\s*/g, ";\n")
        .replace(/:\s*/g, ":\n")
        .replace(/\n{3,}/g, "\n\n");
    }
    if (preset === "positive") {
      return input
        .replace(/problem/gi, "opportunity")
        .replace(/difficult/gi, "challenging but solvable");
    }
    if (preset === "thread_start") {
      return `Thread start: ${input}`;
    }
    if (preset === "emoji") {
      return `${input} ✨`;
    }
    if (preset === "announcement") {
      return `Announcement:\n${input}`;
    }
    return input;
  }

  function applyAiRewrite(postId: string, preset: AiRewritePreset, customPrompt?: string) {
    const targetPost = currentDraft?.posts.find((post) => post.id === postId);
    if (!targetPost) {
      return;
    }
    const editor = getEditorForPost(postId);
    const selection = window.getSelection();
    const hasSelection =
      !!editor &&
      !!selection &&
      selection.rangeCount > 0 &&
      !selection.isCollapsed &&
      editor.contains(selection.getRangeAt(0).commonAncestorContainer);

    if (editor && hasSelection) {
      editor.focus();
      const selectedText = selection?.toString() ?? "";
      const rewrittenSelection = rewriteByPreset(selectedText, preset, customPrompt);
      document.execCommand("insertText", false, rewrittenSelection);
      updatePostHtml(postId, editor.innerHTML);
    } else {
      const fullText = toLintText(targetPost.text);
      const rewritten = rewriteByPreset(fullText, preset, customPrompt);
      updatePostHtml(postId, toRichHtml(rewritten));
    }

    setAiMenuPostId(null);
    setAiPrompt("");
    setNotice(t("Rewrite applied.", "已应用改写。"));
  }

  function applyCustomAiPrompt(postId: string) {
    const prompt = aiPrompt.trim();
    if (!prompt) {
      return;
    }
    applyAiRewrite(postId, "improve_writing", prompt);
  }

  function prepareCurrentDraftForPublish() {
    if (!currentDraft) {
      return [];
    }
    return currentDraft.posts.map((post) => ({
      ...post,
      text: toTweetText(post.text, workspace.tweetFormatMode)
    }));
  }

  async function publishPostsToX(posts: WorkspaceState["drafts"][number]["posts"]) {
    const publishablePosts = posts
      .map((post) => ({
        ...post,
        text: post.text.trim()
      }))
      .filter((post) => post.text.length > 0);

    if (publishablePosts.length === 0) {
      throw new Error(t("No publishable text in this draft.", "当前草稿没有可发布内容。"));
    }

    const tweetIds: string[] = [];
    let replyToId: string | undefined;

    for (const post of publishablePosts) {
      const response = await fetch("/api/x/tweets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text: post.text,
          replyToId
        })
      });

      let payload: XPublishResponse | null = null;
      try {
        payload = (await response.json()) as XPublishResponse;
      } catch {
        payload = null;
      }

      if (!response.ok) {
        throw new Error(resolveXPublishErrorMessage(payload, response.status, locale));
      }

      const tweetId = payload?.data?.id;
      if (typeof tweetId !== "string" || !tweetId.trim()) {
        throw new Error(
          t(
            "Publishing failed: X API did not return tweet id.",
            "发布失败：X API 未返回推文 ID。"
          )
        );
      }

      const normalizedTweetId = tweetId.trim();
      tweetIds.push(normalizedTweetId);
      replyToId = normalizedTweetId;
    }

    return tweetIds;
  }

  function queueCurrentDraft() {
    if (!currentDraft) {
      return;
    }
    if (!publishReady) {
      setPublishState("blocked");
      setNotice(t("One or more posts exceed 280 chars.", "有内容超过 280 字符限制。"));
      return;
    }
    setPublishState("scheduling");
    const prepared = prepareCurrentDraftForPublish();
    const item = buildQueueItem(prepared, workspace.scheduleAt, {
      sourceDraftId: currentDraft.id,
      draftKind: currentDraft.kind
    });
    updateWorkspace((prev) => ({
      ...prev,
      queue: [item, ...prev.queue].sort(sortQueueAsc),
      activity: appendActivityLogs(prev.activity, [
        createActivityLog({
          level: "info",
          event: "queue_scheduled",
          message:
            locale === "zh"
              ? `${draftKindLabel(currentDraft.kind, locale)}已排程到 ${formatDateTime(item.publishAt)}。`
              : `${draftKindLabel(currentDraft.kind, locale)} scheduled for ${formatDateTime(item.publishAt)}.`,
          queueItemId: item.id,
          draftId: currentDraft.id
        })
      ])
    }));
    setPublishState("scheduled");
    setNotice(
      locale === "zh"
        ? `已将${draftKindLabel(currentDraft.kind, locale)}加入排程。`
        : `Added ${draftKindLabel(currentDraft.kind, locale)} to schedule.`
    );
  }

  async function publishCurrentDraft() {
    if (!currentDraft) {
      return;
    }
    if (authStatus !== "authenticated") {
      setPublishState("blocked");
      setNotice(t("Sign in with X before publishing.", "发布前请先登录 X 账号。"));
      return;
    }
    if (!publishReady) {
      setPublishState("blocked");
      setNotice(t("One or more posts exceed 280 chars.", "有内容超过 280 字符限制。"));
      return;
    }
    setPublishState("publishing");
    const prepared = prepareCurrentDraftForPublish();
    const draftId = currentDraft.id;
    const draftKind = currentDraft.kind;
    try {
      await publishPostsToX(prepared);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t("Publishing failed. Please try again.", "发布失败，请稍后重试。");
      updateWorkspace((prev) => ({
        ...prev,
        activity: appendActivityLogs(prev.activity, [
          createActivityLog({
            level: "error",
            event: "manual_publish_failed",
            message:
              locale === "zh" ? `手动发布失败：${message}` : `Manual publish failed: ${message}`,
            draftId
          })
        ])
      }));
      setPublishState("blocked");
      setNotice(message);
      return;
    }
    const queueItem = buildQueueItem(prepared, new Date().toISOString(), {
      sourceDraftId: draftId,
      draftKind
    });
    const published = publishQueueItem(queueItem);
    updateWorkspace((prev) => ({
      ...prev,
      published: [published, ...prev.published].sort(sortPublishedDesc),
      activity: appendActivityLogs(prev.activity, [
        createActivityLog({
          level: "info",
          event: "manual_publish",
          message:
            locale === "zh"
              ? `${draftKindLabel(draftKind, locale)}已手动发布。`
              : `${draftKindLabel(draftKind, locale)} published manually.`,
          queueItemId: queueItem.id,
          draftId
        })
      ])
    }));
    setPaneTab("posted");
    setPublishState("published");
    setNotice(
      locale === "zh" ? `${draftKindLabel(draftKind, locale)}已发布。` : `Published ${draftKindLabel(draftKind, locale)}.`
    );
  }

  async function runDueJobs(options?: { silent?: boolean }) {
    const now = Date.now();
    const dueItems = workspace.queue
      .filter((item) => {
        const isPendingDue = item.status === "pending" && new Date(item.publishAt).getTime() <= now;
        const isRetryDue =
          item.status === "failed" &&
          !!item.nextRetryAt &&
          new Date(item.nextRetryAt).getTime() <= now &&
          item.attemptCount < item.maxAttempts;
        return isPendingDue || isRetryDue;
      })
      .sort(sortQueueAsc);

    if (dueItems.length === 0) {
      if (!options?.silent) {
        setNotice(t("No due items right now.", "当前没有到期任务。"));
      }
      return;
    }

    if (authStatus !== "authenticated") {
      if (!options?.silent) {
        setNotice(t("Sign in with X before running queue.", "执行队列前请先登录 X 账号。"));
      }
      return;
    }

    let succeeded = 0;
    let failed = 0;
    const publishedItems: WorkspaceState["published"] = [];
    const failedById = new Map<string, WorkspaceState["queue"][number]>();
    const succeededIds = new Set<string>();
    const activityLogs: WorkspaceState["activity"] = [];

    for (const item of dueItems) {
      const nowIso = new Date().toISOString();
      const nextAttempt = item.attemptCount + 1;
      const attemptedItem = {
        ...item,
        attemptCount: nextAttempt,
        lastAttemptAt: nowIso,
        updatedAt: nowIso
      };

      try {
        await publishPostsToX(item.posts);
        succeeded += 1;
        succeededIds.add(item.id);
        publishedItems.push(publishQueueItem(attemptedItem));
        activityLogs.push(
          createActivityLog({
            level: "info",
            event: "queue_publish_succeeded",
            message:
              locale === "zh"
                ? `已发布排程${draftKindLabel(item.draftKind ?? "thread", locale)}（${item.preview.slice(0, 36)}）。`
                : `Published scheduled ${draftKindLabel(item.draftKind ?? "thread", locale).toLowerCase()} (${item.preview.slice(0, 36)}).`,
            queueItemId: item.id,
            draftId: item.sourceDraftId
          })
        );
      } catch (error) {
        failed += 1;
        const errorMessage =
          error instanceof Error
            ? error.message
            : t("Publishing failed. Please try again.", "发布失败，请稍后重试。");
        const retriesRemaining = nextAttempt < item.maxAttempts;
        const retryAt = retriesRemaining ? computeRetryTimeIso(nowIso, nextAttempt) : undefined;
        failedById.set(item.id, {
          ...attemptedItem,
          status: "failed",
          nextRetryAt: retryAt,
          lastError: errorMessage
        });
        activityLogs.push(
          createActivityLog({
            level: retriesRemaining ? "warn" : "error",
            event: retriesRemaining ? "queue_retry_scheduled" : "queue_retry_exhausted",
            message: retriesRemaining
              ? locale === "zh"
                ? `发布失败，将在 ${formatDateTime(retryAt as string)} 重试。`
                : `Publish failed, retry at ${formatDateTime(retryAt as string)}.`
              : locale === "zh"
                ? `发布失败，已达到最大重试次数。`
                : `Publish failed after ${nextAttempt} attempts.`,
            queueItemId: item.id,
            draftId: item.sourceDraftId
          })
        );
      }
    }

    updateWorkspace((prev) => ({
      ...prev,
      queue: prev.queue
        .filter((item) => !succeededIds.has(item.id))
        .map((item) => failedById.get(item.id) ?? item)
        .sort(sortQueueAsc),
      published: [...publishedItems, ...prev.published].sort(sortPublishedDesc),
      activity: appendActivityLogs(prev.activity, activityLogs)
    }));

    if (!options?.silent) {
      if (failed > 0) {
        setNotice(
          locale === "zh"
            ? `队列执行：成功 ${succeeded}，失败 ${failed}。`
            : `Queue run: ${succeeded} succeeded, ${failed} failed.`
        );
      } else {
        setNotice(
          locale === "zh" ? `已执行 ${succeeded} 个到期任务。` : `Executed ${succeeded} due items.`
        );
      }
    }
  }

  async function publishScheduledItem(id: string) {
    const target = workspace.queue.find((item) => item.id === id);
    if (!target) {
      return;
    }

    if (authStatus !== "authenticated") {
      setPublishState("blocked");
      setNotice(t("Sign in with X before publishing.", "发布前请先登录 X 账号。"));
      return;
    }

    setPublishState("publishing");
    const nowIso = new Date().toISOString();
    const nextAttempt = target.attemptCount + 1;
    const attemptedItem = {
      ...target,
      attemptCount: nextAttempt,
      lastAttemptAt: nowIso,
      updatedAt: nowIso
    };

    try {
      await publishPostsToX(target.posts);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : t("Publishing failed. Please try again.", "发布失败，请稍后重试。");
      const retriesRemaining = nextAttempt < target.maxAttempts;
      const retryAt = retriesRemaining ? computeRetryTimeIso(nowIso, nextAttempt) : undefined;

      updateWorkspace((prev) => ({
        ...prev,
        queue: prev.queue
          .map((item) =>
            item.id === id
              ? {
                  ...attemptedItem,
                  status: "failed" as const,
                  nextRetryAt: retryAt,
                  lastError: errorMessage
                }
              : item
          )
          .sort(sortQueueAsc),
        activity: appendActivityLogs(prev.activity, [
          createActivityLog({
            level: retriesRemaining ? "warn" : "error",
            event: retriesRemaining ? "queue_retry_scheduled" : "queue_retry_exhausted",
            message: retriesRemaining
              ? locale === "zh"
                ? `发布失败，将在 ${formatDateTime(retryAt as string)} 重试。`
                : `Publish failed, retry at ${formatDateTime(retryAt as string)}.`
              : locale === "zh"
                ? "发布失败，已达到最大重试次数。"
                : `Publish failed after ${nextAttempt} attempts.`,
            queueItemId: target.id,
            draftId: target.sourceDraftId
          })
        ])
      }));
      setPublishState("blocked");
      setNotice(errorMessage);
      return;
    }

    updateWorkspace((prev) => ({
      ...prev,
      queue: prev.queue.filter((item) => item.id !== id),
      published: [publishQueueItem(attemptedItem), ...prev.published].sort(sortPublishedDesc),
      activity: appendActivityLogs(prev.activity, [
        createActivityLog({
          level: "info",
          event: "manual_publish_from_queue",
          message:
            locale === "zh"
              ? `已手动发布排程内容（${target.preview.slice(0, 36)}）。`
              : `Scheduled item published manually (${target.preview.slice(0, 36)}).`,
          queueItemId: target.id,
          draftId: target.sourceDraftId
        })
      ])
    }));
    setPaneTab("posted");
    setPublishState("published");
    setNotice(t("Scheduled item published.", "已发布排程内容。"));
  }

  function retryScheduledItem(id: string) {
    const target = workspace.queue.find((item) => item.id === id);
    if (!target) {
      return;
    }
    const retried = retryQueueItem(target);
    updateWorkspace((prev) => ({
      ...prev,
      queue: prev.queue.map((item) => (item.id === id ? retried : item)).sort(sortQueueAsc),
      activity: appendActivityLogs(prev.activity, [
        createActivityLog({
          level: "info",
          event: "manual_retry",
          message:
            locale === "zh"
              ? `已请求手动重试（${target.preview.slice(0, 36)}）。`
              : `Manual retry requested (${target.preview.slice(0, 36)}).`,
          queueItemId: target.id,
          draftId: target.sourceDraftId
        })
      ])
    }));
    setNotice(t("Retry queued. It will run on the next scheduler tick.", "已加入重试队列，将在下一次调度执行。"));
  }

  async function copyText(text: string, message: string) {
    const payload = text.trimEnd();
    if (!payload) {
      setNotice(t("Nothing to copy.", "没有可复制内容。"));
      return;
    }
    try {
      await navigator.clipboard.writeText(payload);
      setNotice(message);
    } catch {
      const temp = document.createElement("textarea");
      temp.value = payload;
      temp.style.position = "fixed";
      temp.style.left = "-9999px";
      document.body.appendChild(temp);
      temp.select();
      document.execCommand("copy");
      document.body.removeChild(temp);
      setNotice(message);
    }
  }

  async function copyArticle() {
    const plain = articlePlain.trimEnd();
    const html = articleHtml.trim();
    if (!plain) {
      setNotice(t("Nothing to copy.", "没有可复制内容。"));
      return;
    }
    if (
      typeof ClipboardItem !== "undefined" &&
      navigator.clipboard &&
      "write" in navigator.clipboard &&
      html
    ) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([plain], { type: "text/plain" }),
            "text/html": new Blob([html], { type: "text/html" })
          })
        ]);
        setNotice(t("Article copied with rich text.", "文章已复制（保留格式）。"));
        return;
      } catch {
        // fallback to plain text
      }
    }
    await copyText(plain, t("Article copied as plain text.", "文章已复制为纯文本。"));
  }

  async function copyByDraftType() {
    if (!currentDraft) {
      return;
    }
    if (currentDraft.kind === "article") {
      await copyArticle();
      return;
    }
    if (currentDraft.kind === "thread") {
      await copyText(currentDraftTweetText, t("Thread copied.", "线程已复制。"));
      return;
    }
    await copyText(selectedTweetOutput, t("Tweet copied.", "推文已复制。"));
  }

  function dismissOnboarding() {
    setShowOnboarding(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ONBOARDING_SEEN_KEY, "1");
    }
  }

  function openComposeView(nextTab: PaneTab = "drafts") {
    setPaneTab(nextTab);
    updateWorkspace((prev) => ({
      ...prev,
      activeView: "compose"
    }));
  }

  function openPreviewView() {
    if (!currentDraft || currentDraft.kind === "article") {
      setNotice(t("Article preview is not supported yet.", "文章暂不支持预览。"));
      return;
    }
    updateWorkspace((prev) => ({
      ...prev,
      activeView: "preview"
    }));
  }

  function togglePreviewView() {
    if (workspace.activeView !== "preview" && (!currentDraft || currentDraft.kind === "article")) {
      setNotice(t("Article preview is not supported yet.", "文章暂不支持预览。"));
      return;
    }
    updateWorkspace((prev) => ({
      ...prev,
      activeView: prev.activeView === "preview" ? "compose" : "preview"
    }));
  }

  function toggleSidebar() {
    setSidebarCollapsed((prev) => !prev);
  }

  function toggleCommandPalette() {
    setCommandOpen((prev) => !prev);
  }

  async function handleAuthAction() {
    if (authorIdentity.signedIn) {
      await signOut({ callbackUrl: "/" });
      return;
    }
    if (!authReady) {
      setNotice(
        authMissingHint ||
          t("X login is not configured yet. Check environment variables.", "X 登录尚未配置，请检查环境变量。")
      );
      return;
    }
    await signIn("twitter", { callbackUrl: "/" });
  }

  const quickCommands: QuickCommand[] = [
    {
      id: "new_tweet",
      label: t("New Tweet Draft", "新建推文草稿"),
      hint: "N T",
      keywords: locale === "zh" ? "新建 草稿 推文" : "new draft tweet",
      run: () => createNewDraft("tweet")
    },
    {
      id: "new_thread",
      label: t("New Thread Draft", "新建线程草稿"),
      hint: "N H",
      keywords: locale === "zh" ? "新建 草稿 线程" : "new draft thread",
      run: () => createNewDraft("thread")
    },
    {
      id: "new_article",
      label: t("New Article Draft", "新建文章草稿"),
      hint: "N A",
      keywords: locale === "zh" ? "新建 草稿 文章" : "new draft article",
      run: () => createNewDraft("article")
    },
    {
      id: "go_drafts",
      label: t("Go to Drafts", "进入草稿"),
      hint: "G D",
      keywords: locale === "zh" ? "草稿 写作 编辑" : "view drafts compose",
      run: () => openComposeView("drafts")
    },
    {
      id: "go_calendar",
      label: t("Open Calendar", "打开日历"),
      hint: "G C",
      keywords: locale === "zh" ? "日历 排程" : "calendar schedule",
      run: () =>
        updateWorkspace((prev) => ({
          ...prev,
          activeView: "calendar"
        }))
    },
    {
      id: "go_analytics",
      label: t("Open Analytics", "打开分析"),
      hint: "G A",
      keywords: locale === "zh" ? "分析 指标" : "analytics metrics",
      run: () =>
        updateWorkspace((prev) => ({
          ...prev,
          activeView: "analytics"
        }))
    },
    {
      id: "run_due_jobs",
      label: t("Run Due Jobs", "执行到期任务"),
      hint: "R J",
      keywords: locale === "zh" ? "队列 执行 到期 排程" : "queue run publish scheduled",
      run: runDueJobs
    },
    {
      id: "retry_failed_jobs",
      label: t("Retry Failed Items", "重试失败任务"),
      hint: "R F",
      keywords: locale === "zh" ? "队列 重试 失败" : "queue retry failed",
      run: () => {
        const failedItems = workspace.queue.filter((item) => item.status === "failed");
        if (failedItems.length === 0) {
          setNotice(t("No failed items to retry.", "没有可重试的失败任务。"));
          return;
        }
        updateWorkspace((prev) => ({
          ...prev,
          queue: prev.queue
            .map((item) => (item.status === "failed" ? retryQueueItem(item) : item))
            .sort(sortQueueAsc),
          activity: appendActivityLogs(prev.activity, [
            createActivityLog({
              level: "info",
              event: "bulk_retry",
              message:
                locale === "zh"
                  ? `已为 ${failedItems.length} 个失败任务发起手动重试。`
                  : `Manual retry for ${failedItems.length} failed item(s).`
            })
          ])
        }));
        setNotice(
          locale === "zh"
            ? `已加入 ${failedItems.length} 个重试任务。`
            : `Retry queued for ${failedItems.length} items.`
        );
      }
    },
    {
      id: "open_templates",
      label: t("Open Template Library", "打开模板库"),
      hint: "Ctrl Shift T",
      keywords: locale === "zh" ? "模板 库 创建" : "templates library create starter",
      run: () => setTemplateLibraryOpen(true)
    },
    {
      id: "save_snapshot",
      label: t("Save Version Snapshot", "保存版本快照"),
      hint: "Ctrl Shift V",
      keywords: locale === "zh" ? "历史 版本 快照 保存" : "history version snapshot save",
      run: saveCurrentDraftSnapshot
    },
    {
      id: "open_history",
      label: t("Open Version History", "打开版本历史"),
      hint: "V H",
      keywords: locale === "zh" ? "历史 版本 恢复 草稿" : "history versions restore draft",
      run: () => setHistoryOpen(true)
    },
    {
      id: "toggle_preview",
      label: workspace.activeView === "preview" ? t("Back to Editor", "返回编辑器") : t("Open Twitter Preview", "打开推特预览"),
      hint: "Ctrl Shift P",
      keywords: locale === "zh" ? "推特 预览" : "twitter preview",
      run: togglePreviewView
    },
    {
      id: "open_shortcuts",
      label: t("Open Shortcut Guide", "打开快捷键说明"),
      hint: "Ctrl Shift H",
      keywords: locale === "zh" ? "快捷键 帮助" : "shortcut keyboard hotkeys help",
      run: () => setShortcutsOpen(true)
    },
    {
      id: "copy_current",
      label: t("Copy Current Output", "复制当前输出"),
      hint: "C O",
      keywords: locale === "zh" ? "复制 推文 线程 文章" : "copy tweet thread article",
      run: () => copyByDraftType()
    },
    {
      id: "toggle_sidebar",
      label: sidebarCollapsed ? t("Expand Sidebar", "展开侧栏") : t("Collapse Sidebar", "收起侧栏"),
      hint: "Ctrl /",
      keywords: locale === "zh" ? "侧栏 切换" : "sidebar toggle",
      run: toggleSidebar
    }
  ];

  const normalizedCommandQuery = commandQuery.trim().toLowerCase();
  const filteredCommands = quickCommands.filter((item) =>
    `${item.label} ${item.keywords}`.toLowerCase().includes(normalizedCommandQuery)
  );

  function runQuickCommand(command: QuickCommand) {
    void Promise.resolve(command.run()).finally(() => {
      setCommandOpen(false);
      setCommandQuery("");
    });
  }

  const publishBusy = publishState === "scheduling" || publishState === "publishing";
  const scheduleLabel =
    publishState === "scheduling"
      ? t("Scheduling...", "排程中...")
      : publishState === "scheduled"
        ? t("Scheduled", "已排程")
        : t("Schedule", "排程");
  const publishLabel =
    publishState === "publishing"
      ? t("Publishing...", "发布中...")
      : publishState === "published"
        ? t("Published", "已发布")
        : t("Publish", "发布");

  return (
    <div
      className={clsx(
        "tf-app",
        sidebarCollapsed && "sidebar-collapsed",
        workspace.activeView === "preview" && "preview-mode"
      )}
      data-theme={theme}
    >
      <aside className="tf-sidebar">
        <div className="tf-sidebar-top">
          <div className="tf-workspace-head">
            {!sidebarCollapsed && (
              <div className="tf-profile">
                <div className="tf-avatar">
                  {authorIdentity.image ? (
                    <img src={authorIdentity.image} alt={authorIdentity.name} loading="lazy" />
                  ) : (
                    authorIdentity.initial
                  )}
                </div>
                <div className="tf-profile-meta">
                  <strong>{authorIdentity.name}</strong>
                  <span>{profileSubtitle}</span>
                </div>
                <button
                  type="button"
                  className="tf-auth-btn"
                  onClick={() => void handleAuthAction()}
                  disabled={authStatus === "loading" || (!authorIdentity.signedIn && !authReady)}
                  title={!authorIdentity.signedIn && !authReady ? authMissingHint : undefined}
                >
                  {authStatus === "loading"
                    ? t("Loading...", "加载中...")
                    : authorIdentity.signedIn
                      ? t("Sign out", "退出")
                      : !authConfig.checked
                        ? t("Checking...", "检测中...")
                        : authReady
                          ? t("Sign in X", "登录 X")
                          : t("Not configured", "未配置")}
                </button>
              </div>
            )}
            <div className="tf-workspace-controls">
              {!sidebarCollapsed && (
                <button
                  type="button"
                  className="tf-control-btn"
                  data-command-trigger="1"
                  onClick={() => {
                    setCommandQuery("");
                    toggleCommandPalette();
                  }}
                  aria-label={t("Search and commands", "搜索与命令")}
                >
                  <svg className="tf-control-icon" viewBox="0 0 20 20" aria-hidden>
                    <circle cx="8.5" cy="8.5" r="4.75" />
                    <path d="M12.2 12.2 16 16" />
                  </svg>
                  <span className="tf-control-tip">
                    {t("Search & Commands", "搜索与命令")} <kbd>Ctrl K</kbd>
                  </span>
                </button>
              )}
              {!sidebarCollapsed && (
                <button
                  type="button"
                  className="tf-control-btn"
                  data-command-trigger="1"
                  onClick={() => {
                    openComposeView("drafts");
                    setDraftPickerOpen(false);
                    setCommandQuery("new");
                    setCommandOpen(true);
                  }}
                  aria-label={t("Create draft command", "新建草稿命令")}
                >
                  <svg className="tf-control-icon" viewBox="0 0 20 20" aria-hidden>
                    <rect x="3.5" y="4.5" width="11" height="12" rx="2.5" />
                    <circle cx="14.75" cy="5.25" r="2" />
                  </svg>
                  <span className="tf-control-tip">
                    {t("New Draft Commands", "新建草稿命令")} <kbd>N</kbd>
                  </span>
                </button>
              )}
              <button
                type="button"
                className="tf-control-btn"
                onClick={toggleSidebar}
                aria-label={t("Toggle sidebar", "切换侧栏")}
              >
                <svg className="tf-control-icon" viewBox="0 0 20 20" aria-hidden>
                  <rect x="3" y="4" width="14" height="12" rx="2.5" />
                  <path d="M8.25 4v12" />
                </svg>
                <span className="tf-control-tip">
                  {t("Toggle Sidebar", "切换侧栏")} <kbd>Ctrl /</kbd>
                </span>
              </button>
            </div>
          </div>

          {commandOpen && (
            <div className="tf-command-panel" ref={commandRef}>
              <form
                className="tf-command-search"
                onSubmit={(event) => {
                  event.preventDefault();
                  const first = filteredCommands[0];
                  if (first) {
                    runQuickCommand(first);
                  }
                }}
              >
                <input
                  type="text"
                  value={commandQuery}
                  onChange={(event) => setCommandQuery(event.target.value)}
                  placeholder={t("Search & Commands", "搜索与命令")}
                  autoFocus
                  aria-label={t("Search commands", "搜索命令")}
                />
                <kbd>Ctrl K</kbd>
              </form>
              <div className="tf-command-list" role="listbox" aria-label={t("Quick commands", "快捷命令")}>
                {filteredCommands.length === 0 && (
                  <p className="tf-command-empty">{t("No command matched.", "没有匹配的命令。")}</p>
                )}
                {filteredCommands.slice(0, 8).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="tf-command-item"
                    onClick={() => runQuickCommand(item)}
                    role="option"
                  >
                    <span>{item.label}</span>
                    <kbd>{item.hint}</kbd>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="tf-tabs">
            <button
              type="button"
              className={clsx("tf-tab", paneTab === "drafts" && "active")}
              onClick={() => setPaneTab("drafts")}
              aria-pressed={paneTab === "drafts"}
            >
              {t("Drafts", "草稿")}
            </button>
            <button
              type="button"
              className={clsx("tf-tab", paneTab === "scheduled" && "active")}
              onClick={() => setPaneTab("scheduled")}
              aria-pressed={paneTab === "scheduled"}
            >
              {t("Scheduled", "排程")}
            </button>
            <button
              type="button"
              className={clsx("tf-tab", paneTab === "posted" && "active")}
              onClick={() => setPaneTab("posted")}
              aria-pressed={paneTab === "posted"}
            >
              {t("Posted", "已发布")}
            </button>
          </div>

          <div className={clsx("tf-new-draft-wrap", draftPickerOpen && "open")} ref={pickerRef}>
            <button
              type="button"
              className="tf-new-draft"
              onClick={() =>
                setDraftPickerOpen((prev) => {
                  const next = !prev;
                  if (next) {
                    const seed =
                      topicFilter !== TOPIC_FILTER_ALL && topicFilter !== TOPIC_FILTER_UNTAGGED
                        ? normalizeTopicLabel(topicFilter)
                        : "";
                    setNewDraftTopic(seed);
                  }
                  return next;
                })
              }
              aria-expanded={draftPickerOpen}
              aria-haspopup="menu"
              aria-controls="draft-kind-picker"
            >
              {t("+ New draft", "+ 新建草稿")}
            </button>
            {draftPickerOpen && (
              <div className="tf-draft-picker" id="draft-kind-picker" role="menu">
                <div className="tf-draft-picker-topic">
                  <label htmlFor="tf-new-draft-topic">
                    {t("Topic / Group (optional)", "话题 / 分组（可选）")}
                  </label>
                  <input
                    id="tf-new-draft-topic"
                    value={newDraftTopic}
                    onChange={(event) => setNewDraftTopic(event.target.value.slice(0, 28))}
                    onBlur={(event) => setNewDraftTopic(normalizeTopicLabel(event.target.value))}
                    placeholder={t("e.g. Product launch", "例如：产品发布")}
                    autoComplete="off"
                  />
                  {topicSuggestions.length > 0 && (
                    <div className="tf-draft-picker-topic-suggest">
                      {topicSuggestions.map((topic) => (
                        <button key={topic} type="button" onClick={() => setNewDraftTopic(topic)}>
                          {topic}
                        </button>
                      ))}
                      {newDraftTopic.trim() && (
                        <button type="button" className="ghost" onClick={() => setNewDraftTopic("")}>
                          {t("Clear", "清空")}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {localizedDraftOptions.map((option) => (
                  <button
                    key={option.kind}
                    type="button"
                    className="tf-draft-picker-item"
                    onClick={() => createNewDraft(option.kind, newDraftTopic)}
                    role="menuitem"
                  >
                    <strong>{option.title}</strong>
                    <span>{option.description}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {paneTab === "drafts" && (
            <section className="tf-topic-filter-wrap" aria-label={t("Topic groups", "话题分组")}>
              <div className="tf-topic-filter-head">
                <strong>{t("Topics", "话题")}</strong>
                {topicFilter !== TOPIC_FILTER_ALL && (
                  <button type="button" onClick={() => setTopicFilter(TOPIC_FILTER_ALL)}>
                    {t("Show all", "查看全部")}
                  </button>
                )}
              </div>
              <div className="tf-topic-filter-list">
                {topicFilterOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={clsx("tf-topic-chip", topicFilter === option.value && "active")}
                    onClick={() => setTopicFilter(option.value)}
                    aria-pressed={topicFilter === option.value}
                  >
                    <span>{option.label}</span>
                    <em>{option.count}</em>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
        <div className="tf-side-list">
          {paneTab === "drafts" &&
            groupedDraftItems.map((group) => (
              <section key={group.key} className="tf-draft-group">
                <header className="tf-draft-group-head">
                  <strong>{group.label}</strong>
                  <span>{group.items.length}</span>
                </header>
                {group.items.map((item) => (
                  <article
                    key={item.id}
                    className={clsx(
                      "tf-draft-item",
                      workspace.selectedDraftId === item.id && "active"
                    )}
                    onClick={() => selectDraft(item.id)}
                  >
                    <div className="tf-draft-title-row">
                      <strong>
                        <span className="tf-draft-kind-icon" aria-hidden>
                          {kindIcon(item.kind)}
                        </span>
                        {item.title}
                      </strong>
                      <span className={clsx("tf-kind-badge", `tf-kind-${item.kind}`)}>
                        {draftKindLabel(item.kind, locale)}
                      </span>
                    </div>
                    {item.topic && <div className="tf-draft-topic-pill">{item.topic}</div>}
                    <p>{item.preview}</p>
                    <div className="tf-draft-progress">
                      <div
                        className={clsx("tf-draft-progress-fill", item.overLimit && "warn")}
                        style={{ width: `${Math.max(6, Math.min(100, Math.round(item.usageRatio * 100)))}%` }}
                      />
                    </div>
                    <div className="tf-draft-meta">
                      <span>
                        {item.postCount} {t("posts", "条")}
                      </span>
                      <span>
                        {item.weightedChars} {t("chars", "字符")}
                      </span>
                      <span>{formatRelativeTime(item.updatedAt, locale)}</span>
                      <span className={item.issueCount === 0 ? "ok" : "warn"}>
                        {item.issueCount} {t("issues", "问题")}
                      </span>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeDraft(item.id);
                        }}
                      >
                        {t("Delete", "删除")}
                      </button>
                    </div>
                  </article>
                ))}
              </section>
            ))}
          {paneTab === "drafts" && visibleDraftItems.length === 0 && (
            <div className="tf-empty-topic-state">
              {t("No drafts under this topic yet.", "当前话题下还没有草稿。")}
            </div>
          )}

          {paneTab === "scheduled" &&
            workspace.queue.map((item) => (
              <article key={item.id} className="tf-draft-item">
                <div className="tf-draft-title-row">
                  <strong>{item.preview.slice(0, 30)}</strong>
                  {item.draftKind && (
                    <span className={clsx("tf-kind-badge", `tf-kind-${item.draftKind}`)}>
                      {draftKindLabel(item.draftKind, locale)}
                    </span>
                  )}
                </div>
                <p>{item.preview}</p>
                <div className="tf-draft-meta tf-draft-meta-stack">
                  <span>{formatDateTime(item.publishAt)}</span>
                  <span className={clsx("tf-queue-status", item.status === "failed" && "failed")}>
                    {item.status === "failed" ? t("Failed", "失败") : t("Pending", "等待中")}
                  </span>
                  <span>
                    {t("Attempts", "尝试次数")}: {item.attemptCount}/{item.maxAttempts}
                  </span>
                  {item.lastError && <span className="warn">{item.lastError}</span>}
                  {item.nextRetryAt && (
                    <span>
                      {t("Retry at", "重试时间")} {formatDateTime(item.nextRetryAt)}
                    </span>
                  )}
                  <div className="tf-draft-actions">
                    {item.status === "failed" && (
                      <button type="button" onClick={() => retryScheduledItem(item.id)}>
                        {t("Retry", "重试")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        void publishScheduledItem(item.id);
                      }}
                    >
                      {t("Publish", "发布")}
                    </button>
                  </div>
                </div>
              </article>
            ))}

          {paneTab === "posted" &&
            workspace.published.map((item) => (
              <article key={item.id} className="tf-draft-item">
                <div className="tf-draft-title-row">
                  <strong>{item.preview.slice(0, 30)}</strong>
                  {item.draftKind && (
                    <span className={clsx("tf-kind-badge", `tf-kind-${item.draftKind}`)}>
                      {draftKindLabel(item.draftKind, locale)}
                    </span>
                  )}
                </div>
                <p>{item.preview}</p>
                <div className="tf-draft-meta">
                  <span>{formatDateTime(item.publishedAt)}</span>
                  <span>
                    {formatNumber(item.metrics.impressions)} {t("views", "浏览")}
                  </span>
                </div>
              </article>
            ))}
        </div>

        <div className="tf-sidebar-foot">
          <button
            type="button"
            onClick={() => updateWorkspace((prev) => ({ ...prev, activeView: "calendar" }))}
          >
            {t("Calendar", "日历")}
          </button>
          <button
            type="button"
            onClick={() => updateWorkspace((prev) => ({ ...prev, activeView: "analytics" }))}
          >
            {t("Analytics", "分析")}
          </button>
          <button type="button" onClick={() => setPaneTab("drafts")}>
            {t("Back To Drafts", "返回草稿")}
          </button>
        </div>
      </aside>

      <main className="tf-main">
        {workspace.activeView === "preview" ? (
          <div className="tf-preview-topbar">
            <button type="button" className="tf-preview-brand-btn" onClick={() => openComposeView("drafts")}>
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M3 18V6h3.3l5.7 7 5.7-7H21v12h-3v-7l-5.1 6.2h-1.7L6 11v7z" />
              </svg>
              <span>MangoType</span>
            </button>
            <strong>
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M22.2 5.7c-.7.3-1.4.5-2.1.6.8-.5 1.3-1.2 1.6-2.1-.7.4-1.6.8-2.4.9a3.6 3.6 0 0 0-6.2 2.5c0 .3 0 .6.1.8a10.2 10.2 0 0 1-7.4-3.7 3.7 3.7 0 0 0-.5 1.8 3.6 3.6 0 0 0 1.6 3c-.6 0-1.1-.2-1.6-.4v.1a3.6 3.6 0 0 0 2.9 3.6c-.3.1-.7.1-1 .1-.2 0-.5 0-.7-.1a3.6 3.6 0 0 0 3.4 2.5A7.2 7.2 0 0 1 4 17a10.2 10.2 0 0 0 5.5 1.6c6.6 0 10.2-5.4 10.2-10.1v-.5c.7-.5 1.3-1.1 1.8-1.8Z" />
              </svg>
              {t("Twitter Preview", "推特预览")}
            </strong>
            <div className="tf-preview-toggle">
              <span>{t("Mobile", "移动端")}</span>
              <kbd>M</kbd>
              <button
                type="button"
                className={clsx("tf-preview-switch", previewMobile && "on")}
                onClick={() => setPreviewMobile((prev) => !prev)}
                aria-pressed={previewMobile}
                aria-label={t("Toggle mobile preview", "切换移动端预览")}
              >
                <i />
              </button>
            </div>
          </div>
        ) : (
          <div className="tf-topbar">
            <div className="tf-platform">X</div>
            <div className="tf-top-actions">
              <div className={clsx("tf-top-save-indicator", `is-${workspaceSaveState}`)} aria-live="polite">
                <strong>{saveIndicator.label}</strong>
                {saveIndicator.detail && <em>{saveIndicator.detail}</em>}
              </div>
              <div className="tf-locale-switch" role="group" aria-label={t("Language switch", "语言切换")}>
                <button
                  type="button"
                  className={clsx("tf-locale-chip", locale === "en" && "active")}
                  onClick={() => setLocale("en")}
                  aria-pressed={locale === "en"}
                >
                  EN
                </button>
                <button
                  type="button"
                  className={clsx("tf-locale-chip", locale === "zh" && "active")}
                  onClick={() => setLocale("zh")}
                  aria-pressed={locale === "zh"}
                >
                  中文
                </button>
              </div>
              <div className="tf-theme-switch" role="group" aria-label={t("Theme switch", "主题切换")}>
                {THEME_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={clsx("tf-theme-chip", theme === option.id && "active")}
                    onClick={() => setTheme(option.id)}
                  >
                    {themeLabel(option.id, locale)}
                  </button>
                ))}
              </div>
              <input
                type="datetime-local"
                value={workspace.scheduleAt}
                onChange={(event) =>
                  updateWorkspace((prev) => ({ ...prev, scheduleAt: event.target.value }))
                }
                aria-label={t("Schedule publish time", "排程发布时间")}
              />
              <button
                type="button"
                className={clsx("tf-btn schedule", publishState === "scheduled" && "is-success")}
                onClick={queueCurrentDraft}
                disabled={publishBusy}
                title={t("Schedule current draft", "排程当前草稿")}
              >
                {scheduleLabel}
                <kbd>Ctrl+S</kbd>
              </button>
              <button
                type="button"
                className={clsx(
                  "tf-btn publish",
                  publishState === "published" && "is-success",
                  !publishReady && "is-blocked"
                )}
                onClick={() => {
                  void publishCurrentDraft();
                }}
                disabled={publishBusy}
                title={t("Publish now", "立即发布")}
              >
                {publishLabel}
                <kbd>Ctrl+Enter</kbd>
              </button>
              <span
                className={clsx(
                  "tf-publish-state",
                  publishReady ? "ok" : "warn",
                  publishState !== "idle" && "visible"
                )}
              >
                {publishReady
                  ? t("Ready", "可发布")
                  : t("Fix character limits before publishing", "发布前请先修复字符超限")}
              </span>
            </div>
          </div>
        )}

        {workspace.activeView === "preview" && previewEnabled && (
          <section className={clsx("tf-x-preview", previewMobile && "is-mobile", threadPreview && "is-thread")}>
            <div className="tf-x-shell">
              <aside className="tf-x-left-nav">
                <div className="tf-x-left-nav-inner">
                  <div className="tf-x-brand" aria-label="Twitter">
                    <svg viewBox="0 0 24 24" aria-hidden>
                      <path d="M22.2 5.7c-.7.3-1.4.5-2.1.6.8-.5 1.3-1.2 1.6-2.1-.7.4-1.6.8-2.4.9a3.6 3.6 0 0 0-6.2 2.5c0 .3 0 .6.1.8a10.2 10.2 0 0 1-7.4-3.7 3.7 3.7 0 0 0-.5 1.8 3.6 3.6 0 0 0 1.6 3c-.6 0-1.1-.2-1.6-.4v.1a3.6 3.6 0 0 0 2.9 3.6c-.3.1-.7.1-1 .1-.2 0-.5 0-.7-.1a3.6 3.6 0 0 0 3.4 2.5A7.2 7.2 0 0 1 4 17a10.2 10.2 0 0 0 5.5 1.6c6.6 0 10.2-5.4 10.2-10.1v-.5c.7-.5 1.3-1.1 1.8-1.8Z" />
                    </svg>
                  </div>
                  <nav>
                    <button type="button" className="active">
                      <svg viewBox="0 0 24 24" aria-hidden>
                        <path d="M3 11.5 12 4l9 7.5v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
                      </svg>
                      <span>{t("Home", "首页")}</span>
                    </button>
                    <button type="button">
                      <svg viewBox="0 0 24 24" aria-hidden>
                        <circle cx="11" cy="11" r="7" />
                        <path d="m20 20-3.5-3.5" />
                      </svg>
                      <span>{t("Explore", "探索")}</span>
                    </button>
                    <button type="button">
                      <svg viewBox="0 0 24 24" aria-hidden>
                        <path d="M12 20a8 8 0 0 0 8-8 6.2 6.2 0 0 0-5.1-6.1A3.5 3.5 0 0 0 8 6 6 6 0 0 0 4 12a8 8 0 0 0 8 8Z" />
                      </svg>
                      <span>{t("Notifications", "通知")}</span>
                    </button>
                    <button type="button">
                      <svg viewBox="0 0 24 24" aria-hidden>
                        <rect x="3" y="5" width="18" height="14" rx="2" />
                        <path d="m4.5 7.5 7.5 6 7.5-6" />
                      </svg>
                      <span>{t("Messages", "消息")}</span>
                    </button>
                    <button type="button">
                      <svg viewBox="0 0 24 24" aria-hidden>
                        <path d="M6 3h12v18l-6-3.5L6 21z" />
                      </svg>
                      <span>{t("Bookmarks", "书签")}</span>
                    </button>
                    <button type="button">
                      <svg viewBox="0 0 24 24" aria-hidden>
                        <circle cx="12" cy="8" r="4" />
                        <path d="M5 21a7 7 0 0 1 14 0" />
                      </svg>
                      <span>{t("Profile", "个人资料")}</span>
                    </button>
                    <button type="button">
                      <svg viewBox="0 0 24 24" aria-hidden>
                        <circle cx="5" cy="12" r="1.8" />
                        <circle cx="12" cy="12" r="1.8" />
                        <circle cx="19" cy="12" r="1.8" />
                      </svg>
                      <span>{t("More", "更多")}</span>
                    </button>
                  </nav>
                </div>
              </aside>

              <div className="tf-x-feed">
                <header className="tf-x-feed-head">
                  <h2>{t("Home", "首页")}</h2>
                  <div className="tf-x-feed-tabs">
                    <button type="button" className="active">
                      {t("For you", "为你推荐")}
                    </button>
                    <button type="button">{t("Following", "正在关注")}</button>
                  </div>
                </header>
                <div className={clsx("tf-x-feed-list", threadPreview && "is-thread")}>
                  {previewTimelinePosts.length === 0 && (
                    <p className="tf-x-empty">{t("No content in this draft yet.", "该草稿还没有内容。")}</p>
                  )}
                  {previewTimelinePosts.map((post, index) => {
                    const showThreadLine = threadPreview && index < previewTimelinePosts.length - 1;
                    return (
                      <article key={post.id} className="tf-x-post-card">
                        <div className="tf-x-avatar-wrap">
                          <div className="tf-x-avatar">
                            {authorIdentity.image ? (
                              <img src={authorIdentity.image} alt={authorIdentity.name} loading="lazy" />
                            ) : (
                              authorIdentity.initial
                            )}
                          </div>
                          {showThreadLine && <span className="tf-x-thread-line" aria-hidden />}
                        </div>
                        <div className="tf-x-post-main">
                          <div className="tf-x-post-head">
                            <strong>{authorIdentity.name}</strong>
                            <span>{authorIdentity.handle}</span>
                            <i aria-hidden>·</i>
                            <span>{t("now", "刚刚")}</span>
                          </div>
                          <div className="tf-x-post-text">
                            {post.text.split("\n").map((line, lineIndex) => (
                              <p key={`${post.id}-${lineIndex}`}>{line || "\u00a0"}</p>
                            ))}
                          </div>
                          {(post.media?.length ?? 0) > 0 && (
                            <div className="tf-x-post-media">
                              {(post.media ?? []).map((media) => (
                                <div key={media.id} className="tf-x-media-item">
                                  {media.url && (media.type === "image" || media.type === "gif") ? (
                                    <img src={media.url} alt={media.name} loading="lazy" />
                                  ) : media.url && media.type === "video" ? (
                                    <video src={media.url} controls preload="metadata" />
                                  ) : (
                                    <div className="tf-x-media-placeholder">
                                      <em>{media.type.toUpperCase()}</em>
                                      <span>{media.name}</span>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="tf-x-post-stats">
                            <button type="button" tabIndex={-1}>
                              <svg viewBox="0 0 24 24" aria-hidden>
                                <path d="M4 5h16v10H8l-4 4V5z" />
                              </svg>
                              <span>{formatCompactPreviewNumber(post.replies)}</span>
                            </button>
                            <button type="button" tabIndex={-1}>
                              <svg viewBox="0 0 24 24" aria-hidden>
                                <path d="m4 7 4 4-4 4" />
                                <path d="M8 11h9a3 3 0 0 1 0 6h-2" />
                                <path d="m20 17-4-4 4-4" />
                                <path d="M16 13H7a3 3 0 0 1 0-6h2" />
                              </svg>
                              <span>{formatCompactPreviewNumber(post.reposts)}</span>
                            </button>
                            <button type="button" tabIndex={-1}>
                              <svg viewBox="0 0 24 24" aria-hidden>
                                <path d="M12 20s-7-4.7-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.3-7 10-7 10Z" />
                              </svg>
                              <span>{formatCompactPreviewNumber(post.likes)}</span>
                            </button>
                            <button type="button" tabIndex={-1}>
                              <svg viewBox="0 0 24 24" aria-hidden>
                                <path d="M4 18h3V9H4zm6 0h3V5h-3zm6 0h3v-7h-3z" />
                              </svg>
                              <span>{formatCompactPreviewNumber(post.views)}</span>
                            </button>
                            <button type="button" tabIndex={-1} aria-label={t("Share", "分享")}>
                              <svg viewBox="0 0 24 24" aria-hidden>
                                <path d="m14 5 5-2v14" />
                                <path d="M9 10c3.5 0 7-1.8 10-4.8" />
                                <path d="M9 14c3.6 0 7.2 1.9 10 4.8" />
                                <path d="M5 12h4" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>

              <aside className="tf-x-right-panel">
                <div className="tf-x-right-panel-inner">
                  <div className="tf-x-search-wrap">
                    <svg viewBox="0 0 24 24" aria-hidden>
                      <circle cx="11" cy="11" r="7" />
                      <path d="m20 20-3.5-3.5" />
                    </svg>
                    <input
                      type="search"
                      placeholder={t("Search", "搜索")}
                      aria-label={t("Search preview timeline", "搜索预览时间线")}
                    />
                  </div>
                  <section className="tf-x-promo-card">
                    <strong>MangoType</strong>
                  </section>
                  <section className="tf-x-who-card">
                    <h3>{t("Who to follow", "值得关注")}</h3>
                    <ul>
                      {X_WHO_TO_FOLLOW.map((item) => (
                        <li key={item.handle}>
                          <div className="tf-x-follow-meta">
                            <div
                              className="tf-x-follow-avatar"
                              style={{ backgroundColor: item.avatarBg, color: item.avatarFg }}
                            >
                              {item.initials}
                            </div>
                            <div>
                              <strong>{item.name}</strong>
                              <span>{item.handle}</span>
                            </div>
                          </div>
                          <button type="button">{t("Follow", "关注")}</button>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
              </aside>
            </div>
          </section>
        )}

        {workspace.activeView === "compose" && (
          <section className="tf-canvas">
            {paneTab === "drafts" && currentDraft && (
              <div className="tf-compose-stage">
                {showOnboarding && (
                  <section className="tf-onboarding-card" aria-live="polite">
                    <div className="tf-onboarding-head">
                      <strong>{t("Quick Start", "快速开始")}</strong>
                      <button type="button" onClick={dismissOnboarding}>
                        {t("Dismiss", "关闭")}
                      </button>
                    </div>
                    <p>{t("Use shortcuts to draft faster and keep your writing flow uninterrupted.", "使用快捷键更快起草，保持写作不断流。")}</p>
                    <ul>
                      <li>
                        <kbd>Ctrl + J</kbd> {t("Add a post below (thread)", "在线程中向下新增一条")}
                      </li>
                      <li>
                        <kbd>Ctrl + Shift + I</kbd> {t("Upload media", "上传媒体")}
                      </li>
                      <li>
                        <kbd>Ctrl + Enter</kbd> {t("Publish now", "立即发布")}
                      </li>
                    </ul>
                  </section>
                )}
                <div className="tf-draft-header">
                  <div className="tf-draft-header-fields">
                    <input
                      className="tf-draft-title-input"
                      value={currentDraft.title}
                      onChange={(event) => updateDraftTitle(event.target.value)}
                      placeholder={t("Draft title", "草稿标题")}
                      aria-label={t("Draft title", "草稿标题")}
                    />
                    <input
                      className="tf-draft-topic-input"
                      value={currentDraft.topic ?? ""}
                      onChange={(event) => updateDraftTopic(event.target.value)}
                      onBlur={(event) => updateDraftTopic(event.target.value, true)}
                      placeholder={t("Topic / Group", "话题 / 分组")}
                      aria-label={t("Draft topic group", "草稿话题分组")}
                    />
                  </div>
                  <span className={clsx("tf-kind-badge", `tf-kind-${currentDraft.kind}`)}>
                    {draftKindLabel(currentDraft.kind, locale)}
                  </span>
                </div>
                <div className="tf-shortcut-row">
                  <span>
                    <kbd>Ctrl + J</kbd> {t("add post", "新增一条")}
                  </span>
                  <span>
                    <kbd>Alt + ArrowDown</kbd> {t("move post", "下移该条")}
                  </span>
                  <span>
                    <kbd>Ctrl + Enter</kbd> {t("publish", "发布")}
                  </span>
                </div>
                <div className="tf-workflow-actions">
                  <button type="button" onClick={() => setTemplateLibraryOpen(true)}>
                    {t("Templates", "模板")}
                  </button>
                  <button type="button" onClick={saveCurrentDraftSnapshot}>
                    {t("Save Version", "保存版本")}
                  </button>
                  <button type="button" onClick={() => setHistoryOpen(true)}>
                    {t("History", "历史")} ({currentDraftHistory.length})
                  </button>
                  <button
                    type="button"
                    onClick={openPreviewView}
                    className={clsx(!previewEnabled && "is-disabled")}
                    disabled={!previewEnabled}
                    title={
                      !previewEnabled
                        ? t("Article preview is not supported yet.", "文章暂不支持预览。")
                        : t("Open Twitter Preview", "打开推特预览")
                    }
                  >
                    {t("Show Preview", "显示预览")}
                  </button>
                  <button type="button" onClick={() => setShortcutsOpen(true)}>
                    {t("Shortcuts", "快捷键")}
                  </button>
                </div>

                {currentDraft.kind === "thread" && (
                  <div className="tf-thread-stack has-active">
                    {currentDraft.posts.map((post, index) => (
                      <article
                        key={post.id}
                        className={clsx(
                          "tf-post-row",
                          currentDraft.selectedPostId === post.id ? "active" : "dimmed"
                        )}
                      >
                        <div className="tf-post-avatar">{index + 1}</div>
                        <div
                          className={clsx(
                            "tf-post-body",
                            currentDraft.selectedPostId === post.id ? "active" : "dimmed",
                            (issuesByPost[post.id]?.length ?? 0) > 0 && "has-issues"
                          )}
                        >
                          <div className="tf-post-head">
                            <span className="name">{authorIdentity.name}</span>
                            <span className="handle">{authorIdentity.handle}</span>
                          </div>
                          <RichEditor
                            value={post.text}
                            variant="thread"
                            locale={locale}
                            onFocus={() => selectPost(post.id)}
                            onChange={(html) => updatePostHtml(post.id, html)}
                            bindRef={(element) => {
                              editorRefs.current[post.id] = element;
                            }}
                          />
                          {(post.media?.length ?? 0) > 0 && (
                            <div className="tf-media-row">
                              {(post.media ?? []).map((media) => (
                                <article key={media.id} className="tf-media-card">
                                  <div className="tf-media-preview">
                                    {media.url && (media.type === "image" || media.type === "gif") ? (
                                      <img src={media.url} alt={media.name} loading="lazy" />
                                    ) : media.url && media.type === "video" ? (
                                      <video src={media.url} controls preload="metadata" />
                                    ) : (
                                      <span>{media.type.toUpperCase()}</span>
                                    )}
                                  </div>
                                  <div className="tf-media-card-meta">
                                    <em>{media.type.toUpperCase()}</em>
                                    <strong title={media.name}>{media.name}</strong>
                                    <button
                                      type="button"
                                      onClick={() => removeMedia(post.id, media.id)}
                                      aria-label={
                                        locale === "zh"
                                          ? `移除${media.type === "image" ? "图片" : media.type === "gif" ? "GIF" : "视频"} ${media.name}`
                                          : `Remove ${media.type} ${media.name}`
                                      }
                                    >
                                      x
                                    </button>
                                  </div>
                                </article>
                              ))}
                            </div>
                          )}
                          {post.poll && (
                            <div className="tf-poll-card">
                              <p>{post.poll.question}</p>
                              <ul>
                                {post.poll.options.map((option) => (
                                  <li key={option}>{option}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          <div className="tf-post-tools">
                            <button
                              type="button"
                              className="tf-tool-item"
                              onClick={() => selectPost(post.id)}
                              aria-label={
                                locale === "zh"
                                  ? `定位到第 ${index + 1} 条。已使用 ${countByPost[post.id]?.weightedLength ?? 0}/280 字符。`
                                  : `Focus post #${index + 1}. ${countByPost[post.id]?.weightedLength ?? 0} of 280 characters used.`
                              }
                            >
                              <span
                                className={clsx(
                                  "tf-tool-dot",
                                  countByPost[post.id]?.valid ? "ok" : "warn"
                                )}
                              >
                                o
                              </span>
                              <span className="tf-tool-tip tf-tool-count">
                                {countByPost[post.id]?.weightedLength ?? 0}/280
                              </span>
                            </button>

                            <button
                              type="button"
                              className="tf-tool-item"
                              aria-label={
                                locale === "zh"
                                  ? `第 ${index + 1} 条`
                                  : `Post number ${index + 1}`
                              }
                            >
                              <span>#{index + 1}</span>
                              <span className="tf-tool-tip">
                                {locale === "zh" ? `第 ${index + 1} 条` : `Post #${index + 1}`}
                              </span>
                            </button>

                            <button
                              type="button"
                              className="tf-tool-item"
                              onClick={() => insertPostBelow(post.id)}
                              aria-label={
                                locale === "zh"
                                  ? `在第 ${index + 1} 条下方新增`
                                  : `Add post below post #${index + 1}`
                              }
                            >
                              <span>+</span>
                              <span className="tf-tool-tip-card">
                                <strong>{t("Add post below", "在下方新增一条")}</strong>
                                <em>
                                  {t(
                                    "You can also add multiple empty newlines to add a post.",
                                    "你也可以通过连续输入多个空行来新增一条。"
                                  )}
                                </em>
                                <kbd>ctrl + J</kbd>
                              </span>
                            </button>

                            <div className="tf-tool-menu-wrap">
                              <button
                                type="button"
                                className="tf-tool-item"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  selectPost(post.id);
                                  setMediaMenuPostId((prev) => (prev === post.id ? null : post.id));
                                  setAiMenuPostId(null);
                                  setMoreMenuPostId(null);
                                }}
                                aria-label={
                                  locale === "zh"
                                    ? `打开第 ${index + 1} 条媒体菜单`
                                    : `Open media menu for post #${index + 1}`
                                }
                                aria-haspopup="menu"
                                aria-expanded={mediaMenuPostId === post.id}
                                aria-controls={`media-menu-${post.id}`}
                              >
                                <span>IMG</span>
                              </button>
                              {mediaMenuPostId === post.id && (
                                <div className="tf-popup tf-popup-dark" id={`media-menu-${post.id}`} role="menu">
                                  <button type="button" onClick={() => openUploadForPost(post.id)} role="menuitem">
                                    {t("Upload images or video", "上传图片或视频")}
                                    <kbd>ctrl shift i</kbd>
                                  </button>
                                  <button type="button" onClick={() => openGifPicker(post.id)} role="menuitem">
                                    {t("Add GIF", "添加 GIF")}
                                  </button>
                                </div>
                              )}
                            </div>

                            <div className="tf-tool-menu-wrap">
                              <button
                                type="button"
                                className="tf-tool-item"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  selectPost(post.id);
                                  setAiMenuPostId((prev) => (prev === post.id ? null : post.id));
                                  setMediaMenuPostId(null);
                                  setMoreMenuPostId(null);
                                }}
                                aria-label={
                                  locale === "zh"
                                    ? `打开第 ${index + 1} 条 AI 改写菜单`
                                    : `Open AI rewrite menu for post #${index + 1}`
                                }
                                aria-haspopup="menu"
                                aria-expanded={aiMenuPostId === post.id}
                                aria-controls={`ai-menu-${post.id}`}
                              >
                                <span>AI</span>
                              </button>
                              {aiMenuPostId === post.id && (
                                <div className="tf-popup tf-popup-ai" id={`ai-menu-${post.id}`} role="menu">
                                  <form
                                    className="tf-ai-search"
                                    onSubmit={(event) => {
                                      event.preventDefault();
                                      applyCustomAiPrompt(post.id);
                                    }}
                                  >
                                    <input
                                      value={aiPrompt}
                                      onChange={(event) => setAiPrompt(event.target.value)}
                                      placeholder={t("Search or type a custom prompt...", "搜索或输入自定义提示词...")}
                                      aria-label={t("AI rewrite prompt", "AI 改写提示词")}
                                    />
                                  </form>
                                  <div className="tf-ai-list">
                                    {localizedAiPresets.map((preset) => (
                                      <button
                                        key={preset.id}
                                        type="button"
                                        onClick={() => applyAiRewrite(post.id, preset.id)}
                                        role="menuitem"
                                      >
                                        {preset.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>

                            <div className="tf-tool-menu-wrap">
                              <button
                                type="button"
                                className="tf-tool-item"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  selectPost(post.id);
                                  setMoreMenuPostId((prev) => (prev === post.id ? null : post.id));
                                  setMediaMenuPostId(null);
                                  setAiMenuPostId(null);
                                }}
                                aria-label={
                                  locale === "zh"
                                    ? `打开第 ${index + 1} 条操作菜单`
                                    : `Open post actions menu for post #${index + 1}`
                                }
                                aria-haspopup="menu"
                                aria-expanded={moreMenuPostId === post.id}
                                aria-controls={`more-menu-${post.id}`}
                              >
                                <span>...</span>
                              </button>
                              {moreMenuPostId === post.id && (
                                <div className="tf-popup tf-popup-dark" id={`more-menu-${post.id}`} role="menu">
                                  <button type="button" onClick={() => addPollToPost(post.id)} role="menuitem">
                                    {post.poll ? t("Remove poll", "移除投票") : t("Add poll", "添加投票")}
                                  </button>
                                  <button type="button" onClick={() => movePostDown(post.id)} role="menuitem">
                                    {t("Move down", "下移")}
                                    <kbd>alt ArrowDown</kbd>
                                  </button>
                                  <button type="button" className="danger" onClick={() => removePostFromThread(post.id)} role="menuitem">
                                    {t("Delete post", "删除该条")}
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="tf-post-foot">
                            <span
                              className={
                                (issuesByPost[post.id]?.length ?? 0) === 0 ? "ok" : "warn"
                              }
                            >
                              {issuesByPost[post.id]?.length ?? 0} {t("issues", "问题")}
                            </span>
                            <div className="tf-post-foot-actions">
                              <button
                                type="button"
                                onClick={() =>
                                  copyText(tweetOutputByPost[post.id] ?? "", t("Tweet copied.", "推文已复制。"))
                                }
                                aria-label={
                                  locale === "zh" ? `复制第 ${index + 1} 条` : `Copy post #${index + 1}`
                                }
                              >
                                {t("Copy", "复制")}
                              </button>
                            </div>
                          </div>
                          {(issuesByPost[post.id]?.length ?? 0) > 0 && (
                            <div className="tf-inline-issues">
                              {(issuesByPost[post.id] ?? []).slice(0, 2).map((issue) => (
                                <article key={issue.id} className="tf-inline-issue">
                                  <p>
                                    <strong>{issue.ruleId}</strong> {issue.message}
                                  </p>
                                  {RULE_DEFINITIONS.find((rule) => rule.id === issue.ruleId)?.autofix && (
                                    <button type="button" onClick={() => applySingleFixForPost(post.id, issue)}>
                                      {t("Fix", "修复")}
                                    </button>
                                  )}
                                </article>
                              ))}
                            </div>
                          )}
                        </div>
                      </article>
                    ))}
                    <button type="button" className="tf-add-post" onClick={addPostToThread}>
                      {t("+ Add tweet to thread", "+ 添加线程推文")}
                    </button>
                  </div>
                )}

                {currentDraft.kind === "tweet" && currentPost && (
                  <article
                    className={clsx(
                      "tf-single-post",
                      (issuesByPost[currentPost.id]?.length ?? 0) > 0 && "has-issues"
                    )}
                  >
                    <div className="tf-post-head">
                      <span className="name">{authorIdentity.name}</span>
                      <span className="handle">{authorIdentity.handle}</span>
                      <span
                        className={clsx("count", countByPost[currentPost.id]?.valid ? "ok" : "warn")}
                      >
                        {countByPost[currentPost.id]?.weightedLength ?? 0}/280
                      </span>
                    </div>
                    <RichEditor
                      value={currentPost.text}
                      variant="tweet"
                      locale={locale}
                      onFocus={() => selectPost(currentPost.id)}
                      onChange={(html) => updatePostHtml(currentPost.id, html)}
                      bindRef={(element) => {
                        editorRefs.current[currentPost.id] = element;
                      }}
                    />
                    <div className="tf-inline-formatbar">
                      <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => applyInline("bold")}
                      >
                        B
                      </button>
                      <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => applyInline("italic")}
                      >
                        I
                      </button>
                      <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => applyBlock("blockquote")}
                      >
                        {t("Quote", "引用")}
                      </button>
                      <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => applyBlock("ul")}
                      >
                        {t("List", "列表")}
                      </button>
                      <button type="button" onClick={applyAllFixesToCurrentDraft}>
                        {t("Fix", "修复")}
                      </button>
                    </div>
                    <div className="tf-post-foot">
                      <span
                        className={
                          (issuesByPost[currentPost.id]?.length ?? 0) === 0 ? "ok" : "warn"
                        }
                      >
                        {issuesByPost[currentPost.id]?.length ?? 0} {t("issues", "问题")}
                      </span>
                      <button
                        type="button"
                        onClick={() => copyText(selectedTweetOutput, t("Tweet copied.", "推文已复制。"))}
                      >
                        {t("Copy", "复制")}
                      </button>
                    </div>
                    {(issuesByPost[currentPost.id]?.length ?? 0) > 0 && (
                      <div className="tf-inline-issues">
                        {(issuesByPost[currentPost.id] ?? []).slice(0, 2).map((issue) => (
                          <article key={issue.id} className="tf-inline-issue">
                            <p>
                              <strong>{issue.ruleId}</strong> {issue.message}
                            </p>
                            {RULE_DEFINITIONS.find((rule) => rule.id === issue.ruleId)?.autofix && (
                              <button type="button" onClick={() => applySingleFixForPost(currentPost.id, issue)}>
                                {t("Fix", "修复")}
                              </button>
                            )}
                          </article>
                        ))}
                      </div>
                    )}
                  </article>
                )}

                {currentDraft.kind === "article" && currentPost && (
                  <article
                    className={clsx(
                      "tf-article-card",
                      (issuesByPost[currentPost.id]?.length ?? 0) > 0 && "has-issues"
                    )}
                  >
                    <p className="tf-article-tip">
                      {t(
                        "Use H1/H2/H3 for title and subtitle. Copy keeps rich formatting when supported.",
                        "使用 H1/H2/H3 设置标题与副标题。复制时在支持环境下会保留富文本格式。"
                      )}
                    </p>
                    <div className="tf-article-heading-inputs">
                      <input
                        value={articleHeading.title}
                        onChange={(event) =>
                          updateArticleHeadingField("title", event.target.value)
                        }
                        placeholder={t("Main title (H1)", "主标题（H1）")}
                        aria-label={t("Article main title", "文章主标题")}
                      />
                      <input
                        value={articleHeading.subtitle}
                        onChange={(event) =>
                          updateArticleHeadingField("subtitle", event.target.value)
                        }
                        placeholder={t("Subtitle (H2)", "副标题（H2）")}
                        aria-label={t("Article subtitle", "文章副标题")}
                      />
                    </div>
                    <RichEditor
                      value={currentPost.text}
                      variant="article"
                      locale={locale}
                      onFocus={() => selectPost(currentPost.id)}
                      onChange={(html) => updatePostHtml(currentPost.id, html)}
                      bindRef={(element) => {
                        editorRefs.current[currentPost.id] = element;
                      }}
                    />
                    <div className="tf-inline-formatbar tf-inline-formatbar-article">
                      <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => applyInline("bold")}
                      >
                        B
                      </button>
                      <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => applyInline("italic")}
                      >
                        I
                      </button>
                      <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => applyBlock("h1")}
                      >
                        {t("Main Title", "主标题")}
                      </button>
                      <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => applyBlock("h2")}
                      >
                        {t("Subtitle", "副标题")}
                      </button>
                      <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => applyBlock("blockquote")}
                      >
                        {t("Quote", "引用")}
                      </button>
                      <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => applyBlock("ul")}
                      >
                        {t("List", "列表")}
                      </button>
                      <button type="button" onClick={applyAllFixesToCurrentDraft}>
                        {t("Fix", "修复")}
                      </button>
                    </div>
                    <div className="tf-post-foot">
                      <span
                        className={
                          (issuesByPost[currentPost.id]?.length ?? 0) === 0 ? "ok" : "warn"
                        }
                      >
                        {issuesByPost[currentPost.id]?.length ?? 0} {t("issues", "问题")}
                      </span>
                      <button type="button" onClick={copyArticle}>
                        {t("Copy Article", "复制文章")}
                      </button>
                    </div>
                    {(issuesByPost[currentPost.id]?.length ?? 0) > 0 && (
                      <div className="tf-inline-issues">
                        {(issuesByPost[currentPost.id] ?? []).slice(0, 2).map((issue) => (
                          <article key={issue.id} className="tf-inline-issue">
                            <p>
                              <strong>{issue.ruleId}</strong> {issue.message}
                            </p>
                            {RULE_DEFINITIONS.find((rule) => rule.id === issue.ruleId)?.autofix && (
                              <button type="button" onClick={() => applySingleFixForPost(currentPost.id, issue)}>
                                {t("Fix", "修复")}
                              </button>
                            )}
                          </article>
                        ))}
                      </div>
                    )}
                  </article>
                )}
              </div>
            )}

            {paneTab === "scheduled" && (
              <div className="tf-empty">
                <p>
                  {t("Scheduled items", "排程任务")}: {queueStats.total}
                </p>
                <p className="tf-muted-light">
                  {t("Pending", "等待中")}: {queueStats.pending} | {t("Failed", "失败")}:{" "}
                  {queueStats.failed} | {t("Waiting retry", "等待重试")}:{" "}
                  {queueStats.waitingRetry}
                </p>
                <button
                  type="button"
                  className="tf-btn schedule"
                  onClick={() => {
                    void runDueJobs();
                  }}
                >
                  {t("Run Due Jobs", "执行到期任务")}
                </button>
                <div className="tf-activity-feed">
                  <h4>{t("Scheduling activity", "排程活动")}</h4>
                  {recentActivity.length === 0 ? (
                    <p className="tf-muted-light">{t("No activity yet.", "暂无活动。")}</p>
                  ) : (
                    <ul>
                      {recentActivity.map((item) => (
                        <li key={item.id} className={clsx("tf-activity-item", `lvl-${item.level}`)}>
                          <span>{item.message}</span>
                          <small>{formatRelativeTime(item.at, locale)}</small>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {paneTab === "posted" && (
              <div className="tf-empty">
                <p>
                  {t("Posted threads", "已发布内容")}: {workspace.published.length}
                </p>
                <p className="tf-muted-light">
                  {t("Avg engagement rate", "平均互动率")}: {analytics.avgEngagementRate}%
                </p>
              </div>
            )}
          </section>
        )}

        {workspace.activeView === "calendar" && (
          <section className="tf-simple-page">
            <h2>{t("Calendar", "日历")}</h2>
            <p>
              {t("Scheduled items", "排程任务")}: {workspace.queue.length}
            </p>
            <button
              type="button"
              onClick={() => updateWorkspace((prev) => ({ ...prev, activeView: "compose" }))}
            >
              {t("Back", "返回")}
            </button>
          </section>
        )}

        {workspace.activeView === "analytics" && (
          <section className="tf-simple-page">
            <h2>{t("Analytics", "分析")}</h2>
            <p>
              {t("Total impressions", "总曝光")}: {formatNumber(analytics.impressions)}
            </p>
            <p>
              {t("Avg engagement rate", "平均互动率")}: {analytics.avgEngagementRate}%
            </p>
            <button
              type="button"
              onClick={() => updateWorkspace((prev) => ({ ...prev, activeView: "compose" }))}
            >
              {t("Back", "返回")}
            </button>
          </section>
        )}

        {paneTab === "drafts" && workspace.activeView === "compose" && currentDraft && (
          <div className="tf-bottom-toolbar">
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyInline("bold")}
            >
              B
            </button>
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyInline("italic")}
            >
              I
            </button>
            <button
              type="button"
              className={currentDraft.kind !== "article" ? "disabled" : ""}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyBlock("h1")}
            >
              H1
            </button>
            <button
              type="button"
              className={currentDraft.kind !== "article" ? "disabled" : ""}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyBlock("h2")}
            >
              H2
            </button>
            <button
              type="button"
              className={currentDraft.kind !== "article" ? "disabled" : ""}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyBlock("h3")}
            >
              H3
            </button>
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyBlock("blockquote")}
            >
              {t("Quote", "引用")}
            </button>
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyBlock("ul")}
            >
              {t("List", "列表")}
            </button>
            <button type="button" onClick={applyAllFixesToCurrentDraft}>
              {t("Fix", "修复")}
            </button>
            {currentDraft.kind === "thread" && (
              <button type="button" onClick={addPostToThread}>
                {t("+ Post", "+ 新增")}
              </button>
            )}
            <button type="button" onClick={copyByDraftType}>
              {currentDraft.kind === "article"
                ? t("Copy Article", "复制文章")
                : currentDraft.kind === "thread"
                  ? t("Copy Thread", "复制线程")
                  : t("Copy Tweet", "复制推文")}
            </button>
            <select
              value={workspace.tweetFormatMode}
              onChange={(event) =>
                updateWorkspace((prev) => ({
                  ...prev,
                  tweetFormatMode: event.target.value as WorkspaceState["tweetFormatMode"]
                }))
              }
              aria-label={t("Tweet copy format mode", "推文复制格式")}
            >
              <option value="unicode">{t("Unicode Style", "Unicode 样式")}</option>
              <option value="plain">{t("Plain Text", "纯文本")}</option>
            </select>
          </div>
        )}

      </main>

      {selectionToolbar.visible && paneTab === "drafts" && workspace.activeView === "compose" && (
        <div
          className="tf-context-toolbar"
          style={{
            left: `${selectionToolbar.x}px`,
            top: `${selectionToolbar.y}px`
          }}
        >
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applyInline("bold", selectionToolbar.postId ?? undefined)}
            title={t("Bold", "加粗")}
          >
            B
          </button>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applyInline("italic", selectionToolbar.postId ?? undefined)}
            title={t("Italic", "斜体")}
          >
            I
          </button>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applyBlock("blockquote", selectionToolbar.postId ?? undefined)}
            title={t("Quote", "引用")}
          >
            {t("Quote", "引用")}
          </button>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applyBlock("ul", selectionToolbar.postId ?? undefined)}
            title={t("List", "列表")}
          >
            {t("List", "列表")}
          </button>
          {currentDraft?.kind === "article" && (
            <>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyBlock("h1", selectionToolbar.postId ?? undefined)}
                title={t("Main title", "主标题")}
              >
                H1
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyBlock("h2", selectionToolbar.postId ?? undefined)}
                title={t("Subtitle", "副标题")}
              >
                H2
              </button>
            </>
          )}
        </div>
      )}

      {selectedIssues.length > 0 && paneTab === "drafts" && workspace.activeView === "compose" && (
        <div className="tf-issue-dock">
          {selectedIssues.slice(0, 2).map((issue) => (
            <article key={issue.id}>
              <p>
                <strong>{issue.ruleId}</strong> {issue.message}
              </p>
              {RULE_DEFINITIONS.find((rule) => rule.id === issue.ruleId)?.autofix && (
                <button type="button" onClick={() => applySingleFix(issue)}>
                  {t("Fix", "修复")}
                </button>
              )}
            </article>
          ))}
        </div>
      )}

      {templateLibraryOpen && (
        <div
          className="tf-modal-backdrop"
          onMouseDown={() => setTemplateLibraryOpen(false)}
          role="presentation"
        >
          <section
            className="tf-modal-card tf-template-modal"
            ref={templateRef}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h3>{t("Template Library", "模板库")}</h3>
                <p>{t("Start faster with reusable Tweet, Thread, and Article structures.", "使用可复用的推文、线程、文章结构快速开始。")}</p>
              </div>
              <button type="button" onClick={() => setTemplateLibraryOpen(false)}>
                {t("Close", "关闭")}
              </button>
            </header>
            <div className="tf-template-grid">
              {TEMPLATE_LIBRARY.map((template) => (
                <article key={template.id} className="tf-template-card">
                  <span className={clsx("tf-kind-badge", `tf-kind-${template.kind}`)}>
                    {draftKindLabel(template.kind, locale)}
                  </span>
                  <strong>{template.name}</strong>
                  <p>{template.description}</p>
                  <div className="tf-template-actions">
                    <button type="button" onClick={() => applyTemplate(template, "replace")}>
                      {t("Apply Here", "应用到当前草稿")}
                    </button>
                    <button type="button" onClick={() => applyTemplate(template, "new")}>
                      {t("Create New", "创建新草稿")}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}

      {historyOpen && currentDraft && (
        <div
          className="tf-modal-backdrop"
          onMouseDown={() => setHistoryOpen(false)}
          role="presentation"
        >
          <section
            className="tf-modal-card tf-history-modal"
            ref={historyRef}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h3>{t("Version History", "版本历史")}</h3>
                <p>
                  {currentDraftHistory.length} {t("snapshots for this draft", "个快照（当前草稿）")}
                </p>
              </div>
              <button type="button" onClick={() => setHistoryOpen(false)}>
                {t("Close", "关闭")}
              </button>
            </header>
            {currentDraftHistory.length === 0 ? (
              <p className="tf-modal-empty">
                {t("No snapshots yet. Save one to start tracking versions.", "还没有快照，先保存一个版本开始追踪。")}
              </p>
            ) : (
              <div className="tf-history-list">
                {currentDraftHistory.map((snapshot) => (
                  <article key={snapshot.id} className="tf-history-item">
                    <div className="tf-history-item-head">
                      <strong>{snapshot.label}</strong>
                      <span>{formatRelativeTime(snapshot.createdAt, locale)}</span>
                    </div>
                    <p>
                      {draftKindLabel(snapshot.kind, locale)} · {snapshot.posts.length}{" "}
                      {locale === "zh" ? "条" : "posts"}
                    </p>
                    <p className="tf-history-snippet">{snapshotPreviewText(snapshot, locale)}</p>
                    <div className="tf-history-actions">
                      <button type="button" onClick={() => restoreDraftSnapshot(snapshot.id)}>
                        {t("Restore", "恢复")}
                      </button>
                      <button type="button" onClick={() => removeDraftSnapshot(snapshot.id)}>
                        {t("Remove", "移除")}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {shortcutsOpen && (
        <div
          className="tf-modal-backdrop"
          onMouseDown={() => setShortcutsOpen(false)}
          role="presentation"
        >
          <section
            className="tf-modal-card tf-shortcuts-modal"
            ref={shortcutRef}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h3>{t("Shortcut Guide", "快捷键说明")}</h3>
                <p>{t("Core writing and workspace actions.", "核心写作与工作区操作。")}</p>
              </div>
              <button type="button" onClick={() => setShortcutsOpen(false)}>
                {t("Close", "关闭")}
              </button>
            </header>
            <div className="tf-shortcut-grid">
              <article>
                <strong>Ctrl/Cmd + K</strong>
                <span>{t("Search & Commands", "搜索与命令")}</span>
              </article>
              <article>
                <strong>Ctrl/Cmd + /</strong>
                <span>{t("Toggle sidebar", "切换侧栏")}</span>
              </article>
              <article>
                <strong>Ctrl/Cmd + Enter</strong>
                <span>{t("Publish current draft", "发布当前草稿")}</span>
              </article>
              <article>
                <strong>Ctrl/Cmd + S</strong>
                <span>{t("Schedule current draft", "排程当前草稿")}</span>
              </article>
              <article>
                <strong>Ctrl/Cmd + J</strong>
                <span>{t("Add post (Thread)", "新增一条（线程）")}</span>
              </article>
              <article>
                <strong>Alt + ArrowDown</strong>
                <span>{t("Move post down", "下移该条")}</span>
              </article>
              <article>
                <strong>Ctrl/Cmd + Shift + T</strong>
                <span>{t("Open template library", "打开模板库")}</span>
              </article>
              <article>
                <strong>Ctrl/Cmd + Shift + V</strong>
                <span>{t("Save version snapshot", "保存版本快照")}</span>
              </article>
              <article>
                <strong>Ctrl/Cmd + Shift + P</strong>
                <span>{t("Open Twitter preview", "打开推特预览")}</span>
              </article>
              <article>
                <strong>Ctrl/Cmd + Shift + H</strong>
                <span>{t("Open shortcut guide", "打开快捷键说明")}</span>
              </article>
            </div>
          </section>
        </div>
      )}

      {gifPickerOpen && (
        <div className="tf-modal-backdrop tf-gif-backdrop" onMouseDown={closeGifPicker} role="presentation">
          <section className="tf-modal-card tf-gif-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="tf-gif-search-row">
              <label className="tf-gif-search-wrap">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.6-3.6" />
                </svg>
                <input
                  ref={gifSearchRef}
                  value={gifQuery}
                  onChange={(event) => setGifQuery(event.target.value)}
                  placeholder={t("Search Tenor...", "搜索 Tenor...")}
                />
                <span className="tf-gif-powered">tenor</span>
              </label>
              <button
                type="button"
                className="tf-gif-close"
                onClick={closeGifPicker}
                aria-label={t("Close GIF picker", "关闭 GIF 选择器")}
              >
                ×
              </button>
            </div>

            {gifError && <p className="tf-gif-feedback error">{gifError}</p>}
            {!gifError && gifLoading && gifResults.length === 0 && (
              <p className="tf-gif-feedback">{t("Loading GIFs...", "正在加载 GIF...")}</p>
            )}
            {!gifError && !gifLoading && gifResults.length === 0 && (
              <p className="tf-gif-feedback">{t("No GIFs found. Try another keyword.", "没有找到 GIF，换个关键词试试。")}</p>
            )}

            <div className="tf-gif-grid">
              {gifResults.map((gif) => (
                <button
                  key={gif.id}
                  type="button"
                  className="tf-gif-tile"
                  style={{ aspectRatio: `${gif.width} / ${gif.height}` }}
                  onClick={() => {
                    if (!gifPickerPostId) {
                      return;
                    }
                    insertGifToPost(gifPickerPostId, gif);
                  }}
                  title={gif.title}
                >
                  <img src={gif.previewUrl} alt={gif.title} loading="lazy" />
                </button>
              ))}
            </div>

            <footer className="tf-gif-footer">
              <span>{t("Powered by Tenor", "由 Tenor 提供")}</span>
              {gifNextPos && (
                <button
                  type="button"
                  onClick={() =>
                    void fetchTenorGifs({
                      query: gifQuery,
                      append: true,
                      pos: gifNextPos
                    })
                  }
                  disabled={gifLoading}
                >
                  {gifLoading ? t("Loading...", "加载中...") : t("Load more", "加载更多")}
                </button>
              )}
            </footer>
          </section>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        className="tf-hidden-input"
        onChange={handleUploadChange}
      />

      {notice && <p className="tf-toast">{notice}</p>}
    </div>
  );
}

function extractArticleHeading(html: string): { title: string; subtitle: string } {
  const parsed = splitArticleBlocks(html);
  return {
    title: parsed.title,
    subtitle: parsed.subtitle
  };
}

function splitArticleBlocks(html: string): {
  title: string;
  subtitle: string;
  bodyHtml: string;
} {
  if (typeof window === "undefined") {
    return {
      title: "",
      subtitle: "",
      bodyHtml: normalizeRichHtml(html)
    };
  }

  const container = window.document.createElement("div");
  container.innerHTML = normalizeRichHtml(html);

  let title = "";
  let subtitle = "";

  const firstH1 = container.querySelector("h1");
  if (firstH1) {
    title = (firstH1.textContent ?? "").trim();
    firstH1.remove();
  }

  const firstH2 = container.querySelector("h2");
  if (firstH2) {
    subtitle = (firstH2.textContent ?? "").trim();
    firstH2.remove();
  }

  let bodyHtml = container.innerHTML.trim();
  if (!bodyHtml) {
    bodyHtml = "<p><br></p>";
  }

  return {
    title,
    subtitle,
    bodyHtml
  };
}

function buildArticleHtml(title: string, subtitle: string, bodyHtml: string): string {
  const parts: string[] = [];
  const normalizedBody = bodyHtml.trim() || "<p><br></p>";

  if (title.trim()) {
    parts.push(`<h1>${escapeHtml(title.trim())}</h1>`);
  }
  if (subtitle.trim()) {
    parts.push(`<h2>${escapeHtml(subtitle.trim())}</h2>`);
  }
  parts.push(normalizedBody);

  return normalizeRichHtml(parts.join(""));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clonePosts(posts: WorkspaceState["drafts"][number]["posts"]) {
  return posts.map((post) => ({
    id: post.id,
    text: post.text,
    media: (post.media ?? []).map((item) => ({
      id: item.id,
      type: item.type,
      name: item.name,
      url: item.url
    })),
    poll: post.poll
      ? {
          question: post.poll.question,
          options: [...post.poll.options]
        }
      : undefined
  }));
}

function serializeDraftSignature(draft: WorkspaceState["drafts"][number]): string {
  return JSON.stringify({
    kind: draft.kind,
    title: draft.title,
    topic: draft.topic ?? "",
    posts: draft.posts.map((post) => ({
      text: post.text,
      media: (post.media ?? []).map((item) => ({
        type: item.type,
        name: item.name
      })),
      poll: post.poll ?? null
    }))
  });
}

function nextManualSnapshotLabel(list: DraftSnapshot[]): string {
  const maxIndex = list.reduce((max, item) => {
    const matched = item.label.match(/^手动保存(\d+)$/);
    if (!matched) {
      return max;
    }
    const value = Number(matched[1]);
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);
  return `手动保存${maxIndex + 1}`;
}

function formatSnapshotTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

function isTimestampSnapshotLabel(label: string): boolean {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(label);
}

function kindIcon(kind: DraftKind): string {
  if (kind === "tweet") {
    return "T";
  }
  if (kind === "article") {
    return "A";
  }
  return "H";
}

function formatRelativeTime(value: string, locale: UiLocale): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) {
    return locale === "zh" ? "刚刚" : "just now";
  }
  if (diffMin < 60) {
    return locale === "zh" ? `${diffMin} 分钟前` : `${diffMin}m ago`;
  }
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) {
    return locale === "zh" ? `${diffHour} 小时前` : `${diffHour}h ago`;
  }
  const diffDay = Math.floor(diffHour / 24);
  return locale === "zh" ? `${diffDay} 天前` : `${diffDay}d ago`;
}

function formatSavedClock(value: string, locale: UiLocale): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return locale === "zh" ? `${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}

type AuthorIdentity = {
  signedIn: boolean;
  name: string;
  username: string;
  handle: string;
  image: string | null;
  initial: string;
};

function resolveAuthorIdentity(session: Session | null | undefined): AuthorIdentity {
  const fallbackName = "xuegao";
  const fallbackUsername = "0xuegao";
  const name = cleanDisplayName(session?.user?.name) ?? fallbackName;
  const username =
    normalizeUsername(session?.user?.username) ?? normalizeUsername(name) ?? fallbackUsername;
  const handle = `@${username}`;
  const image = session?.user?.image?.trim() || null;
  return {
    signedIn: !!session?.user,
    name,
    username,
    handle,
    image,
    initial: takeInitial(name)
  };
}

function cleanDisplayName(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeUsername(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value
    .trim()
    .replace(/^@+/, "")
    .replace(/[^A-Za-z0-9_]/g, "");
  return normalized.length > 0 ? normalized : null;
}

function takeInitial(value: string): string {
  const head = value.trim().charAt(0);
  return head ? head.toLowerCase() : "x";
}

function formatCompactPreviewNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(Math.max(0, value));
}

function snapshotPreviewText(snapshot: DraftSnapshot, locale: UiLocale): string {
  const firstText =
    snapshot.posts
      .map((post) => toLintText(post.text).replace(/\s+/g, " ").trim())
      .find((value) => value.length > 0) ?? "";
  if (!firstText) {
    return locale === "zh" ? "空内容" : "Empty content";
  }
  const limit = snapshot.kind === "article" ? 120 : 92;
  if (firstText.length <= limit) {
    return firstText;
  }
  return `${firstText.slice(0, limit).trimEnd()}...`;
}

function RichEditor({
  value,
  variant,
  locale,
  onChange,
  onFocus,
  bindRef
}: {
  value: string;
  variant: DraftKind;
  locale: UiLocale;
  onChange: (next: string) => void;
  onFocus: () => void;
  bindRef: (el: HTMLDivElement | null) => void;
}) {
  const internalRef = useRef<HTMLDivElement | null>(null);
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
    />
  );
}

