import type { DraftKind } from "@/lib/workspace";
import type { AiRewritePreset, DraftTemplate, UiTheme } from "@/components/compose/types";

export const ONBOARDING_SEEN_KEY = "hanfully_v2_onboarding_seen";
export const THEME_STORAGE_KEY = "hanfully_v2_theme";
export const DRAFT_HISTORY_STORAGE_KEY = "hanfully_v2_draft_history";
export const LOCALE_STORAGE_KEY = "hanfully_v2_locale";
export const TENOR_DEFAULT_KEY = "LIVDSRZULELA";
export const TENOR_PAGE_SIZE = 24;
export const TOPIC_FILTER_ALL = "__all_topics__";
export const TOPIC_FILTER_UNTAGGED = "__untagged__";

export const THEME_OPTIONS: Array<{ id: UiTheme; label: string }> = [
  { id: "signature", label: "Signature" },
  { id: "ink", label: "Ink" },
  { id: "sunset", label: "Sunset" }
];

export const DRAFT_OPTIONS: Array<{
  kind: DraftKind;
  title: string;
  description: string;
}> = [
  {
    kind: "tweet",
    title: "Tweet",
    description: "Single post."
  },
  {
    kind: "thread",
    title: "Thread",
    description: "Multi-post flow, same as current layout."
  },
  {
    kind: "article",
    title: "Article",
    description: "Long-form editor with title and subtitle styles."
  }
];

export const TEMPLATE_LIBRARY: DraftTemplate[] = [
  {
    id: "tweet-product-launch",
    name: "Product Launch Tweet",
    kind: "tweet",
    title: "Launch Tweet",
    description: "Clear product launch post with CTA.",
    posts: [
      "<p>We shipped a new feature to help creators plan one week of content in one session.</p><p>Built for solo founders and brand teams.</p><p>Reply if you want the workflow template.</p>"
    ]
  },
  {
    id: "tweet-hot-take",
    name: "Hot Take Tweet",
    kind: "tweet",
    title: "Hot Take Tweet",
    description: "One opinion + one reason + one question.",
    posts: [
      "<p>Most content growth problems are clarity problems, not distribution problems.</p><p>Structure first, channels second.</p><p>Do you agree?</p>"
    ]
  },
  {
    id: "thread-playbook",
    name: "Playbook Thread",
    kind: "thread",
    title: "Playbook Thread",
    description: "Hook + framework + CTA thread.",
    posts: [
      "If you build content for growth, this 3-step workflow is enough.\n\nInput -> Shape -> Distribute.",
      "Input: collect 3 real audience questions every day.\n\nDo not start from opinions, start from questions.",
      "Shape: keep one post focused on one idea.\n\nUse structure: claim -> reason -> example.",
      "Distribute: repurpose one idea into Tweet, Thread, and Article.\n\nConsistency compounds.",
      "If helpful, I can share a copy-paste SOP next."
    ]
  },
  {
    id: "thread-story",
    name: "Story Thread",
    kind: "thread",
    title: "Story Thread",
    description: "Narrative flow for personal story.",
    posts: [
      "It took me 6 months to realize low output was not a motivation problem.",
      "I used to force myself to write everything in one sitting. It always got stuck.",
      "Then I switched to a 3-step loop: write the point, add proof, add examples.",
      "That cut my writing time from 2 hours to about 35 minutes.",
      "If you feel blocked, try this for one week."
    ]
  },
  {
    id: "article-framework",
    name: "Framework Article",
    kind: "article",
    title: "Framework Article",
    description: "Structured article with title/subtitle/body.",
    posts: [
      "<h1>A Minimal Content System</h1><h2>From random output to repeatable quality</h2><p>Most creators rely on inspiration, so quality and cadence are unstable.</p><p>A better path is process: topic, structure, expression, distribution.</p><h3>1. Topic</h3><p>Capture audience questions weekly and prioritize by frequency.</p><h3>2. Structure</h3><p>Lead with the point, then add proof, then suggest action.</p><h3>3. Distribution</h3><p>Repurpose one core idea into Tweet, Thread, and Article.</p>"
    ]
  },
  {
    id: "article-case-study",
    name: "Case Study Article",
    kind: "article",
    title: "Case Study Article",
    description: "Case-study article skeleton.",
    posts: [
      "<h1>How We Built a 30-Day Content Cadence</h1><h2>What changed in strategy and execution</h2><p>This case study covers how a new account moved from random posting to a stable weekly pipeline.</p><h3>Background</h3><p>Topics were scattered and tone shifted post to post.</p><h3>Approach</h3><p>We standardized topic framing, writing structure, and daily review metrics.</p><h3>Result</h3><p>Output became consistent and engagement improved week over week.</p><blockquote>Reliable systems beat occasional viral hits.</blockquote>"
    ]
  }
];

export const AI_PRESETS: Array<{ id: AiRewritePreset; label: string }> = [
  { id: "fix_grammar", label: "Fix grammar" },
  { id: "improve_writing", label: "Improve writing" },
  { id: "punchier", label: "Make it punchier" },
  { id: "condense", label: "Condense" },
  { id: "rephrase", label: "Rephrase / Mix it up" },
  { id: "expand", label: "Expand & Elaborate" },
  { id: "structure", label: "Improve structure & spacing" },
  { id: "positive", label: "Rewrite in a positive tone" },
  { id: "thread_start", label: "Rewrite as thread start" },
  { id: "emoji", label: "Add emoji" },
  { id: "announcement", label: "Rewrite as announcement" }
];

export const X_WHO_TO_FOLLOW = [
  {
    name: "MangoType",
    handle: "@mangotype",
    initials: "M",
    avatarBg: "#FFE8BF",
    avatarFg: "#C26D00"
  },
  {
    name: "Fabrizio Rinaldi",
    handle: "@linuz90",
    initials: "F",
    avatarBg: "#EDE9FF",
    avatarFg: "#6D28D9"
  },
  {
    name: "Francesco Di Lorenzo",
    handle: "@frankdilo",
    initials: "F",
    avatarBg: "#D1FAE5",
    avatarFg: "#047857"
  },
  {
    name: "Rajat Kapoor",
    handle: "@rajatkapoor",
    initials: "R",
    avatarBg: "#FEE2E2",
    avatarFg: "#B91C1C"
  },
  {
    name: "Thomas Chris",
    handle: "@tomchris",
    initials: "T",
    avatarBg: "#E0F2FE",
    avatarFg: "#0369A1"
  },
  {
    name: "Gaile",
    handle: "@gailemango",
    initials: "G",
    avatarBg: "#FCE7F3",
    avatarFg: "#BE185D"
  }
];
