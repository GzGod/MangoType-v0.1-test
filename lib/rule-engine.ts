export type RuleLevel = "error" | "warn";

export type RuleId =
  | "R001"
  | "R002"
  | "R003"
  | "R004"
  | "R005"
  | "R006"
  | "R007"
  | "R101"
  | "R102"
  | "R103"
  | "R104"
  | "C201"
  | "C202"
  | "C203";

export type RuleCategory = "strict" | "suggestion" | "controversial";

export interface RuleDefinition {
  id: RuleId;
  label: string;
  description: string;
  level: RuleLevel;
  category: RuleCategory;
  enabledByDefault: boolean;
  autofix: boolean;
}

export interface RuleIssue {
  id: string;
  ruleId: RuleId;
  level: RuleLevel;
  message: string;
  start: number;
  end: number;
  excerpt: string;
  suggestion?: string;
}

export type RuleState = Record<RuleId, boolean>;

interface ProtectedTerm {
  token: string;
  term: string;
}

const CJK = "[\\u4E00-\\u9FFF]";
const OPEN_PUNC = "[（【《「『]";
const CLOSE_PUNC = "[，。！？；：、）】》」』]";
const UNITS = new Set([
  "kb",
  "mb",
  "gb",
  "tb",
  "kib",
  "mib",
  "gib",
  "tib",
  "bps",
  "kbps",
  "mbps",
  "gbps",
  "tbps",
  "hz",
  "khz",
  "mhz",
  "ghz",
  "kg",
  "g",
  "mg",
  "km",
  "m",
  "cm",
  "mm",
  "ms",
  "s",
  "w",
  "kw",
  "v",
  "a"
]);

const PROPER_NOUNS: Array<[string, string]> = [
  ["GitHub", "GitHub"],
  ["JavaScript", "JavaScript"],
  ["TypeScript", "TypeScript"],
  ["HTML5", "HTML5"],
  ["React", "React"],
  ["Next.js", "Next.js"],
  ["Node.js", "Node.js"],
  ["Twitter", "Twitter"],
  ["LeanCloud", "LeanCloud"]
];

const BAD_ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bJs\b/g, "JavaScript"],
  [/\bh5\b/g, "HTML5"],
  [/\bFED\b/g, "前端开发者"],
  [/\bRJS\b/g, "React"],
  [/\bbackbone\b/gi, "Backbone.js"],
  [/\bangular\b/gi, "Angular"]
];

export const DEFAULT_WHITELIST = ["豆瓣FM"];

export const RULE_DEFINITIONS: RuleDefinition[] = [
  {
    id: "R001",
    label: "中英文之间加空格",
    description: "中文与英文字符之间建议保留一个空格。",
    level: "error",
    category: "strict",
    enabledByDefault: true,
    autofix: true
  },
  {
    id: "R002",
    label: "中文与数字之间加空格",
    description: "中文字符与阿拉伯数字之间建议保留一个空格。",
    level: "error",
    category: "strict",
    enabledByDefault: true,
    autofix: true
  },
  {
    id: "R003",
    label: "数字与单位之间加空格",
    description: "数字与常见英文单位之间建议保留一个空格，% 与 ° 除外。",
    level: "error",
    category: "strict",
    enabledByDefault: true,
    autofix: true
  },
  {
    id: "R004",
    label: "全角标点前后无多余空格",
    description: "全角标点前后不应保留英文空格。",
    level: "error",
    category: "strict",
    enabledByDefault: true,
    autofix: true
  },
  {
    id: "R005",
    label: "省略号统一为……",
    description: "统一省略号写法并保持后续文本可读性。",
    level: "error",
    category: "strict",
    enabledByDefault: true,
    autofix: true
  },
  {
    id: "R006",
    label: "破折号前后加空格",
    description: "破折号建议使用“ —— ”格式。",
    level: "error",
    category: "strict",
    enabledByDefault: true,
    autofix: true
  },
  {
    id: "R007",
    label: "数字统一半角",
    description: "中文内容中的数字默认使用半角字符。",
    level: "error",
    category: "strict",
    enabledByDefault: true,
    autofix: true
  },
  {
    id: "R101",
    label: "避免重复标点",
    description: "连续重复标点会降低可读性。",
    level: "warn",
    category: "suggestion",
    enabledByDefault: true,
    autofix: false
  },
  {
    id: "R102",
    label: "中文语境标点风格",
    description: "中文语境中优先使用全角中文标点。",
    level: "warn",
    category: "suggestion",
    enabledByDefault: true,
    autofix: false
  },
  {
    id: "R103",
    label: "专有名词大小写",
    description: "专有名词应保持官方写法。",
    level: "warn",
    category: "suggestion",
    enabledByDefault: true,
    autofix: false
  },
  {
    id: "R104",
    label: "不地道缩写提醒",
    description: "避免使用容易误解的缩写。",
    level: "warn",
    category: "suggestion",
    enabledByDefault: true,
    autofix: false
  },
  {
    id: "C201",
    label: "链接前后空格风格",
    description: "链接与中文之间是否保留空格可团队自定义。",
    level: "warn",
    category: "controversial",
    enabledByDefault: false,
    autofix: false
  },
  {
    id: "C202",
    label: "引号风格",
    description: "简体中文可在「」与“”中选择统一风格。",
    level: "warn",
    category: "controversial",
    enabledByDefault: false,
    autofix: false
  },
  {
    id: "C203",
    label: "情绪标点容忍度",
    description: "控制连续 ?! 组合的强度。",
    level: "warn",
    category: "controversial",
    enabledByDefault: false,
    autofix: false
  }
];

export function createDefaultRuleState(): RuleState {
  return RULE_DEFINITIONS.reduce<RuleState>((acc, rule) => {
    acc[rule.id] = rule.enabledByDefault;
    return acc;
  }, {} as RuleState);
}

export function parseWhitelistInput(input: string): string[] {
  return input
    .split(/[,\n，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function lintText(
  input: string,
  ruleState: RuleState,
  customWhitelist: string[] = DEFAULT_WHITELIST
): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const whitelist = uniqueTerms([...DEFAULT_WHITELIST, ...customWhitelist]);
  const ignoredRanges = findTermRanges(input, whitelist);

  if (ruleState.R001) {
    pushRegexIssues(
      issues,
      "R001",
      input,
      new RegExp(`${CJK}[A-Za-z]|[A-Za-z]${CJK}`, "g"),
      "中英文之间需要增加空格。",
      "在中文和英文之间插入一个空格。",
      ignoredRanges
    );
  }

  if (ruleState.R002) {
    pushRegexIssues(
      issues,
      "R002",
      input,
      new RegExp(`${CJK}\\d|\\d${CJK}`, "g"),
      "中文与数字之间需要增加空格。",
      "在中文和数字之间插入一个空格。",
      ignoredRanges
    );
  }

  if (ruleState.R003) {
    pushRegexIssues(
      issues,
      "R003",
      input,
      /\d(?:[A-Za-z]{1,5}|[kKmMgGtT]?[bB]ps|[kKmMgGtT]?[bB]|[kKmMgG]?[hH]z)\b/g,
      "数字与单位之间需要增加空格。",
      "例如 10 Gbps、20 TB。"
    );
  }

  if (ruleState.R004) {
    pushRegexIssues(
      issues,
      "R004",
      input,
      new RegExp(`\\s+${CLOSE_PUNC}|${OPEN_PUNC}\\s+`, "g"),
      "全角标点与其他字符之间不加空格。",
      "删除标点前后多余的空格。"
    );
  }

  if (ruleState.R005) {
    pushRegexIssues(
      issues,
      "R005",
      input,
      /\.{3,}|。{3,}|……(?=[^\s，。！？；：、])/g,
      "省略号应统一为“……”并保持后续可读性。",
      "统一为“……”并在必要时补空格。"
    );
  }

  if (ruleState.R006) {
    pushRegexIssues(
      issues,
      "R006",
      input,
      /[^\s]——|——[^\s]|--/g,
      "破折号前后应增加空格。",
      "改成“ —— ”。"
    );
  }

  if (ruleState.R007) {
    pushRegexIssues(
      issues,
      "R007",
      input,
      /[０-９]/g,
      "数字应使用半角字符。",
      "将全角数字改为半角数字。"
    );
  }

  if (ruleState.R101) {
    pushRegexIssues(
      issues,
      "R101",
      input,
      /[!?！？。]{2,}/g,
      "检测到重复使用标点符号。",
      "保留 1 个标点，或最多 2 个情绪组合。"
    );
  }

  if (ruleState.R102) {
    pushRegexIssues(
      issues,
      "R102",
      input,
      new RegExp(`${CJK}[!?,.:;]|[!?,.:;]${CJK}`, "g"),
      "中文语境中建议使用全角中文标点。",
      "将 ! ? , . : ; 改为对应全角形式。"
    );
  }

  if (ruleState.R103) {
    PROPER_NOUNS.forEach(([expected]) => {
      const escaped = escapeRegExp(expected);
      const matcher = new RegExp(escaped, "gi");
      let match = matcher.exec(input);
      while (match) {
        if (match[0] !== expected) {
          issues.push(
            createIssue(
              "R103",
              match.index,
              match.index + match[0].length,
              input.slice(match.index, match.index + match[0].length),
              `专有名词大小写建议改为 ${expected}。`,
              expected
            )
          );
        }
        if (match.index === matcher.lastIndex) {
          matcher.lastIndex += 1;
        }
        match = matcher.exec(input);
      }
    });
  }

  if (ruleState.R104) {
    BAD_ABBREVIATIONS.forEach(([pattern, expected]) => {
      pushRegexIssues(
        issues,
        "R104",
        input,
        pattern,
        "检测到不地道缩写。",
        `建议改为 ${expected}。`
      );
    });
  }

  if (ruleState.C201) {
    pushRegexIssues(
      issues,
      "C201",
      input,
      new RegExp(`${CJK}(https?:\\/\\/|www\\.)|(https?:\\/\\/\\S+)${CJK}`, "g"),
      "链接前后空格风格未统一。",
      "根据团队习惯统一链接前后空格。"
    );
  }

  if (ruleState.C202) {
    pushRegexIssues(
      issues,
      "C202",
      input,
      /[“”‘’]/g,
      "当前使用了弯引号。",
      "可按团队标准改为「」与『』。"
    );
  }

  if (ruleState.C203) {
    pushRegexIssues(
      issues,
      "C203",
      input,
      /[!?？！]{3,}/g,
      "情绪标点强度较高。",
      "建议减少重复 ?! 组合。"
    );
  }

  return issues.sort((a, b) => a.start - b.start);
}

export function applyRuleFix(
  input: string,
  ruleId: RuleId,
  customWhitelist: string[] = DEFAULT_WHITELIST
): string {
  switch (ruleId) {
    case "R001":
      return fixSpacingBetweenCjkAndLatin(input, customWhitelist);
    case "R002":
      return fixSpacingBetweenCjkAndNumber(input);
    case "R003":
      return fixSpacingBetweenNumberAndUnit(input);
    case "R004":
      return fixPunctuationSpacing(input);
    case "R005":
      return fixEllipsis(input);
    case "R006":
      return fixDash(input);
    case "R007":
      return fixFullWidthDigits(input);
    default:
      return input;
  }
}

export function applyAllFixes(
  input: string,
  ruleState: RuleState,
  customWhitelist: string[] = DEFAULT_WHITELIST
): string {
  return RULE_DEFINITIONS.reduce((text, rule) => {
    if (!ruleState[rule.id] || !rule.autofix) {
      return text;
    }
    return applyRuleFix(text, rule.id, customWhitelist);
  }, input);
}

function createIssue(
  ruleId: RuleId,
  start: number,
  end: number,
  excerpt: string,
  message: string,
  suggestion?: string
): RuleIssue {
  const rule = RULE_DEFINITIONS.find((item) => item.id === ruleId);
  return {
    id: `${ruleId}-${start}-${end}-${excerpt}`,
    ruleId,
    level: rule?.level ?? "warn",
    start,
    end,
    excerpt,
    message,
    suggestion
  };
}

function pushRegexIssues(
  issues: RuleIssue[],
  ruleId: RuleId,
  source: string,
  regex: RegExp,
  message: string,
  suggestion?: string,
  ignoredRanges: Array<[number, number]> = []
): void {
  const matcher = new RegExp(
    regex.source,
    regex.flags.includes("g") ? regex.flags : `${regex.flags}g`
  );
  let match = matcher.exec(source);
  while (match) {
    const start = match.index;
    const end = match.index + match[0].length;
    if (isIgnoredRange(start, end, ignoredRanges)) {
      if (match.index === matcher.lastIndex) {
        matcher.lastIndex += 1;
      }
      match = matcher.exec(source);
      continue;
    }
    issues.push(
      createIssue(
        ruleId,
        start,
        end,
        source.slice(start, end),
        message,
        suggestion
      )
    );
    if (match.index === matcher.lastIndex) {
      matcher.lastIndex += 1;
    }
    match = matcher.exec(source);
  }
}

function uniqueTerms(terms: string[]): string[] {
  return Array.from(new Set(terms.map((term) => term.trim()).filter(Boolean)));
}

function findTermRanges(
  source: string,
  terms: string[]
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  terms.forEach((term) => {
    const escaped = escapeRegExp(term);
    const matcher = new RegExp(escaped, "g");
    let match = matcher.exec(source);
    while (match) {
      ranges.push([match.index, match.index + match[0].length]);
      if (match.index === matcher.lastIndex) {
        matcher.lastIndex += 1;
      }
      match = matcher.exec(source);
    }
  });
  return ranges;
}

function isIgnoredRange(
  start: number,
  end: number,
  ranges: Array<[number, number]>
): boolean {
  return ranges.some(([left, right]) => start >= left && end <= right);
}

function protectTerms(input: string, terms: string[]): {
  text: string;
  replacements: ProtectedTerm[];
} {
  let text = input;
  const replacements: ProtectedTerm[] = [];

  terms.forEach((term, index) => {
    const token = `__TERM_${index}__`;
    const escaped = escapeRegExp(term);
    text = text.replace(new RegExp(escaped, "g"), token);
    replacements.push({ token, term });
  });

  return { text, replacements };
}

function restoreTerms(input: string, replacements: ProtectedTerm[]): string {
  return replacements.reduce((text, item) => {
    return text.replace(new RegExp(escapeRegExp(item.token), "g"), item.term);
  }, input);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fixSpacingBetweenCjkAndLatin(
  input: string,
  customWhitelist: string[]
): string {
  const whitelist = uniqueTerms([...DEFAULT_WHITELIST, ...customWhitelist]);
  const protectedText = protectTerms(input, whitelist);
  const fixed = protectedText.text
    .replace(new RegExp(`(${CJK})([A-Za-z])`, "g"), "$1 $2")
    .replace(new RegExp(`([A-Za-z])(${CJK})`, "g"), "$1 $2")
    .replace(/ {2,}/g, " ");
  return restoreTerms(fixed, protectedText.replacements);
}

function fixSpacingBetweenCjkAndNumber(input: string): string {
  return input
    .replace(new RegExp(`(${CJK})(\\d)`, "g"), "$1 $2")
    .replace(new RegExp(`(\\d)(${CJK})`, "g"), "$1 $2")
    .replace(/ {2,}/g, " ");
}

function fixSpacingBetweenNumberAndUnit(input: string): string {
  return input.replace(
    /(\d)([A-Za-z]{1,5}|[kKmMgGtT]?[bB]ps|[kKmMgGtT]?[bB]|[kKmMgG]?[hH]z)\b/g,
    (raw, numberPart: string, unit: string) => {
      if (!UNITS.has(unit.toLowerCase())) {
        return raw;
      }
      return `${numberPart} ${unit}`;
    }
  );
}

function fixPunctuationSpacing(input: string): string {
  return input
    .replace(new RegExp(`\\s+(${CLOSE_PUNC})`, "g"), "$1")
    .replace(new RegExp(`(${OPEN_PUNC})\\s+`, "g"), "$1");
}

function fixEllipsis(input: string): string {
  return input
    .replace(/\.{3,}/g, "……")
    .replace(/。{3,}/g, "……")
    .replace(/…{3,}/g, "……")
    .replace(/……(?=[^\s，。！？；：、])/g, "…… ");
}

function fixDash(input: string): string {
  return input
    .replace(/\s*——\s*/g, " —— ")
    .replace(/\s*--\s*/g, " —— ")
    .replace(/ {2,}/g, " ");
}

function fixFullWidthDigits(input: string): string {
  return input.replace(/[０-９]/g, (digit) =>
    String.fromCharCode(digit.charCodeAt(0) - 0xfee0)
  );
}
