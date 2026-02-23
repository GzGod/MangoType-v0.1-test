import type { NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import TwitterProvider from "next-auth/providers/twitter";

const TWITTER_CLIENT_ID = process.env.AUTH_TWITTER_ID ?? process.env.TWITTER_CLIENT_ID ?? "";
const TWITTER_CLIENT_SECRET =
  process.env.AUTH_TWITTER_SECRET ?? process.env.TWITTER_CLIENT_SECRET ?? "";
const AUTH_SECRET = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "";
const HAS_TWITTER_PROVIDER = Boolean(TWITTER_CLIENT_ID && TWITTER_CLIENT_SECRET);
const HAS_AUTH_SECRET = Boolean(AUTH_SECRET);
const REFRESH_SKEW_SECONDS = 60;

export const authConfigState = {
  hasTwitterProvider: HAS_TWITTER_PROVIDER,
  hasAuthSecret: HAS_AUTH_SECRET
};

function withTwitterAuth(token: JWT, account?: { [key: string]: unknown }) {
  if (!account) {
    return token;
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAtFromProvider =
    typeof account.expires_at === "number"
      ? account.expires_at
      : typeof account.expires_in === "number"
        ? nowSeconds + account.expires_in
        : token.expiresAt;
  return {
    ...token,
    accessToken:
      typeof account.access_token === "string" ? account.access_token : token.accessToken,
    refreshToken:
      typeof account.refresh_token === "string" ? account.refresh_token : token.refreshToken,
    expiresAt: expiresAtFromProvider,
    error: null
  };
}

async function refreshTwitterAccessToken(token: JWT): Promise<JWT> {
  if (!HAS_TWITTER_PROVIDER) {
    return {
      ...token,
      error: "MissingTwitterProviderConfig"
    };
  }

  const refreshToken = typeof token.refreshToken === "string" ? token.refreshToken : "";
  if (!refreshToken) {
    return {
      ...token,
      error: "MissingRefreshToken"
    };
  }

  try {
    const params = new URLSearchParams();
    params.set("grant_type", "refresh_token");
    params.set("refresh_token", refreshToken);
    params.set("client_id", TWITTER_CLIENT_ID);

    const basicAuth = Buffer.from(`${TWITTER_CLIENT_ID}:${TWITTER_CLIENT_SECRET}`).toString(
      "base64"
    );

    const response = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString(),
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`refresh_failed_${response.status}`);
    }

    const payload = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (typeof payload.access_token !== "string" || !payload.access_token.trim()) {
      throw new Error("refresh_missing_access_token");
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    return {
      ...token,
      accessToken: payload.access_token,
      refreshToken:
        typeof payload.refresh_token === "string" && payload.refresh_token.trim()
          ? payload.refresh_token
          : token.refreshToken,
      expiresAt:
        typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
          ? nowSeconds + Math.max(1, Math.floor(payload.expires_in))
          : token.expiresAt,
      error: null
    };
  } catch {
    return {
      ...token,
      error: "RefreshAccessTokenError"
    };
  }
}

export const authOptions: NextAuthOptions = {
  secret: AUTH_SECRET || undefined,
  session: {
    strategy: "jwt"
  },
  providers: HAS_TWITTER_PROVIDER
    ? [
        TwitterProvider({
          clientId: TWITTER_CLIENT_ID,
          clientSecret: TWITTER_CLIENT_SECRET,
          version: "2.0",
          authorization: {
            params: {
              scope: "users.read tweet.read tweet.write offline.access"
            }
          },
          profile(profile) {
            const payload = "data" in profile ? profile.data : undefined;
            return {
              id: payload?.id ?? "",
              name: payload?.name ?? "X User",
              email: null,
              image: payload?.profile_image_url ?? null,
              username: payload?.username ?? null
            };
          }
        })
      ]
    : [],
  callbacks: {
    async jwt({ token, account, profile }) {
      let nextToken = withTwitterAuth(
        token,
        account as { [key: string]: unknown } | undefined
      );

      if (!account) {
        const nowSeconds = Math.floor(Date.now() / 1000);
        const expiresAt =
          typeof nextToken.expiresAt === "number" && Number.isFinite(nextToken.expiresAt)
            ? nextToken.expiresAt
            : null;
        if (expiresAt && expiresAt <= nowSeconds + REFRESH_SKEW_SECONDS) {
          nextToken = await refreshTwitterAccessToken(nextToken);
        }
      }

      const profileUsername =
        (profile as { data?: { username?: string } } | undefined)?.data?.username ?? null;
      const username =
        typeof profileUsername === "string"
          ? profileUsername
          : typeof token.username === "string"
            ? token.username
            : null;
      return {
        ...nextToken,
        username
      };
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.username = typeof token.username === "string" ? token.username : null;
      }
      session.accessToken = typeof token.accessToken === "string" ? token.accessToken : null;
      session.refreshToken = typeof token.refreshToken === "string" ? token.refreshToken : null;
      session.expiresAt = typeof token.expiresAt === "number" ? token.expiresAt : null;
      session.error = typeof token.error === "string" ? token.error : null;
      return session;
    }
  }
};
