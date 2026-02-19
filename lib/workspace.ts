import {
  createDefaultRuleState,
  DEFAULT_WHITELIST,
  type RuleState
} from "@/lib/rule-engine";
import { toRichHtml, type TweetFormatMode } from "@/lib/formatting";

export type ActiveView = "compose" | "calendar" | "analytics" | "preview";
export type DraftKind = "tweet" | "thread" | "article";
export type QueueStatus = "pending" | "failed";

const DEFAULT_QUEUE_MAX_ATTEMPTS = 3;
const MAX_ACTIVITY_LOGS = 80;

export interface ThreadPost {
  id: string;
  text: string;
  media?: Array<{
    id: string;
    type: "image" | "video" | "gif";
    name: string;
  }>;
  poll?: {
    question: string;
    options: string[];
  };
}

export interface DraftItem {
  id: string;
  kind: DraftKind;
  title: string;
  posts: ThreadPost[];
  selectedPostId: string;
  createdAt: string;
  updatedAt: string;
}

export interface QueueItem {
  id: string;
  publishAt: string;
  createdAt: string;
  updatedAt: string;
  preview: string;
  postCount: number;
  posts: ThreadPost[];
  sourceDraftId?: string;
  draftKind?: DraftKind;
  status: QueueStatus;
  attemptCount: number;
  maxAttempts: number;
  lastAttemptAt?: string;
  nextRetryAt?: string;
  lastError?: string;
}

export interface PostMetrics {
  impressions: number;
  likes: number;
  reposts: number;
  replies: number;
  bookmarks: number;
  profileClicks: number;
  engagementRate: number;
}

export interface PublishedItem {
  id: string;
  sourceQueueId: string;
  publishedAt: string;
  preview: string;
  postCount: number;
  posts: ThreadPost[];
  sourceDraftId?: string;
  draftKind?: DraftKind;
  metrics: PostMetrics;
}

export interface ActivityLog {
  id: string;
  at: string;
  level: "info" | "warn" | "error";
  event: string;
  message: string;
  queueItemId?: string;
  draftId?: string;
}

export interface WorkspaceState {
  activeView: ActiveView;
  drafts: DraftItem[];
  selectedDraftId: string;
  queue: QueueItem[];
  published: PublishedItem[];
  activity: ActivityLog[];
  scheduleAt: string;
  tweetFormatMode: TweetFormatMode;
  ruleState: RuleState;
  whitelistInput: string;
}

export interface QueueRunResult {
  remaining: QueueItem[];
  published: PublishedItem[];
  activity: ActivityLog[];
  attempted: number;
  succeeded: number;
  failed: number;
}

interface LegacyWorkspacePayload {
  thread?: ThreadPost[];
  selectedId?: string;
  queue?: Array<{
    id: string;
    publishAt: string;
    createdAt?: string;
    updatedAt?: string;
    preview: string;
    postCount: number;
    posts?: ThreadPost[];
    sourceDraftId?: string;
    draftKind?: DraftKind;
    status?: QueueStatus;
    attemptCount?: number;
    maxAttempts?: number;
    lastAttemptAt?: string;
    nextRetryAt?: string;
    lastError?: string;
  }>;
  scheduleAt?: string;
  ruleState?: RuleState;
  whitelistInput?: string;
  activity?: ActivityLog[];
}

export const WORKSPACE_STORAGE_KEY = "hanfully_v2_workspace_state";
export const LEGACY_STORAGE_KEY = "hanfully_v1_compose_state";

export const DRAFT_KIND_LABELS: Record<DraftKind, string> = {
  tweet: "Tweet",
  thread: "Thread",
  article: "Article"
};

const DEFAULT_SAMPLE_THREAD = [
  "This is a sample thread draft. Edit this line to start.",
  "Second tweet: share one useful point with your audience.",
  "Third tweet: end with a clear call to action."
];

const DEFAULT_SAMPLE_ARTICLE = `<h1>Article title</h1><h2>Subtitle</h2><p>Write your article body here...</p>`;

export function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getDefaultSchedule(hoursLater = 1): string {
  const date = new Date(Date.now() + hoursLater * 60 * 60 * 1000);
  date.setSeconds(0, 0);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

export function createDraft(
  kind: DraftKind,
  overrides: Partial<DraftItem> = {}
): DraftItem {
  const now = new Date().toISOString();
  const posts = normalizePosts(overrides.posts ?? createInitialPosts(kind));
  const selectedPostId = posts.some((post) => post.id === overrides.selectedPostId)
    ? (overrides.selectedPostId as string)
    : posts[0].id;

  return {
    id: overrides.id ?? createId(),
    kind,
    title: resolveDraftTitle(overrides.title, kind),
    posts,
    selectedPostId,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now
  };
}

export function createDefaultWorkspaceState(): WorkspaceState {
  const firstDraft = createDraft("thread", { title: "Welcome Thread" });
  return {
    activeView: "compose",
    drafts: [firstDraft],
    selectedDraftId: firstDraft.id,
    queue: [],
    published: [],
    activity: [],
    scheduleAt: getDefaultSchedule(),
    tweetFormatMode: "unicode",
    ruleState: createDefaultRuleState(),
    whitelistInput: DEFAULT_WHITELIST.join(", ")
  };
}

export function normalizeWorkspaceState(
  payload: Partial<WorkspaceState> & Partial<LegacyWorkspacePayload>
): WorkspaceState {
  const defaults = createDefaultWorkspaceState();
  const normalizedDrafts = normalizeDrafts(payload, defaults);
  const selectedDraftId = normalizedDrafts.some(
    (draft) => draft.id === payload.selectedDraftId
  )
    ? (payload.selectedDraftId as string)
    : normalizedDrafts[0].id;

  return {
    ...defaults,
    ...payload,
    drafts: normalizedDrafts,
    selectedDraftId,
    queue: (payload.queue ?? []).map(normalizeQueueItem).sort(sortQueueAsc),
    published: (payload.published ?? []).slice().sort(sortPublishedDesc),
    activity: normalizeActivityLogs(payload.activity),
    ruleState: { ...defaults.ruleState, ...(payload.ruleState ?? {}) }
  };
}

export function migrateLegacyState(raw: string): WorkspaceState | null {
  try {
    const old = JSON.parse(raw) as LegacyWorkspacePayload;
    const fallbackDraft = createDraft("thread");
    const posts = normalizePosts(old.thread ?? fallbackDraft.posts);
    const selectedPostId = posts.some((post) => post.id === old.selectedId)
      ? (old.selectedId as string)
      : posts[0].id;
    const legacyDraft = createDraft("thread", {
      title: "Imported Thread",
      posts,
      selectedPostId
    });
    const legacyQueue =
      old.queue?.map((item) => ({
        id: item.id,
        publishAt: item.publishAt,
        createdAt: item.createdAt ?? new Date().toISOString(),
        updatedAt: item.updatedAt ?? new Date().toISOString(),
        preview: item.preview,
        postCount: item.postCount,
        posts: item.posts ?? legacyDraft.posts,
        sourceDraftId: item.sourceDraftId ?? legacyDraft.id,
        draftKind: item.draftKind ?? ("thread" as DraftKind),
        status: item.status ?? "pending",
        attemptCount: item.attemptCount ?? 0,
        maxAttempts: item.maxAttempts ?? DEFAULT_QUEUE_MAX_ATTEMPTS,
        lastAttemptAt: item.lastAttemptAt,
        nextRetryAt: item.nextRetryAt,
        lastError: item.lastError
      })) ?? [];

    return normalizeWorkspaceState({
      drafts: [legacyDraft],
      selectedDraftId: legacyDraft.id,
      scheduleAt: old.scheduleAt ?? getDefaultSchedule(),
      queue: legacyQueue,
      activity: old.activity,
      ruleState: old.ruleState,
      whitelistInput: old.whitelistInput
    });
  } catch {
    return null;
  }
}

export function buildQueueItem(
  posts: ThreadPost[],
  scheduleAt: string,
  meta?: {
    sourceDraftId?: string;
    draftKind?: DraftKind;
  }
): QueueItem {
  const cleanPosts = normalizePosts(posts);
  return {
    id: createId(),
    publishAt: scheduleAt,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    preview: buildPreview(cleanPosts),
    postCount: cleanPosts.length,
    posts: cleanPosts.map((post) => ({ ...post })),
    sourceDraftId: meta?.sourceDraftId,
    draftKind: meta?.draftKind,
    status: "pending",
    attemptCount: 0,
    maxAttempts: DEFAULT_QUEUE_MAX_ATTEMPTS
  };
}

export function publishQueueItem(item: QueueItem): PublishedItem {
  const metrics = generateMockMetrics(item);
  return {
    id: createId(),
    sourceQueueId: item.id,
    publishedAt: new Date().toISOString(),
    preview: item.preview,
    postCount: item.postCount,
    posts: item.posts.map((post) => ({ ...post })),
    sourceDraftId: item.sourceDraftId,
    draftKind: item.draftKind,
    metrics
  };
}

export function runDueQueue(queue: QueueItem[]): QueueRunResult {
  const nowIso = new Date().toISOString();
  const now = new Date(nowIso).getTime();
  const remaining: QueueItem[] = [];
  const published: PublishedItem[] = [];
  const activity: ActivityLog[] = [];
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;

  queue.forEach((item) => {
    const isPendingDue = item.status === "pending" && new Date(item.publishAt).getTime() <= now;
    const isRetryDue =
      item.status === "failed" &&
      !!item.nextRetryAt &&
      new Date(item.nextRetryAt).getTime() <= now &&
      item.attemptCount < item.maxAttempts;
    if (!isPendingDue && !isRetryDue) {
      remaining.push(item);
      return;
    }

    attempted += 1;
    const nextAttempt = item.attemptCount + 1;
    const attemptedItem: QueueItem = {
      ...item,
      attemptCount: nextAttempt,
      lastAttemptAt: nowIso,
      updatedAt: nowIso
    };

    if (!shouldFailQueueAttempt(attemptedItem)) {
      succeeded += 1;
      published.push(publishQueueItem(attemptedItem));
      activity.push(
        createActivityLog({
          level: "info",
          event: "queue_publish_succeeded",
          message: `Published scheduled ${DRAFT_KIND_LABELS[item.draftKind ?? "thread"].toLowerCase()} (${item.preview.slice(0, 36)}).`,
          queueItemId: item.id,
          draftId: item.sourceDraftId
        })
      );
      return;
    }

    failed += 1;
    const retriesRemaining = nextAttempt < item.maxAttempts;
    const retryAt = retriesRemaining ? computeRetryTimeIso(nowIso, nextAttempt) : undefined;
    const failedItem: QueueItem = {
      ...attemptedItem,
      status: "failed",
      nextRetryAt: retryAt,
      lastError: retriesRemaining
        ? "Temporary delivery failure. Auto retry scheduled."
        : "Max retries reached. Manual retry required."
    };
    remaining.push(failedItem);
    activity.push(
      createActivityLog({
        level: retriesRemaining ? "warn" : "error",
        event: retriesRemaining ? "queue_retry_scheduled" : "queue_retry_exhausted",
        message: retriesRemaining
          ? `Publish failed, retry #${nextAttempt + 1} at ${formatDateTime(retryAt as string)}.`
          : `Publish failed after ${nextAttempt} attempts.`,
        queueItemId: item.id,
        draftId: item.sourceDraftId
      })
    );
  });

  return {
    remaining: remaining.sort(sortQueueAsc),
    published: published.sort(sortPublishedDesc),
    activity,
    attempted,
    succeeded,
    failed
  };
}

export function retryQueueItem(item: QueueItem): QueueItem {
  const nowIso = new Date().toISOString();
  return {
    ...item,
    status: "pending",
    publishAt: nowIso,
    updatedAt: nowIso,
    attemptCount: 0,
    lastAttemptAt: undefined,
    nextRetryAt: undefined,
    lastError: undefined
  };
}

export function createActivityLog(input: Omit<ActivityLog, "id" | "at"> & { at?: string }): ActivityLog {
  return {
    id: createId(),
    at: input.at ?? new Date().toISOString(),
    level: input.level,
    event: input.event,
    message: input.message,
    queueItemId: input.queueItemId,
    draftId: input.draftId
  };
}

export function appendActivityLogs(
  current: ActivityLog[],
  incoming: ActivityLog[],
  limit = MAX_ACTIVITY_LOGS
): ActivityLog[] {
  return [...incoming, ...current]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit);
}

export function sortQueueAsc(a: QueueItem, b: QueueItem): number {
  const aSortAt =
    a.status === "failed" && a.nextRetryAt ? new Date(a.nextRetryAt).getTime() : new Date(a.publishAt).getTime();
  const bSortAt =
    b.status === "failed" && b.nextRetryAt ? new Date(b.nextRetryAt).getTime() : new Date(b.publishAt).getTime();
  return aSortAt - bSortAt;
}

export function sortPublishedDesc(a: PublishedItem, b: PublishedItem): number {
  return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
}

export function formatDateTime(value: string): string {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
}

export function formatMonthLabel(value: string): string {
  const date = new Date(`${value}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function normalizeDrafts(
  payload: Partial<WorkspaceState> & Partial<LegacyWorkspacePayload>,
  defaults: WorkspaceState
): DraftItem[] {
  if (payload.drafts?.length) {
    return payload.drafts.map(normalizeDraft);
  }

  if (payload.thread?.length) {
    return [
      normalizeDraft(
        createDraft("thread", {
          title: "Imported Thread",
          posts: payload.thread,
          selectedPostId: payload.selectedId
        })
      )
    ];
  }

  return defaults.drafts;
}

function normalizeQueueItem(input: QueueItem): QueueItem {
  const createdAt = input.createdAt || new Date().toISOString();
  const updatedAt = input.updatedAt || createdAt;
  const maxAttempts =
    Number.isFinite(input.maxAttempts) && input.maxAttempts > 0
      ? Math.floor(input.maxAttempts)
      : DEFAULT_QUEUE_MAX_ATTEMPTS;
  const attemptCount =
    Number.isFinite(input.attemptCount) && input.attemptCount >= 0
      ? Math.max(0, Math.floor(input.attemptCount))
      : 0;
  return {
    ...input,
    createdAt,
    updatedAt,
    status: input.status === "failed" ? "failed" : "pending",
    attemptCount,
    maxAttempts,
    posts: normalizePosts(input.posts ?? []),
    postCount:
      Number.isFinite(input.postCount) && input.postCount > 0
        ? Math.floor(input.postCount)
        : Math.max(1, (input.posts ?? []).length),
    preview: typeof input.preview === "string" && input.preview.trim().length > 0
      ? input.preview
      : buildPreview(input.posts ?? []),
    publishAt: input.publishAt || getDefaultSchedule(),
    lastError: typeof input.lastError === "string" ? input.lastError : undefined,
    lastAttemptAt: input.lastAttemptAt,
    nextRetryAt: input.nextRetryAt
  };
}

function normalizeActivityLogs(items: ActivityLog[] | undefined): ActivityLog[] {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }
  return items
    .filter((item): item is ActivityLog => !!item && typeof item.message === "string")
    .map((item) => ({
      id: item.id || createId(),
      at: item.at || new Date().toISOString(),
      level:
        item.level === "warn" || item.level === "error" || item.level === "info"
          ? item.level
          : "info",
      event: item.event || "unknown",
      message: item.message,
      queueItemId: item.queueItemId,
      draftId: item.draftId
    }))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, MAX_ACTIVITY_LOGS);
}

function normalizeDraft(input: DraftItem): DraftItem {
  const kind = input.kind ?? "thread";
  const posts = normalizePosts(input.posts ?? []);
  const selectedPostId = posts.some((post) => post.id === input.selectedPostId)
    ? input.selectedPostId
    : posts[0].id;
  return {
    ...input,
    kind,
    title: resolveDraftTitle(input.title, kind),
    posts,
    selectedPostId,
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString()
  };
}

function resolveDraftTitle(title: unknown, kind: DraftKind): string {
  if (typeof title !== "string") {
    return defaultDraftTitle(kind);
  }
  return title;
}

function normalizePosts(posts: ThreadPost[]): ThreadPost[] {
  if (!posts.length) {
    return [{ id: createId(), text: "<p><br></p>" }];
  }
  return posts.map((item) => ({
    id: item.id || createId(),
    text: toRichHtml(item.text || ""),
    media: (item.media ?? []).map((media) => ({
      id: media.id || createId(),
      type: media.type,
      name: media.name || "media"
    })),
    poll: item.poll
      ? {
          question: item.poll.question || "Poll question",
          options:
            item.poll.options?.filter((option) => option.trim().length > 0).slice(0, 4) ?? []
        }
      : undefined
  }));
}

function createInitialPosts(kind: DraftKind): ThreadPost[] {
  if (kind === "thread") {
    return DEFAULT_SAMPLE_THREAD.map((text) => ({ id: createId(), text: toRichHtml(text) }));
  }
  if (kind === "article") {
    return [{ id: createId(), text: toRichHtml(DEFAULT_SAMPLE_ARTICLE) }];
  }
  return [{ id: createId(), text: "<p><br></p>" }];
}

function defaultDraftTitle(kind: DraftKind): string {
  if (kind === "thread") {
    return "Untitled Thread";
  }
  if (kind === "article") {
    return "Untitled Article";
  }
  return "Untitled Tweet";
}

function shouldFailQueueAttempt(item: QueueItem): boolean {
  const seed = hashString(`${item.id}-${item.preview}`);
  if (item.attemptCount <= 1) {
    return seed % 7 === 0;
  }
  if (item.attemptCount === 2) {
    return seed % 31 === 0;
  }
  return false;
}

function computeRetryTimeIso(fromIso: string, attempt: number): string {
  const retryMinutes = [2, 10, 30];
  const index = Math.max(0, Math.min(retryMinutes.length - 1, attempt - 1));
  const next = new Date(new Date(fromIso).getTime() + retryMinutes[index] * 60 * 1000);
  return next.toISOString();
}

function stripHtml(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|h3|blockquote|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\u00a0/g, " ");
}

function buildPreview(posts: ThreadPost[]): string {
  const first = posts
    .map((post) => stripHtml(post.text).trim())
    .find((value) => value.length > 0);
  return first?.replace(/\s+/g, " ").slice(0, 80) ?? "(Empty)";
}

function generateMockMetrics(item: QueueItem): PostMetrics {
  const seed = hashString(`${item.id}-${item.publishAt}-${item.preview}`);
  const allText = item.posts.map((post) => stripHtml(post.text)).join(" ");
  const charCount = allText.length;
  const baseline = 1200 + (seed % 3800);
  const readabilityBoost = Math.max(0.82, 1.2 - Math.max(0, charCount - 800) / 2500);
  const threadBoost = Math.min(1.22, 0.95 + item.postCount * 0.04);
  const impressions = Math.round(baseline * readabilityBoost * threadBoost);
  const likes = Math.round(impressions * (0.018 + ((seed >> 3) % 18) / 1000));
  const reposts = Math.round(impressions * (0.004 + ((seed >> 5) % 7) / 1000));
  const replies = Math.round(impressions * (0.003 + ((seed >> 7) % 6) / 1000));
  const bookmarks = Math.round(impressions * (0.002 + ((seed >> 11) % 5) / 1000));
  const profileClicks = Math.round(impressions * (0.001 + ((seed >> 13) % 4) / 1000));
  const engagement = likes + reposts + replies + bookmarks + profileClicks;
  const engagementRate = impressions > 0 ? round((engagement / impressions) * 100, 2) : 0;

  return {
    impressions,
    likes,
    reposts,
    replies,
    bookmarks,
    profileClicks,
    engagementRate
  };
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
