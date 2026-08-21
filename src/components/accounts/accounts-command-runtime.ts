"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  enqueueAccountsCommand,
  flushAccountsQueue,
  readAccountsQueue,
  type AccountsCommandAction,
} from "@/lib/modules/accounts-queue";
import {
  cacheAccountsWorkspaceContext,
  readAccountsWorkspaceContext,
} from "@/lib/modules/accounts-working-cache";

type DispatchResult = { ok: boolean; pending: boolean };

export function useAccountsCommandRuntime() {
  const [workspaceId, setWorkspaceId] = useState("");
  const workspaceRef = useRef("");
  const [online, setOnline] = useState(true);
  const [supportReadOnly, setSupportReadOnly] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const automaticSyncAttemptRef = useRef("");

  const refreshQueue = useCallback((targetWorkspaceId = workspaceRef.current) => {
    setPendingCount(targetWorkspaceId ? readAccountsQueue(targetWorkspaceId).length : 0);
  }, []);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function initialise() {
      setLoading(true);
      try {
        const response = await fetch("/api/workspace/context", { cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.currentWorkspaceId) {
          throw new Error(result.error ?? "The current workspace could not be resolved.");
        }
        if (!active) return;
        cacheAccountsWorkspaceContext(result);
        const id = String(result.currentWorkspaceId);
        workspaceRef.current = id;
        setWorkspaceId(id);
        setSupportReadOnly(Boolean(result.supportAccess && result.supportAccessMode !== "test_write"));
        refreshQueue(id);
      } catch (initialError) {
        if (!active) return;
        const cached = readAccountsWorkspaceContext();
        if (cached?.currentWorkspaceId) {
          workspaceRef.current = cached.currentWorkspaceId;
          setWorkspaceId(cached.currentWorkspaceId);
          setSupportReadOnly(Boolean(cached.supportAccess && cached.supportAccessMode !== "test_write"));
          refreshQueue(cached.currentWorkspaceId);
          setNotice("Offline working context loaded. New Accounts changes will remain Pending sync until the live workspace is verified again.");
        } else {
          setError(initialError instanceof Error ? initialError.message : "Accounts could not be opened.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void initialise();
    return () => { active = false; };
  }, [refreshQueue]);

  useEffect(() => {
    if (!online || !workspaceId || pendingCount === 0 || busy) return;
    const attemptKey = `${workspaceId}:${pendingCount}`;
    if (automaticSyncAttemptRef.current === attemptKey) return;
    const timer = window.setTimeout(async () => {
      automaticSyncAttemptRef.current = attemptKey;
      setBusy("sync");
      const result = await flushAccountsQueue(workspaceId, () => refreshQueue(workspaceId));
      refreshQueue(workspaceId);
      setBusy("");
      if (result.completed) {
        setNotice(`${result.completed} queued Accounts change${result.completed === 1 ? "" : "s"} synchronised.`);
      }
      if (result.remaining) {
        const failed = readAccountsQueue(workspaceId)[0];
        setError(failed?.lastError ?? "Accounts synchronisation stopped for review.");
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [busy, online, pendingCount, refreshQueue, workspaceId]);

  const dispatch = useCallback(async (
    action: AccountsCommandAction,
    payload: Record<string, unknown>,
  ): Promise<DispatchResult> => {
    setError("");
    setNotice("");
    if (supportReadOnly || !workspaceId) {
      setError("This Accounts workspace is read-only for the current session.");
      return { ok: false, pending: false };
    }
    const command = enqueueAccountsCommand(workspaceId, action, payload);
    refreshQueue(workspaceId);
    if (!navigator.onLine) {
      setNotice("Saved as Pending sync. It will be revalidated and applied safely after reconnection.");
      return { ok: true, pending: true };
    }

    setBusy(action);
    const result = await flushAccountsQueue(workspaceId, () => refreshQueue(workspaceId));
    setBusy("");
    refreshQueue(workspaceId);
    if (result.remaining) {
      const failed = readAccountsQueue(workspaceId).find((item) => item.id === command.id);
      setError(failed?.lastError ?? "Accounts synchronisation stopped for review.");
      return { ok: false, pending: false };
    }
    return { ok: true, pending: false };
  }, [refreshQueue, supportReadOnly, workspaceId]);

  return {
    workspaceId,
    online,
    supportReadOnly,
    pendingCount,
    loading,
    busy,
    error,
    notice,
    setError,
    setNotice,
    dispatch,
  };
}
