"use client";

import { upload } from "@vercel/blob/client";
import { useRef, useState } from "react";

const MAX_BYTES = 4 * 1024 * 1024;

const ACCEPT = "image/jpeg,image/png,image/webp,image/avif";

/**
 * The poster: upload a file, or paste a URL.
 *
 * Both paths end at the same place — a string in `events.poster_url` — so this
 * owns no state of its own beyond the in-flight upload. The value lives in the
 * parent form's draft, which keeps the dirty-gating and the save in one place.
 *
 * The file goes browser -> Vercel Blob directly, with `/api/upload` issuing a
 * scoped token first (see that route). Uploading does not save the event: the
 * organizer still has to press Save, so a mistaken pick can be undone by
 * clearing the field rather than by a second write.
 */
export function PosterField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (url: string) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(file: File) {
    setError(null);

    // Checked here for a fast, clear message; the token issuer enforces the
    // same two limits server-side, where they actually bind.
    if (!ACCEPT.split(",").includes(file.type)) {
      setError("That file isn't a JPEG, PNG, WebP or AVIF image.");
      return;
    }

    if (file.size > MAX_BYTES) {
      setError("That image is larger than 4MB.");
      return;
    }

    setUploading(true);

    try {
      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/upload",
      });

      onChange(blob.url);
    } catch {
      setError("Couldn't upload that image. Try again in a moment.");
    } finally {
      setUploading(false);

      // Let the same file be picked again after a failure — without this the
      // input holds the old selection and `change` never fires.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const busy = disabled || uploading;

  return (
    <div className="fld fld-wide">
      <span>Poster</span>

      <div className="poster-field">
        {value ? (
          /* eslint-disable-next-line @next/next/no-img-element -- a pasted URL
             can point at any host, which next/image would have to allow-list. */
          <img className="poster-thumb" src={value} alt="" />
        ) : (
          <div className="poster-thumb poster-thumb-empty" aria-hidden="true">
            No poster
          </div>
        )}

        <div className="poster-controls">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="poster-file"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onPick(file);
            }}
          />

          <div className="poster-actions">
            <button
              type="button"
              className="pill btn-console"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {uploading
                ? "Uploading…"
                : value
                  ? "Replace image"
                  : "Upload image"}
            </button>

            {value ? (
              <button
                type="button"
                className="pill btn-danger"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  onChange("");
                }}
              >
                Remove
              </button>
            ) : null}
          </div>

          <input
            type="url"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="…or paste an image URL"
            disabled={busy}
          />

          {error ? (
            <span className="poster-error" role="alert">
              {error}
            </span>
          ) : (
            <span className="fld-hint">
              JPEG, PNG, WebP or AVIF · up to 4MB. Events without a poster get
              authored artwork.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
