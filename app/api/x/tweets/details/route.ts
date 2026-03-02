import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { authOptions } from "@/lib/auth";

type XMetricsBucket = Record<string, unknown> | undefined;

type XMediaEntity = {
  media_key?: string;
  type?: string;
  url?: string;
  preview_image_url?: string;
  width?: number;
  height?: number;
};

type XTweetEntity = {
  id?: string;
  text?: string;
  created_at?: string;
  attachments?: {
    media_keys?: string[];
  };
  public_metrics?: XMetricsBucket;
  organic_metrics?: XMetricsBucket;
  non_public_metrics?: XMetricsBucket;
};

type XGetTweetsResponse = {
  data?: XTweetEntity[];
  includes?: {
    media?: XMediaEntity[];
  };
  errors?: Array<{
    message?: string;
    detail?: string;
  }>;
};

type TweetDetailMedia = {
  id: string;
  type: "image" | "gif" | "video";
  name: string;
  url?: string;
};

type TweetDetailItem = {
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
  media: TweetDetailMedia[];
};

function toInt(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function pickMetricValue(bucket: XMetricsBucket, keys: string[]): number {
  if (!bucket) {
    return 0;
  }
  for (const key of keys) {
    if (key in bucket) {
      return toInt(bucket[key]);
    }
  }
  return 0;
}

function normalizeTweetIds(value: string | null): string[] {
  if (!value) {
    return [];
  }
  const ids = value
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^\d{4,30}$/.test(id));
  return Array.from(new Set(ids)).slice(0, 25);
}

function mapMediaType(type: string | undefined): "image" | "gif" | "video" {
  if (type === "animated_gif") {
    return "gif";
  }
  if (type === "video") {
    return "video";
  }
  return "image";
}

function mapTweetDetail(tweet: XTweetEntity, mediaByKey: Map<string, XMediaEntity>): TweetDetailItem | null {
  const tweetId = typeof tweet.id === "string" ? tweet.id.trim() : "";
  if (!tweetId) {
    return null;
  }

  const nonPublic = tweet.non_public_metrics;
  const organic = tweet.organic_metrics;
  const pub = tweet.public_metrics;

  const likes =
    pickMetricValue(nonPublic, ["like_count"]) ||
    pickMetricValue(organic, ["like_count"]) ||
    pickMetricValue(pub, ["like_count"]);
  const reposts =
    pickMetricValue(nonPublic, ["retweet_count"]) ||
    pickMetricValue(organic, ["retweet_count"]) ||
    pickMetricValue(pub, ["retweet_count"]);
  const replies =
    pickMetricValue(nonPublic, ["reply_count"]) ||
    pickMetricValue(organic, ["reply_count"]) ||
    pickMetricValue(pub, ["reply_count"]);
  const quotes =
    pickMetricValue(nonPublic, ["quote_count"]) ||
    pickMetricValue(organic, ["quote_count"]) ||
    pickMetricValue(pub, ["quote_count"]);
  const bookmarks =
    pickMetricValue(nonPublic, ["bookmark_count"]) ||
    pickMetricValue(organic, ["bookmark_count"]) ||
    pickMetricValue(pub, ["bookmark_count"]);
  const impressions =
    pickMetricValue(nonPublic, ["impression_count"]) ||
    pickMetricValue(organic, ["impression_count"]) ||
    pickMetricValue(pub, ["impression_count"]);
  const profileClicks =
    pickMetricValue(nonPublic, ["user_profile_clicks"]) ||
    pickMetricValue(organic, ["user_profile_clicks"]);

  const engagement = likes + reposts + replies + quotes + bookmarks + profileClicks;
  const engagementRate = impressions > 0 ? Math.round((engagement / impressions) * 10000) / 100 : 0;

  const mediaKeys = Array.isArray(tweet.attachments?.media_keys) ? tweet.attachments?.media_keys : [];
  const media = mediaKeys
    .map((mediaKey, index) => {
      const entity = mediaByKey.get(mediaKey);
      if (!entity) {
        return null;
      }
      const type = mapMediaType(entity.type);
      const mediaUrl = (entity.url ?? entity.preview_image_url)?.trim();
      const mapped: TweetDetailMedia = {
        id: mediaKey,
        type,
        name: `media-${index + 1}`,
        ...(mediaUrl && mediaUrl.length > 0 ? { url: mediaUrl } : {})
      };
      return mapped;
    })
    .filter((item): item is TweetDetailMedia => item !== null);

  return {
    id: tweetId,
    text: typeof tweet.text === "string" ? tweet.text : "",
    createdAt: typeof tweet.created_at === "string" ? tweet.created_at : "",
    metrics: {
      likes,
      reposts,
      replies,
      quotes,
      bookmarks,
      impressions,
      profileClicks,
      engagementRate
    },
    media
  };
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET
  });

  const accessToken =
    (typeof session?.accessToken === "string" && session.accessToken.trim()) ||
    (typeof token?.accessToken === "string" && token.accessToken.trim()) ||
    "";

  if (!accessToken) {
    return NextResponse.json(
      {
        error: "unauthorized",
        message: "Missing or expired X access token. Sign in with X again."
      },
      { status: 401 }
    );
  }

  const tweetIds = normalizeTweetIds(request.nextUrl.searchParams.get("ids"));
  if (tweetIds.length === 0) {
    return NextResponse.json(
      {
        error: "invalid_ids",
        message: "Query parameter ids is required."
      },
      { status: 400 }
    );
  }

  const xUrl = new URL("https://api.x.com/2/tweets");
  xUrl.searchParams.set("ids", tweetIds.join(","));
  xUrl.searchParams.set(
    "tweet.fields",
    "created_at,public_metrics,organic_metrics,non_public_metrics,attachments"
  );
  xUrl.searchParams.set("expansions", "attachments.media_keys");
  xUrl.searchParams.set("media.fields", "media_key,type,url,preview_image_url,width,height");

  const response = await fetch(xUrl.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store"
  });

  const payload = (await response.json().catch(() => null)) as XGetTweetsResponse | null;
  if (!response.ok) {
    return NextResponse.json(
      {
        error: "x_tweet_details_failed",
        status: response.status,
        details: payload
      },
      { status: response.status }
    );
  }

  const mediaByKey = new Map<string, XMediaEntity>();
  const medias = Array.isArray(payload?.includes?.media) ? payload?.includes?.media : [];
  medias.forEach((media) => {
    if (typeof media.media_key === "string" && media.media_key.trim()) {
      mediaByKey.set(media.media_key.trim(), media);
    }
  });

  const data = Array.isArray(payload?.data) ? payload.data : [];
  const tweetById = new Map<string, XTweetEntity>();
  data.forEach((tweet) => {
    if (typeof tweet.id === "string" && tweet.id.trim()) {
      tweetById.set(tweet.id.trim(), tweet);
    }
  });

  const tweets = tweetIds
    .map((id) => {
      const tweet = tweetById.get(id);
      if (!tweet) {
        return null;
      }
      return mapTweetDetail(tweet, mediaByKey);
    })
    .filter((item): item is TweetDetailItem => item !== null);

  return NextResponse.json(
    {
      tweets,
      errors: payload?.errors ?? []
    },
    { status: 200 }
  );
}
