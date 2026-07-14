"use client";

import { useEffect, useState } from "react";
import { Download, Smartphone } from "lucide-react";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaInstallButton({ compact = false }: { compact?: boolean }) {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    const frame = window.requestAnimationFrame(() => {
      setInstalled(standalone);
      setIos(/iPad|iPhone|iPod/.test(navigator.userAgent) && !standalone);
    });
    const capture = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    const complete = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", complete);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", complete);
    };
  }, []);

  if (installed) return compact ? null : <span className="pwa-installed"><Smartphone size={15} /> Installed on this device</span>;
  if (!prompt && !ios) return null;

  if (ios) return <span className={compact ? "pwa-ios compact" : "pwa-ios"}><Smartphone size={15} /> In Safari, tap Share then Add to Home Screen</span>;
  return <button className={compact ? "pwa-install compact" : "pwa-install"} onClick={async () => { await prompt?.prompt(); const choice = await prompt?.userChoice; if (choice?.outcome === "accepted") setInstalled(true); setPrompt(null); }}><Download size={15} /> {compact ? "Install" : "Install BDB OS on this device"}</button>;
}
