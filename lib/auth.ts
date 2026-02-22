import type { NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import TwitterProvider from "next-auth/providers/twitter";

const TWITTER_CLIENT_ID = process.env.AUTH_TWITTER_ID ?? process.env.TWITTER_CLIENT_ID ?? "";
const TWITTER_CLIENT_SECRET =
  process.env.AUTH_TWITTER_SECRET ?? process.env.TWITTER_CLIENT_SECRET ?? "";

function withTwitterAuth(token: JWT, account?: { [key: string]: unknown }) {
  if (!account) {
    return token;
  }
  return {
    ...token,
    accessToken:
      typeof account.access_token === "string" ? account.access_token : token.accessToken,
    refreshToken:
      typeof account.refresh_token === "string" ? account.refresh_token : token.refreshToken,
    expiresAt:
      typeof account.expires_at === "number" ? account.expires_at : token.expiresAt
  };
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  session: {
    strategy: "jwt"
  },
  providers: [
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
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      const nextToken = withTwitterAuth(token, account as { [key: string]: unknown } | undefined);
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
      return session;
    }
  }
};
