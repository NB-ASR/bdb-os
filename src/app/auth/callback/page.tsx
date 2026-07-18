"use client";

import { useEffect, useState } from "react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { Loader2, ShieldCheck } from "lucide-react";
import { BdbMonogram } from "@/components/brand";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/workspace";
  return value;
}

export default function AuthCallbackPage() {
  const [message, setMessage] = useState("Securing your BDB OS session…");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;

    async function completeAuthentication() {
      try {
        if (!isSupabaseConfigured()) {
          throw new Error("BDB OS authentication is not configured for this deployment.");
        }

        const url = new URL(window.location.href);
        const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
        const next = safeNext(url.searchParams.get("next"));
        const returnedError =
          url.searchParams.get("error_description") ??
          hash.get("error_description");

        if (returnedError) throw new Error(returnedError.replace(/\+/g, " "));

        const supabase = createClient();
        const code = url.searchParams.get("code");
        const tokenHash = url.searchParams.get("token_hash");
        const type = url.searchParams.get("type") as EmailOtpType | null;
        const accessToken = hash.get("access_token");
        const refreshToken = hash.get("refresh_token");

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (tokenHash && type) {
          const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
          if (error) throw error;
        } else if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
        } else {
          const { data, error } = await supabase.auth.getSession();
          if (error || !data.session) {
            throw error ?? new Error("This invitation link is invalid or has expired.");
          }
        }

        window.history.replaceState({}, "", url.pathname);
        window.location.replace(next);
      } catch (error) {
        if (!active) return;
        const detail = error instanceof Error ? error.message : "The secure link could not be verified.";
        setMessage(
          detail.toLowerCase().includes("expired") || detail.toLowerCase().includes("invalid")
            ? "This invitation has expired or has already been used. Ask a BDB OS administrator to resend it."
            : detail,
        );
        setFailed(true);
      }
    }

    void completeAuthentication();
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="mfa-shell">
      <BdbMonogram />
      <section className="mfa-card">
        <span className="mfa-icon">
          {failed ? <ShieldCheck size={25} /> : <Loader2 className="spin" size={25} />}
        </span>
        <p className="marketing-kicker">Secure BDB OS access</p>
        <h1>{failed ? "Invitation unavailable" : "Opening your account"}</h1>
        <p>{message}</p>
        {failed && (
          <button className="marketing-primary" onClick={() => window.location.replace("/login")}>
            Return to sign in
          </button>
        )}
      </section>
    </main>
  );
}
