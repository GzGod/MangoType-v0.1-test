"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { QuickCommand } from "@/components/compose/types";

type UseCommandPaletteArgs = {
  quickCommands: QuickCommand[];
  sidebarCollapsed: boolean;
};

export function useCommandPalette({ quickCommands, sidebarCollapsed }: UseCommandPaletteArgs) {
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const commandRef = useRef<HTMLDivElement | null>(null);

  const closeCommandPalette = useCallback((clearQuery = true) => {
    setCommandOpen(false);
    if (clearQuery) {
      setCommandQuery("");
    }
  }, []);

  const openCommandPalette = useCallback((seedQuery?: string) => {
    setCommandOpen(true);
    if (typeof seedQuery === "string") {
      setCommandQuery(seedQuery);
    }
  }, []);

  const toggleCommandPalette = useCallback(() => {
    setCommandOpen((prev) => !prev);
  }, []);

  const normalizedCommandQuery = commandQuery.trim().toLowerCase();
  const filteredCommands = useMemo(
    () =>
      quickCommands.filter((item) =>
        `${item.label} ${item.keywords}`.toLowerCase().includes(normalizedCommandQuery)
      ),
    [normalizedCommandQuery, quickCommands]
  );

  const runQuickCommand = useCallback(
    (command: QuickCommand) => {
      void Promise.resolve(command.run()).finally(() => {
        closeCommandPalette(true);
      });
    },
    [closeCommandPalette]
  );

  useEffect(() => {
    if (!commandOpen) {
      return;
    }
    function onClick(event: MouseEvent) {
      if (!(event.target instanceof HTMLElement)) {
        return;
      }
      if (event.target.closest("[data-command-trigger='1']")) {
        return;
      }
      if (commandRef.current?.contains(event.target)) {
        return;
      }
      closeCommandPalette(true);
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [closeCommandPalette, commandOpen]);

  useEffect(() => {
    if (sidebarCollapsed && commandOpen) {
      closeCommandPalette(true);
    }
  }, [closeCommandPalette, commandOpen, sidebarCollapsed]);

  return {
    commandOpen,
    commandQuery,
    setCommandQuery,
    commandRef,
    filteredCommands,
    openCommandPalette,
    closeCommandPalette,
    toggleCommandPalette,
    runQuickCommand
  };
}
