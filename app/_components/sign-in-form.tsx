"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { signIn } from "@/lib/auth-client";

/**
 * The only client JS on the sign-in screen. Better Auth sets the session cookie
 * from the `/api/auth` handler's response, so success is just a navigation —
 * `router.refresh()` makes the server re-read the new cookie before we push.
 *
 * Errors stay generic on purpose: an invalid email and a wrong password give
 * the same message, so the form can't be used to enumerate accounts.
 */
export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();

  // Where the middleware/guard bounced them from. Same-origin paths only —
  // an absolute URL here would be an open redirect.
  const raw = params.get("next");
  const next = raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);

    const { error: signInError } = await signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      rememberMe: form.get("remember") === "on",
    });

    if (signInError) {
      setError(
        signInError.status === 401 || signInError.status === 403
          ? "That email and password don't match an organizer account."
          : "Something went wrong on our end. Try again in a moment.",
      );
      setPending(false);
      return;
    }

    router.refresh();
    router.push(next);
  }

  return (
    <form className="gate-form" onSubmit={onSubmit} noValidate>
      {error ? (
        <p className="gate-error" role="alert">
          {error}
        </p>
      ) : null}

      <label className="fld">
        <span>Email</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          autoFocus
          placeholder="you@venue.eg"
          disabled={pending}
        />
      </label>

      <label className="fld">
        <span>Password</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
          disabled={pending}
        />
      </label>

      <div className="gate-form-row">
        <label className="chk">
          <input type="checkbox" name="remember" defaultChecked disabled={pending} />
          <span>Keep me signed in</span>
        </label>
      </div>

      <button className="pill pill-turq gate-submit" type="submit" disabled={pending}>
        {pending ? "Checking…" : "Sign in →"}
      </button>
    </form>
  );
}
