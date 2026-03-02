const CJK = "[\\u4E00-\\u9FFF]";

export function fixChinesePunctuationStyle(input: string): string {
  const asciiToFullWidth: Record<string, string> = {
    "!": "！",
    "?": "？",
    ",": "，",
    ".": "。",
    ":": "：",
    ";": "；"
  };

  const toFullWidth = (char: string): string => asciiToFullWidth[char] ?? char;

  return input
    .replace(new RegExp(`(${CJK})([!?,.:;])`, "g"), (_raw, left: string, punct: string) => {
      return `${left}${toFullWidth(punct)}`;
    })
    .replace(new RegExp(`([!?,.:;])(${CJK})`, "g"), (_raw, punct: string, right: string) => {
      return `${toFullWidth(punct)}${right}`;
    });
}

