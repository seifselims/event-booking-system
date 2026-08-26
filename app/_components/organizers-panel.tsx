"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { formatEGP } from "@/lib/format";
import { useTRPC } from "@/lib/trpc/react";

/** The provisioning form's fields, as strings. */
type Draft = {
  name: string;
  email: string;
  password: string;
};

const BLANK: Draft = { name: "", email: "", password: "" };

/**
 * The organizer roster, with provisioning and removal.
 *
 * Beyond spec §8's literal "events + totals", but the admin door already
 * promises "provision organizer accounts" and `adminRouter` ships all three
 * procedures — this is where they become reachable.
 *
 * New accounts always land as `organizer`: `role` is `input: false` in Better
 * Auth, so there is no field for it here and promotion stays a deliberate,
 * separate act (lib/trpc/routers/admin.ts).
 *
 * `currentUserId` is a prop, not a query — session data never routes through
 * the tRPC cache.
 */
export function OrganizersPanel({ currentUserId }: { currentUserId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { data: organizers } = useSuspenseQuery(
    trpc.admin.listOrganizers.queryOptions(),
  );

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // `showModal()` is imperative, but whether the dialog is open is state — so
  // the state drives the element rather than the click handlers calling into
  // the ref directly. `showModal()` (not the `open` attribute) is what puts the
  // dialog in the top layer, giving us focus trapping, an inert background, the
  // ::backdrop, and Escape-to-close from the platform instead of hand-rolled.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (adding && !dialog.open) dialog.showModal();
    else if (!adding && dialog.open) dialog.close();
  }, [adding]);

  function invalidate() {
    void queryClient.invalidateQueries({
      queryKey: trpc.admin.listOrganizers.queryKey(),
    });
    // The roster is not the only thing a write moves: creating changes the
    // organizer count, and deleting cascades to that organizer's events, so
    // the totals and the events table go stale too. `staleTime` is 30s, so a
    // missed key shows an old number rather than refetching.
    void queryClient.invalidateQueries({
      queryKey: trpc.admin.platformTotals.queryKey(),
    });
    void queryClient.invalidateQueries({
      queryKey: trpc.admin.listAllEvents.queryKey(),
    });
  }

  const create = useMutation(
    trpc.admin.createOrganizer.mutationOptions({
      onSuccess: () => {
        invalidate();
        setAdding(false);
      },
    }),
  );

  const remove = useMutation(
    trpc.admin.deleteOrganizer.mutationOptions({ onSuccess: invalidate }),
  );

  function open() {
    setDraft(BLANK);
    create.reset();
    setAdding(true);
  }

  function close() {
    setDraft(BLANK);
    // Clear a failed attempt so reopening doesn't show the last error.
    create.reset();
    setAdding(false);
  }

  const pending = create.isPending || remove.isPending;
  // Each error renders where its action was taken: a failed creation belongs in
  // the dialog the admin is still looking at, a failed delete on the row's panel.
  const panelError = remove.error;

  function onSubmit(submitEvent: React.FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    if (create.isPending) return;

    // Mirrors the procedure's Zod schema so the obvious cases never round-trip.
    const name = draft.name.trim();
    const email = draft.email.trim();

    if (name.length < 1 || name.length > 100) return;
    if (!email.includes("@")) return;
    if (draft.password.length < 8 || draft.password.length > 128) return;

    create.mutate({ name, email, password: draft.password });
  }

  return (
    <div className="panel org-panel">
      <div className="panel-head">
        <h2>Organizers</h2>
        <button
          className="pill pill-sm btn-console"
          type="button"
          onClick={open}
          disabled={pending}
        >
          + Add organizer
        </button>
      </div>

      {panelError ? (
        <p
          className="gate-error"
          role="alert"
          style={{ margin: "18px 22px 0" }}
        >
          {panelError.message}
        </p>
      ) : null}

      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Organizer</th>
              <th>Role</th>
              <th className="ta-r">Events</th>
              <th className="ta-r">Revenue</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {organizers.map((organizer) => {
              const isSelf = organizer.id === currentUserId;
              const isAdmin = organizer.role === "admin";
              // The two refusals that are knowable here. The third — an
              // organizer holding paid orders — is not: a refunded order was
              // paid once, so `grossPiastres` cannot rule it out. That one has
              // to come back from the server as PRECONDITION_FAILED.
              const locked = isSelf || isAdmin;

              return (
                <tr key={organizer.id}>
                  <td>
                    <span className="tbl-title">{organizer.name}</span>
                    <span className="tbl-sub">{organizer.email}</span>
                  </td>

                  <td>
                    <span className={`tag tag-role-${organizer.role}`}>
                      {isAdmin ? "Admin" : "Organizer"}
                    </span>
                  </td>

                  <td className="ta-r num">{organizer.events}</td>

                  <td className="ta-r num tbl-strong">
                    {formatEGP(organizer.grossPiastres)}
                  </td>

                  <td>
                    <div className="tier-acts">
                      <button
                        className="pill pill-sm btn-danger"
                        type="button"
                        onClick={() => {
                          if (
                            confirm(
                              `Delete ${organizer.name}? This also deletes their events, ticket tiers, orders, and tickets. This can't be undone.`,
                            )
                          ) {
                            remove.mutate({ id: organizer.id });
                          }
                        }}
                        disabled={pending || locked}
                        title={
                          isSelf
                            ? "You cannot delete your own account."
                            : isAdmin
                              ? "Admins cannot be deleted here."
                              : undefined
                        }
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* `onCancel` covers Escape and any other platform-initiated close, so the
          draft is cleared however the dialog goes away. `onClose` would fire on
          our own `close()` too and recurse. */}
      <dialog
        className="modal"
        ref={dialogRef}
        onCancel={(e) => {
          // Never let Escape strand a request that is already in flight.
          if (create.isPending) e.preventDefault();
          else close();
        }}
        aria-labelledby="new-organizer-title"
      >
        {/* Mounted only while open, so the fields start blank and `autoFocus`
            lands on the name every time rather than only on the first open. */}
        {adding ? (
          <form onSubmit={onSubmit} noValidate>
            <div className="modal-head">
              <h3 id="new-organizer-title">New organizer</h3>
            </div>

            <p className="modal-note">
              They sign in at <strong>/sign-in</strong> with this email and
              password. Accounts are always created as organizers.
            </p>

            <div className="modal-body org-grid">
              <label className="fld">
                <span>Name</span>
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  maxLength={100}
                  required
                  autoFocus
                  placeholder="Nadia Fouad"
                  disabled={create.isPending}
                />
              </label>

              <label className="fld">
                <span>Email</span>
                <input
                  type="email"
                  value={draft.email}
                  onChange={(e) =>
                    setDraft({ ...draft, email: e.target.value })
                  }
                  required
                  autoComplete="off"
                  placeholder="nadia@example.com"
                  disabled={create.isPending}
                />
              </label>

              <label className="fld">
                <span>Password</span>
                <input
                  type="password"
                  value={draft.password}
                  onChange={(e) =>
                    setDraft({ ...draft, password: e.target.value })
                  }
                  minLength={8}
                  maxLength={128}
                  required
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  disabled={create.isPending}
                />
              </label>
            </div>

            {create.error ? (
              <p
                className="gate-error"
                role="alert"
                style={{ margin: "16px 22px 0" }}
              >
                {create.error.message}
              </p>
            ) : null}

            <div className="modal-foot">
              <button
                className="pill pill-sm btn-console"
                type="button"
                onClick={close}
                disabled={create.isPending}
              >
                Cancel
              </button>
              <button
                className="pill pill-sm pill-turq"
                type="submit"
                disabled={create.isPending}
              >
                {create.isPending ? "Creating…" : "Create organizer"}
              </button>
            </div>
          </form>
        ) : null}
      </dialog>
    </div>
  );
}
