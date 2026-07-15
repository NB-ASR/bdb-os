"use client";

import { useEffect, useState } from "react";
import { Bell, Download } from "lucide-react";

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function applicationServerKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(window.atob(base64), (character) => character.charCodeAt(0));
}

export function MobileActions() {
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  // Keep the first client render identical to the server render. Permission is
  // updated only after a user action, avoiding browser-only hydration branches.
  const [notifications, setNotifications] = useState<NotificationPermission>("default");

  useEffect(() => {
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallEvent);
    };

    window.addEventListener("beforeinstallprompt", onInstall);
    return () => window.removeEventListener("beforeinstallprompt", onInstall);
  }, []);

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === "accepted") setInstallEvent(null);
  }

  async function enableNotifications() {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return;
    const permission = await Notification.requestPermission();
    setNotifications(permission);
    if (permission !== "granted") return;

    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!key) {
      new Notification("BDB OS notifications enabled", {
        body: "Appointment reminders will appear on this device when production push is configured.",
      });
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(key),
    });
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });
  }

  return (
    <div className="mobile-actions">
      {installEvent && (
        <button className="icon-button" onClick={() => void install()} title="Install BDB OS">
          <Download size={16} />
        </button>
      )}
      <button
        className={`icon-button ${notifications === "granted" ? "enabled" : ""}`}
        onClick={() => void enableNotifications()}
        title="Appointment notifications"
      >
        <Bell size={16} />
      </button>
    </div>
  );
}
