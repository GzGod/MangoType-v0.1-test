"use client";

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
  appendActivityLogs,
  buildQueueItem,
  createActivityLog,
  formatDateTime,
  publishQueueItem,
  retryQueueItem,
  sortPublishedDesc,
  sortQueueAsc,
  type ThreadPost,
  type WorkspaceState
} from "@/lib/workspace";
import type { DraftSnapshot, PaneTab, PublishState, UiLocale } from "@/components/compose/types";
import { computeRetryTimeIso, draftKindLabel } from "@/components/compose/utils";

type QueueRunnerArgs = {
  hydrated: boolean;
  authStatus: "authenticated" | "loading" | "unauthenticated";
  locale: UiLocale;
  t: (en: string, zh: string) => string;
  currentDraft: WorkspaceState["drafts"][number] | undefined;
  publishReady: boolean;
  queue: WorkspaceState["queue"];
  scheduleAt: string;
  updateWorkspace: (updater: (prev: WorkspaceState) => WorkspaceState) => void;
  prepareCurrentDraftForPublish: () => WorkspaceState["drafts"][number]["posts"];
  publishPostsToX: (posts: WorkspaceState["drafts"][number]["posts"]) => Promise<string[]>;
  persistMediaUrls: (posts: ThreadPost[]) => Promise<ThreadPost[]>;
  setNotice: Dispatch<SetStateAction<string>>;
  setPaneTab: Dispatch<SetStateAction<PaneTab>>;
  setDraftHistory: Dispatch<SetStateAction<Record<string, DraftSnapshot[]>>>;
};

export function useQueueRunner({
  hydrated,
  authStatus,
  locale,
  t,
  currentDraft,
  publishReady,
  queue,
  scheduleAt,
  updateWorkspace,
  prepareCurrentDraftForPublish,
  publishPostsToX,
  persistMediaUrls,
  setNotice,
  setPaneTab,
  setDraftHistory
}: QueueRunnerArgs) {
  const [publishState, setPublishState] = useState<PublishState>("idle");

  const queueCurrentDraft = useCallback(() => {
    if (!currentDraft) {
      return;
    }
    if (!publishReady) {
      setPublishState("blocked");
      setNotice(t("One or more posts exceed the character limit.", "有内容超过字符限制。"));
      return;
    }

    setPublishState("scheduling");
    const prepared = prepareCurrentDraftForPublish();
    const item = buildQueueItem(prepared, scheduleAt, {
      sourceDraftId: currentDraft.id,
      draftKind: currentDraft.kind
    });

    updateWorkspace((prev) => ({
      ...prev,
      queue: [item, ...prev.queue].sort(sortQueueAsc),
      activity: appendActivityLogs(prev.activity, [
        createActivityLog({
          level: "info",
          event: "queue_scheduled",
          message:
            locale === "zh"
              ? `${draftKindLabel(currentDraft.kind, locale)}已排程到 ${formatDateTime(item.publishAt)}。`
              : `${draftKindLabel(currentDraft.kind, locale)} scheduled for ${formatDateTime(item.publishAt)}.`,
          queueItemId: item.id,
          draftId: currentDraft.id
        })
      ])
    }));

    setPublishState("scheduled");
    setNotice(
      locale === "zh"
        ? `已将${draftKindLabel(currentDraft.kind, locale)}加入排程。`
        : `Added ${draftKindLabel(currentDraft.kind, locale)} to schedule.`
    );
  }, [
    currentDraft,
    locale,
    prepareCurrentDraftForPublish,
    publishReady,
    scheduleAt,
    setNotice,
    t,
    updateWorkspace
  ]);

  const publishCurrentDraft = useCallback(async () => {
    if (!currentDraft) {
      return;
    }
    if (authStatus !== "authenticated") {
      setPublishState("blocked");
      setNotice(t("Sign in with X before publishing.", "发布前请先登录 X 账号。"));
      return;
    }
    if (!publishReady) {
      setPublishState("blocked");
      setNotice(t("One or more posts exceed the character limit.", "有内容超过字符限制。"));
      return;
    }

    setPublishState("publishing");
    const prepared = prepareCurrentDraftForPublish();
    const draftId = currentDraft.id;
    const draftKind = currentDraft.kind;

    let tweetIds: string[] = [];
    try {
      tweetIds = await publishPostsToX(prepared);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t("Publishing failed. Please try again.", "发布失败，请稍后重试。");
      updateWorkspace((prev) => ({
        ...prev,
        activity: appendActivityLogs(prev.activity, [
          createActivityLog({
            level: "error",
            event: "manual_publish_failed",
            message: locale === "zh" ? `手动发布失败：${message}` : `Manual publish failed: ${message}`,
            draftId
          })
        ])
      }));
      setPublishState("blocked");
      setNotice(message);
      return;
    }

    const queueItem = buildQueueItem(prepared, new Date().toISOString(), {
      sourceDraftId: draftId,
      draftKind
    });
    const persistedPosts = await persistMediaUrls(queueItem.posts);
    const published = publishQueueItem({ ...queueItem, posts: persistedPosts }, { xTweetIds: tweetIds });

    updateWorkspace((prev) => {
      const nextDrafts = prev.drafts.length > 1 ? prev.drafts.filter((draft) => draft.id !== draftId) : prev.drafts;
      const nextSelectedId = nextDrafts.some((draft) => draft.id === prev.selectedDraftId)
        ? prev.selectedDraftId
        : nextDrafts[0].id;
      return {
        ...prev,
        drafts: nextDrafts,
        selectedDraftId: nextSelectedId,
        published: [published, ...prev.published].sort(sortPublishedDesc),
        activity: appendActivityLogs(prev.activity, [
          createActivityLog({
            level: "info",
            event: "manual_publish",
            message:
              locale === "zh"
                ? `${draftKindLabel(draftKind, locale)}已手动发布。`
                : `${draftKindLabel(draftKind, locale)} published manually.`,
            queueItemId: queueItem.id,
            draftId
          })
        ])
      };
    });

    setPaneTab("posted");
    setPublishState("published");
    setDraftHistory((prev) => {
      if (!(draftId in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[draftId];
      return next;
    });
    setNotice(locale === "zh" ? `${draftKindLabel(draftKind, locale)}已发布。` : `Published ${draftKindLabel(draftKind, locale)}.`);
  }, [
    authStatus,
    currentDraft,
    locale,
    persistMediaUrls,
    prepareCurrentDraftForPublish,
    publishPostsToX,
    publishReady,
    setDraftHistory,
    setNotice,
    setPaneTab,
    t,
    updateWorkspace
  ]);

  const runDueJobs = useCallback(
    async (options?: { silent?: boolean }) => {
      const now = Date.now();
      const dueItems = queue
        .filter((item) => {
          const isPendingDue = item.status === "pending" && new Date(item.publishAt).getTime() <= now;
          const isRetryDue =
            item.status === "failed" &&
            !!item.nextRetryAt &&
            new Date(item.nextRetryAt).getTime() <= now &&
            item.attemptCount < item.maxAttempts;
          return isPendingDue || isRetryDue;
        })
        .sort(sortQueueAsc);

      if (dueItems.length === 0) {
        if (!options?.silent) {
          setNotice(t("No due items right now.", "当前没有到期任务。"));
        }
        return;
      }

      if (authStatus !== "authenticated") {
        if (!options?.silent) {
          setNotice(t("Sign in with X before running queue.", "执行队列前请先登录 X 账号。"));
        }
        return;
      }

      let succeeded = 0;
      let failed = 0;
      const publishedItems: WorkspaceState["published"] = [];
      const failedById = new Map<string, WorkspaceState["queue"][number]>();
      const succeededIds = new Set<string>();
      const activityLogs: WorkspaceState["activity"] = [];

      for (const item of dueItems) {
        const nowIso = new Date().toISOString();
        const nextAttempt = item.attemptCount + 1;
        const attemptedItem = {
          ...item,
          attemptCount: nextAttempt,
          lastAttemptAt: nowIso,
          updatedAt: nowIso
        };

        try {
          const tweetIds = await publishPostsToX(item.posts);
          succeeded += 1;
          succeededIds.add(item.id);
          const persistedItem = { ...attemptedItem, posts: await persistMediaUrls(attemptedItem.posts) };
          publishedItems.push(
            publishQueueItem(persistedItem, {
              xTweetIds: tweetIds
            })
          );
          activityLogs.push(
            createActivityLog({
              level: "info",
              event: "queue_publish_succeeded",
              message:
                locale === "zh"
                  ? `已发布排程${draftKindLabel(item.draftKind ?? "thread", locale)}（${item.preview.slice(0, 36)}）。`
                  : `Published scheduled ${draftKindLabel(item.draftKind ?? "thread", locale).toLowerCase()} (${item.preview.slice(0, 36)}).`,
              queueItemId: item.id,
              draftId: item.sourceDraftId
            })
          );
        } catch (error) {
          failed += 1;
          const errorMessage =
            error instanceof Error
              ? error.message
              : t("Publishing failed. Please try again.", "发布失败，请稍后重试。");
          const retriesRemaining = nextAttempt < item.maxAttempts;
          const retryAt = retriesRemaining ? computeRetryTimeIso(nowIso, nextAttempt) : undefined;
          failedById.set(item.id, {
            ...attemptedItem,
            status: "failed",
            nextRetryAt: retryAt,
            lastError: errorMessage
          });
          activityLogs.push(
            createActivityLog({
              level: retriesRemaining ? "warn" : "error",
              event: retriesRemaining ? "queue_retry_scheduled" : "queue_retry_exhausted",
              message: retriesRemaining
                ? locale === "zh"
                  ? `发布失败，将在 ${formatDateTime(retryAt as string)} 重试。`
                  : `Publish failed, retry at ${formatDateTime(retryAt as string)}.`
                : locale === "zh"
                  ? "发布失败，已达到最大重试次数。"
                  : `Publish failed after ${nextAttempt} attempts.`,
              queueItemId: item.id,
              draftId: item.sourceDraftId
            })
          );
        }
      }

      updateWorkspace((prev) => ({
        ...prev,
        queue: prev.queue
          .filter((item) => !succeededIds.has(item.id))
          .map((item) => failedById.get(item.id) ?? item)
          .sort(sortQueueAsc),
        published: [...publishedItems, ...prev.published].sort(sortPublishedDesc),
        activity: appendActivityLogs(prev.activity, activityLogs)
      }));

      if (!options?.silent) {
        if (failed > 0) {
          setNotice(
            locale === "zh"
              ? `队列执行：成功 ${succeeded}，失败 ${failed}。`
              : `Queue run: ${succeeded} succeeded, ${failed} failed.`
          );
        } else {
          setNotice(locale === "zh" ? `已执行 ${succeeded} 个到期任务。` : `Executed ${succeeded} due items.`);
        }
      }
    },
    [authStatus, locale, persistMediaUrls, publishPostsToX, queue, setNotice, t, updateWorkspace]
  );

  const publishScheduledItem = useCallback(
    async (id: string) => {
      const target = queue.find((item) => item.id === id);
      if (!target) {
        return;
      }

      if (authStatus !== "authenticated") {
        setPublishState("blocked");
        setNotice(t("Sign in with X before publishing.", "发布前请先登录 X 账号。"));
        return;
      }

      setPublishState("publishing");
      const nowIso = new Date().toISOString();
      const nextAttempt = target.attemptCount + 1;
      const attemptedItem = {
        ...target,
        attemptCount: nextAttempt,
        lastAttemptAt: nowIso,
        updatedAt: nowIso
      };

      let tweetIds: string[] = [];
      try {
        tweetIds = await publishPostsToX(target.posts);
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : t("Publishing failed. Please try again.", "发布失败，请稍后重试。");
        const retriesRemaining = nextAttempt < target.maxAttempts;
        const retryAt = retriesRemaining ? computeRetryTimeIso(nowIso, nextAttempt) : undefined;

        updateWorkspace((prev) => ({
          ...prev,
          queue: prev.queue
            .map((item) =>
              item.id === id
                ? {
                    ...attemptedItem,
                    status: "failed" as const,
                    nextRetryAt: retryAt,
                    lastError: errorMessage
                  }
                : item
            )
            .sort(sortQueueAsc),
          activity: appendActivityLogs(prev.activity, [
            createActivityLog({
              level: retriesRemaining ? "warn" : "error",
              event: retriesRemaining ? "queue_retry_scheduled" : "queue_retry_exhausted",
              message: retriesRemaining
                ? locale === "zh"
                  ? `发布失败，将在 ${formatDateTime(retryAt as string)} 重试。`
                  : `Publish failed, retry at ${formatDateTime(retryAt as string)}.`
                : locale === "zh"
                  ? "发布失败，已达到最大重试次数。"
                  : `Publish failed after ${nextAttempt} attempts.`,
              queueItemId: target.id,
              draftId: target.sourceDraftId
            })
          ])
        }));
        setPublishState("blocked");
        setNotice(errorMessage);
        return;
      }

      const persistedScheduled = { ...attemptedItem, posts: await persistMediaUrls(attemptedItem.posts) };
      updateWorkspace((prev) => ({
        ...prev,
        queue: prev.queue.filter((item) => item.id !== id),
        published: [
          publishQueueItem(persistedScheduled, {
            xTweetIds: tweetIds
          }),
          ...prev.published
        ].sort(sortPublishedDesc),
        activity: appendActivityLogs(prev.activity, [
          createActivityLog({
            level: "info",
            event: "manual_publish_from_queue",
            message:
              locale === "zh"
                ? `已手动发布排程内容（${target.preview.slice(0, 36)}）。`
                : `Scheduled item published manually (${target.preview.slice(0, 36)}).`,
            queueItemId: target.id,
            draftId: target.sourceDraftId
          })
        ])
      }));
      setPaneTab("posted");
      setPublishState("published");
      setNotice(t("Scheduled item published.", "已发布排程内容。"));
    },
    [authStatus, locale, persistMediaUrls, publishPostsToX, queue, setNotice, setPaneTab, t, updateWorkspace]
  );

  const retryScheduledItem = useCallback(
    (id: string) => {
      const target = queue.find((item) => item.id === id);
      if (!target) {
        return;
      }
      const retried = retryQueueItem(target);
      updateWorkspace((prev) => ({
        ...prev,
        queue: prev.queue.map((item) => (item.id === id ? retried : item)).sort(sortQueueAsc),
        activity: appendActivityLogs(prev.activity, [
          createActivityLog({
            level: "info",
            event: "manual_retry",
            message:
              locale === "zh"
                ? `已请求手动重试（${target.preview.slice(0, 36)}）。`
                : `Manual retry requested (${target.preview.slice(0, 36)}).`,
            queueItemId: target.id,
            draftId: target.sourceDraftId
          })
        ])
      }));
      setNotice(t("Retry queued. It will run on the next scheduler tick.", "已加入重试队列，将在下一次调度执行。"));
    },
    [locale, queue, setNotice, t, updateWorkspace]
  );

  const retryFailedItems = useCallback(() => {
    const failedItems = queue.filter((item) => item.status === "failed");
    if (failedItems.length === 0) {
      setNotice(t("No failed items to retry.", "没有可重试的失败任务。"));
      return;
    }

    updateWorkspace((prev) => ({
      ...prev,
      queue: prev.queue.map((item) => (item.status === "failed" ? retryQueueItem(item) : item)).sort(sortQueueAsc),
      activity: appendActivityLogs(prev.activity, [
        createActivityLog({
          level: "info",
          event: "bulk_retry",
          message:
            locale === "zh"
              ? `已为 ${failedItems.length} 个失败任务发起手动重试。`
              : `Manual retry for ${failedItems.length} failed item(s).`
        })
      ])
    }));

    setNotice(
      locale === "zh"
        ? `已加入 ${failedItems.length} 个重试任务。`
        : `Retry queued for ${failedItems.length} items.`
    );
  }, [locale, queue, setNotice, t, updateWorkspace]);

  useEffect(() => {
    if (publishState === "idle" || publishState === "scheduling" || publishState === "publishing") {
      return;
    }
    const timer = window.setTimeout(() => setPublishState("idle"), 1800);
    return () => window.clearTimeout(timer);
  }, [publishState]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    void runDueJobs({ silent: true });
    const timer = window.setInterval(() => {
      void runDueJobs({ silent: true });
    }, 25000);
    return () => window.clearInterval(timer);
  }, [hydrated, queue, runDueJobs]);

  const publishBusy = publishState === "scheduling" || publishState === "publishing";
  const scheduleLabel =
    publishState === "scheduling"
      ? t("Scheduling...", "排程中...")
      : publishState === "scheduled"
        ? t("Scheduled", "已排程")
        : t("Schedule", "排程");
  const publishLabel =
    publishState === "publishing"
      ? t("Publishing...", "发布中...")
      : publishState === "published"
        ? t("Published", "已发布")
        : t("Publish", "发布");

  return {
    publishState,
    publishBusy,
    scheduleLabel,
    publishLabel,
    queueCurrentDraft,
    publishCurrentDraft,
    runDueJobs,
    publishScheduledItem,
    retryScheduledItem,
    retryFailedItems
  };
}
