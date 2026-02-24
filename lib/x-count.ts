import twitterText from "twitter-text";

export interface XCountResult {
  weightedLength: number;
  remaining: number;
  valid: boolean;
  permillage: number;
}

export function getXCount(text: string): XCountResult {
  const parsed = twitterText.parseTweet(text);
  const weightedLength = parsed.weightedLength;
  return {
    weightedLength,
    remaining: 25000 - weightedLength,
    valid: weightedLength <= 25000,
    permillage: parsed.permillage
  };
}
