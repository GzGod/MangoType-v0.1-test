declare module "twitter-text" {
  export interface ParseTweetResult {
    weightedLength: number;
    valid: boolean;
    permillage: number;
  }

  interface TwitterTextApi {
    parseTweet(input: string): ParseTweetResult;
  }

  const twitterText: TwitterTextApi;
  export default twitterText;
}
