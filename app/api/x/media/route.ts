import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { authOptions } from "@/lib/auth";

type UploadMediaJsonBody = {
  sourceUrl?: string;
  filename?: string;
  mimeType?: string;
  mediaType?: "image" | "video" | "gif";
};

type UploadSource = {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
  mediaType?: "image" | "video" | "gif";
};

const CHUNK_SIZE = 4 * 1024 * 1024;
const STATUS_MAX_POLLS = 8;

function getFallbackMimeType(mediaType?: "image" | "video" | "gif"): string {
  if (mediaType === "gif") {
    return "image/gif";
  }
  if (mediaType === "video") {
    return "video/mp4";
  }
  return "image/png";
}

function normalizeMediaCategory(source: UploadSource): "tweet_image" | "tweet_gif" | "tweet_video" {
  if (source.mediaType === "video" || source.mimeType.startsWith("video/")) {
    return "tweet_video";
  }
  if (source.mediaType === "gif" || source.mimeType === "image/gif") {
    return "tweet_gif";
  }
  return "tweet_image";
}

function normalizeMimeType(source: UploadSource): string {
  const mime = source.mimeType.trim().toLowerCase();
  if (mime.length > 0) {
    return mime;
  }
  return getFallbackMimeType(source.mediaType);
}

function pickFilename(source: UploadSource): string {
  const trimmed = source.filename.trim();
  if (trimmed.length > 0) {
    return trimmed.slice(0, 160);
  }
  const ext = source.mediaType === "video" ? "mp4" : source.mediaType === "gif" ? "gif" : "png";
  return `media-${Date.now()}.${ext}`;
}

function isSafeRemoteUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".local") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function readUploadSource(request: NextRequest): Promise<UploadSource> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new Error("missing_file");
    }
    const mediaTypeField = formData.get("mediaType");
    const mediaType =
      mediaTypeField === "image" || mediaTypeField === "video" || mediaTypeField === "gif"
        ? mediaTypeField
        : undefined;
    const bytes = new Uint8Array(await file.arrayBuffer());
    return {
      bytes,
      filename: file.name || "",
      mimeType: file.type || getFallbackMimeType(mediaType),
      mediaType
    };
  }

  let payload: UploadMediaJsonBody = {};
  try {
    payload = (await request.json()) as UploadMediaJsonBody;
  } catch {
    throw new Error("invalid_json");
  }

  const sourceUrl = typeof payload.sourceUrl === "string" ? payload.sourceUrl.trim() : "";
  if (!sourceUrl || !isSafeRemoteUrl(sourceUrl)) {
    throw new Error("invalid_source_url");
  }

  const remoteResponse = await fetch(sourceUrl, { method: "GET", cache: "no-store" });
  if (!remoteResponse.ok) {
    throw new Error(`remote_fetch_failed_${remoteResponse.status}`);
  }

  const bytes = new Uint8Array(await remoteResponse.arrayBuffer());
  const mimeFromRemote = remoteResponse.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  const mediaType =
    payload.mediaType === "image" || payload.mediaType === "video" || payload.mediaType === "gif"
      ? payload.mediaType
      : undefined;

  return {
    bytes,
    filename: payload.filename ?? "",
    mimeType: payload.mimeType?.trim() || mimeFromRemote || getFallbackMimeType(mediaType),
    mediaType
  };
}

async function uploadMediaToX(accessToken: string, source: UploadSource): Promise<string> {
  const mimeType = normalizeMimeType(source);
  const mediaCategory = normalizeMediaCategory({ ...source, mimeType });
  const filename = pickFilename(source);

  const initializeResponse = await fetch("https://api.x.com/2/media/upload/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      total_bytes: source.bytes.byteLength,
      media_type: mimeType,
      media_category: mediaCategory
    }),
    cache: "no-store"
  });

  const initializePayload = (await initializeResponse.json().catch(() => null)) as {
    data?: { id?: string | number };
    errors?: Array<{ detail?: string; message?: string }>;
  } | null;

  if (!initializeResponse.ok) {
    const detail =
      initializePayload?.errors?.find((item) => item.detail || item.message)?.detail ??
      initializePayload?.errors?.find((item) => item.detail || item.message)?.message ??
      `initialize_failed_${initializeResponse.status}`;
    throw new Error(detail);
  }

  const mediaIdValue = initializePayload?.data?.id;
  const mediaId = typeof mediaIdValue === "number" ? String(mediaIdValue) : mediaIdValue?.trim();
  if (!mediaId) {
    throw new Error("missing_media_id");
  }

  let segmentIndex = 0;
  for (let offset = 0; offset < source.bytes.byteLength; offset += CHUNK_SIZE) {
    const chunk = source.bytes.slice(offset, Math.min(offset + CHUNK_SIZE, source.bytes.byteLength));
    const formData = new FormData();
    formData.set("segment_index", String(segmentIndex));
    formData.set("media", new Blob([chunk], { type: mimeType }), filename);

    const appendResponse = await fetch(
      `https://api.x.com/2/media/upload/${encodeURIComponent(mediaId)}/append`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`
        },
        body: formData,
        cache: "no-store"
      }
    );

    if (!appendResponse.ok) {
      const appendPayload = (await appendResponse.json().catch(() => null)) as
        | { errors?: Array<{ detail?: string; message?: string }> }
        | null;
      const detail =
        appendPayload?.errors?.find((item) => item.detail || item.message)?.detail ??
        appendPayload?.errors?.find((item) => item.detail || item.message)?.message ??
        `append_failed_${appendResponse.status}`;
      throw new Error(detail);
    }

    segmentIndex += 1;
  }

  const finalizeResponse = await fetch(
    `https://api.x.com/2/media/upload/${encodeURIComponent(mediaId)}/finalize`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      cache: "no-store"
    }
  );

  const finalizePayload = (await finalizeResponse.json().catch(() => null)) as {
    data?: {
      id?: string;
      processing_info?: {
        state?: string;
        check_after_secs?: number;
        error?: { message?: string };
      };
    };
    errors?: Array<{ detail?: string; message?: string }>;
  } | null;

  if (!finalizeResponse.ok) {
    const detail =
      finalizePayload?.errors?.find((item) => item.detail || item.message)?.detail ??
      finalizePayload?.errors?.find((item) => item.detail || item.message)?.message ??
      `finalize_failed_${finalizeResponse.status}`;
    throw new Error(detail);
  }

  let processing = finalizePayload?.data?.processing_info;
  let polls = 0;
  while (
    processing &&
    (processing.state === "pending" || processing.state === "in_progress") &&
    polls < STATUS_MAX_POLLS
  ) {
    const waitSeconds =
      typeof processing.check_after_secs === "number" && processing.check_after_secs > 0
        ? processing.check_after_secs
        : 2;
    await new Promise((resolve) => setTimeout(resolve, Math.min(waitSeconds, 10) * 1000));

    const statusUrl = new URL("https://api.x.com/2/media/upload");
    statusUrl.searchParams.set("media_id", mediaId);
    statusUrl.searchParams.set("command", "STATUS");
    const statusResponse = await fetch(statusUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      cache: "no-store"
    });
    const statusPayload = (await statusResponse.json().catch(() => null)) as {
      data?: {
        processing_info?: {
          state?: string;
          check_after_secs?: number;
          error?: { message?: string };
        };
      };
      errors?: Array<{ detail?: string; message?: string }>;
    } | null;

    if (!statusResponse.ok) {
      const detail =
        statusPayload?.errors?.find((item) => item.detail || item.message)?.detail ??
        statusPayload?.errors?.find((item) => item.detail || item.message)?.message ??
        `status_failed_${statusResponse.status}`;
      throw new Error(detail);
    }

    processing = statusPayload?.data?.processing_info;
    polls += 1;
  }

  if (processing?.state === "failed") {
    throw new Error(processing.error?.message ?? "media_processing_failed");
  }

  return mediaId;
}

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

  let source: UploadSource;
  try {
    source = await readUploadSource(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_upload_request";
    return NextResponse.json(
      {
        error: "invalid_upload_request",
        message
      },
      { status: 400 }
    );
  }

  if (source.bytes.byteLength === 0) {
    return NextResponse.json(
      {
        error: "empty_media",
        message: "Uploaded media is empty."
      },
      { status: 400 }
    );
  }

  try {
    const mediaId = await uploadMediaToX(accessToken, source);
    return NextResponse.json({ mediaId }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "media_upload_failed";
    return NextResponse.json(
      {
        error: "media_upload_failed",
        message
      },
      { status: 502 }
    );
  }
}
