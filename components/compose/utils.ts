import type { Session } from "next-auth";
import { normalizeRichHtml, toLintText } from "@/lib/formatting";
import {
  DRAFT_KIND_LABELS,
  type DraftKind,
  type WorkspaceState
} from "@/lib/workspace";
import type {
  AuthorIdentity,
  DraftPostMedia,
  DraftSnapshot,
  TenorGifApiItem,
  TenorGifTile,
  UiLocale,
  UiTheme,
  XMediaUploadResponse,
  XPublishResponse,
  XTweetDetailsResponse
} from "@/components/compose/types";

export function draftKindLabel(kind: DraftKind, locale: UiLocale): string {
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

export function draftOptionCopy(
  kind: DraftKind,
  locale: UiLocale
): { title: string; description: string } {
  if (locale === "zh") {
    if (kind === "tweet") {
      return { title: "推文", description: "单条发布。" };
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

export function themeLabel(theme: UiTheme, locale: UiLocale): string {
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

export function mapTenorResults(items: TenorGifApiItem[]): TenorGifTile[] {
  return items
    .map((item) => {
      const media = item.media?.[0];
      const animated = media?.gif ?? media?.tinygif ?? media?.mediumgif ?? media?.nanogif;
      if (!animated?.url) {
        return null;
      }
      const previewUrl = media?.tinygif?.url ?? animated.preview ?? animated.url;
      const dims =
        normalizeTenorDims(animated.dims) ?? normalizeTenorDims(media?.tinygif?.dims) ?? [320, 320];
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

export function mergeTenorResults(prev: TenorGifTile[], next: TenorGifTile[]): TenorGifTile[] {
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

export function normalizeTopicLabel(value: string | undefined): string {
  if (!value) {
    return "";
  }
  return value.replace(/\s+/g, " ").trim().slice(0, 28);
}

export function computeRetryTimeIso(fromIso: string, attempt: number): string {
  const retryMinutes = [2, 10, 30];
  const index = Math.max(0, Math.min(retryMinutes.length - 1, attempt - 1));
  const next = new Date(new Date(fromIso).getTime() + retryMinutes[index] * 60 * 1000);
  return next.toISOString();
}

export function resolveXPublishErrorMessage(
  payload: XPublishResponse | null,
  fallbackStatus: number,
  locale: UiLocale
): string {
  const detail = payload?.details;
  const firstDetailError = detail?.errors?.find((item) => typeof item.message === "string")?.message;
  const bestMessage = payload?.message ?? detail?.detail ?? firstDetailError ?? detail?.title ?? payload?.error;

  if (bestMessage && bestMessage.trim().length > 0) {
    return bestMessage;
  }

  return locale === "zh"
    ? `发布失败（HTTP ${fallbackStatus}）。`
    : `Publishing failed (HTTP ${fallbackStatus}).`;
}

export function resolveXMediaUploadErrorMessage(
  payload: XMediaUploadResponse | null,
  fallbackStatus: number,
  locale: UiLocale
): string {
  const bestMessage = payload?.message ?? payload?.error;
  if (bestMessage && bestMessage.trim().length > 0) {
    return bestMessage;
  }
  return locale === "zh"
    ? `媒体上传失败（HTTP ${fallbackStatus}）。`
    : `Media upload failed (HTTP ${fallbackStatus}).`;
}

export function resolveXTweetDetailsErrorMessage(
  payload: XTweetDetailsResponse | null,
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
    payload?.error ??
    payload?.errors?.find((item) => item.detail || item.message)?.detail ??
    payload?.errors?.find((item) => item.detail || item.message)?.message;

  if (bestMessage && bestMessage.trim().length > 0) {
    return bestMessage;
  }

  return locale === "zh"
    ? `读取推文详情失败（HTTP ${fallbackStatus}）。`
    : `Failed to load tweet details (HTTP ${fallbackStatus}).`;
}

export function inferMediaMimeType(media: DraftPostMedia): string {
  if (media.type === "gif") {
    return "image/gif";
  }
  if (media.type === "video") {
    return "video/mp4";
  }
  return "image/png";
}

export function extractArticleHeading(html: string): { title: string; subtitle: string } {
  const parsed = splitArticleBlocks(html);
  return {
    title: parsed.title,
    subtitle: parsed.subtitle
  };
}

export function splitArticleBlocks(html: string): {
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

export function buildArticleHtml(title: string, subtitle: string, bodyHtml: string): string {
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

export function clonePosts(posts: WorkspaceState["drafts"][number]["posts"]) {
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

export function serializeDraftSignature(draft: WorkspaceState["drafts"][number]): string {
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

export function nextManualSnapshotLabel(list: DraftSnapshot[]): string {
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

export function formatSnapshotTimestamp(iso: string): string {
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

export function isTimestampSnapshotLabel(label: string): boolean {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(label);
}

export function kindIcon(kind: DraftKind): string {
  if (kind === "tweet") {
    return "T";
  }
  if (kind === "article") {
    return "A";
  }
  return "H";
}

export function formatRelativeTime(value: string, locale: UiLocale): string {
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

export function formatSavedClock(value: string, locale: UiLocale): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return locale === "zh" ? `${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}

export function resolveAuthorIdentity(session: Session | null | undefined): AuthorIdentity {
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
  const normalized = value.trim().replace(/^@+/, "").replace(/[^A-Za-z0-9_]/g, "");
  return normalized.length > 0 ? normalized : null;
}

function takeInitial(value: string): string {
  const head = value.trim().charAt(0);
  return head ? head.toLowerCase() : "x";
}

export function formatCompactPreviewNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(Math.max(0, value));
}

export function snapshotPreviewText(snapshot: DraftSnapshot, locale: UiLocale): string {
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
