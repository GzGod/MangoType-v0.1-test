"use client";

import { useEffect, useState } from "react";

export type AuthConfigState = {
  ready: boolean;
  hasAuthSecret: boolean;
  hasTwitterProvider: boolean;
  checked: boolean;
};

const DEFAULT_AUTH_CONFIG: AuthConfigState = {
  ready: true,
  hasAuthSecret: true,
  hasTwitterProvider: true,
  checked: false
};

export function useAuthConfig() {
  const [authConfig, setAuthConfig] = useState<AuthConfigState>(DEFAULT_AUTH_CONFIG);

  useEffect(() => {
    let active = true;

    async function loadAuthConfig() {
      try {
        const response = await fetch("/api/auth/config-status", {
          method: "GET",
          cache: "no-store"
        });
        if (!response.ok) {
          throw new Error("auth-config-failed");
        }
        const payload = (await response.json()) as {
          ready?: boolean;
          hasAuthSecret?: boolean;
          hasTwitterProvider?: boolean;
        };
        if (!active) {
          return;
        }
        setAuthConfig({
          ready: Boolean(payload.ready),
          hasAuthSecret: Boolean(payload.hasAuthSecret),
          hasTwitterProvider: Boolean(payload.hasTwitterProvider),
          checked: true
        });
      } catch {
        if (!active) {
          return;
        }
        setAuthConfig((prev) => ({
          ...prev,
          ready: false,
          checked: true
        }));
      }
    }

    void loadAuthConfig();

    return () => {
      active = false;
    };
  }, []);

  return authConfig;
}
