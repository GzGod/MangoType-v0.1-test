import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { authOptions } from "@/lib/auth";

type PublishTweetBody = {
  text?: string;
  replyToId?: string;
  mediaIds?: string[];
};

export async function POST(request: NextRequest) {
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
      Authorization: `Bearer ${accessToken}`,
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
