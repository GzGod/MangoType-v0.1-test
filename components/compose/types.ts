import type { DraftKind, WorkspaceState } from "@/lib/workspace";

export type PaneTab = "drafts" | "scheduled" | "posted";

export type PublishState =
  | "idle"
  | "blocked"
  | "scheduling"
  | "scheduled"
  | "publishing"
  | "published";

export type UiTheme = "signature" | "ink" | "sunset";
export type UiLocale = "en" | "zh";
export type WorkspaceSaveState = "saving" | "saved" | "failed";

export type QuickCommand = {
  id: string;
  label: string;
  hint: string;
  keywords: string;
  run: () => void | Promise<void>;
};

export type DraftTemplate = {
  id: string;
  name: string;
  kind: DraftKind;
  title: string;
  description: string;
  posts: string[];
};

export type DraftSnapshot = {
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

export type TenorMediaVariant = {
  url?: string;
  preview?: string;
  dims?: number[];
};

export type TenorGifApiItem = {
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

export type TenorGifApiResponse = {
  results?: TenorGifApiItem[];
  next?: string | number;
};

export type TenorGifTile = {
  id: string;
  title: string;
  gifUrl: string;
  previewUrl: string;
  width: number;
  height: number;
};

export type XPublishResponse = {
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

export type XMediaUploadResponse = {
  mediaId?: string;
  data?: {
    id?: string;
  };
  error?: string;
  message?: string;
};

export type XTweetDetail = {
  id: string;
  text: string;
  createdAt: string;
  metrics: {
    likes: number;
    reposts: number;
    replies: number;
    quotes: number;
    bookmarks: number;
    impressions: number;
    profileClicks: number;
    engagementRate: number;
  };
  media: Array<{
    id: string;
    type: "image" | "video" | "gif";
    name: string;
    url?: string;
  }>;
};

export type XTweetDetailsResponse = {
  tweets?: XTweetDetail[];
  errors?: Array<{
    message?: string;
    detail?: string;
  }>;
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

export type DraftPostMedia =
  NonNullable<WorkspaceState["drafts"][number]["posts"][number]["media"]>[number];

export type AiRewritePreset =
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

export type AuthorIdentity = {
  signedIn: boolean;
  name: string;
  username: string;
  handle: string;
  image: string | null;
  initial: string;
};
