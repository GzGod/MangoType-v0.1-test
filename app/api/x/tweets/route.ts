import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

type PublishTweetBody = {
  text?: string;
  replyToId?: string;
  mediaIds?: string[];
};

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json(
      {
        error: "unauthorized",
        message: "Missing X access token. Sign in with X first."
      },
      { status: 401 }
    );
  }

  let payload: PublishTweetBody = {};
  try {
    payload = (await request.json()) as PublishTweetBody;
  } catch {
    return NextResponse.json(
      {
        error: "invalid_json",
        message: "Invalid request body."
      },
      { status: 400 }
    );
  }

  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text) {
    return NextResponse.json(
      {
        error: "missing_text",
        message: "Tweet text is required."
      },
      { status: 400 }
    );
  }

  const body: Record<string, unknown> = { text };
  if (typeof payload.replyToId === "string" && payload.replyToId.trim()) {
    body.reply = { in_reply_to_tweet_id: payload.replyToId.trim() };
  }
  if (Array.isArray(payload.mediaIds) && payload.mediaIds.length > 0) {
    const media_ids = payload.mediaIds
      .map((item) => String(item).trim())
      .filter(Boolean)
      .slice(0, 4);
    if (media_ids.length > 0) {
      body.media = { media_ids };
    }
  }

  const response = await fetch("https://api.x.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    cache: "no-store"
  });

  let responseData: unknown = null;
  try {
    responseData = await response.json();
  } catch {
    responseData = null;
  }

  if (!response.ok) {
    return NextResponse.json(
      {
        error: "x_publish_failed",
        status: response.status,
        details: responseData
      },
      { status: response.status }
    );
  }

  return NextResponse.json(responseData, { status: 200 });
}

