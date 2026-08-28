"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { formatEGP } from "@/lib/format";
import { useTRPC } from "@/lib/trpc/react";

import { PosterField } from "./poster-field";

/** The provisioning form's fields, as strings. */
type Draft = {
  name: string;
  email: string;
  password: string;
  /** Empty string means "no picture" — `""` is what `PosterField` clears to. */
  image: string;
};

const BLANK: Draft = { name: "", email: "", password: "", image: "" };

/**
 * Which dialog is open, and on whom.
 *
 * One `<dialog>` serves both actions because they are the same form minus the
 * credentials; `null` is closed. Keeping the target's id here (rather than a
 * separate `editing` state alongside a boolean) makes "open on exactly one
 * thing" unrepresentable-otherwise.
 */
type Mode = { kind: "create" } | { kind: "edit"; id: string } | null;

/** Initials for an organizer with no picture. */
function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * The organizer roster, with provisioning, editing, and removal.
 *
 * Beyond spec §8's literal "events + totals", but the admin door already
 * promises "provision organizer accounts" and `adminRouter` ships the
 * procedures — this is where they become reachable.
 *
 * New accounts always land as `organizer`: `role` is `input: false` in Better
 * Auth, so there is no field for it here and promotion stays a deliberate,
 * separate act (lib/trpc/routers/admin.ts).
 *
 * The picture matters beyond decoration: `/organizers` renders it as the card's
 * artwork, so an organizer without one shows authored fallback art.
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

  const [mode, setMode] = useState<Mode>(null);
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

    if (mode && !dialog.open) dialog.showModal();
    else if (!mode && dialog.open) dialog.close();
  }, [mode]);

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
    // The public organizer index carries the same names and pictures, so an
    // edit here changes what `/organizers` shows.
    void queryClient.invalidateQueries({
      queryKey: trpc.events.listOrganizers.queryKey(),
    });
  }

  const create = useMutation(
    trpc.admin.createOrganizer.mutationOptions({
      onSuccess: () => {
        invalidate();
        setMode(null);
      },
    }),
  );

  const update = useMutation(
    trpc.admin.updateOrganizer.mutationOptions({
      onSuccess: () => {
        invalidate();
        setMode(null);
      },
    }),
  );

  const remove = useMutation(
    trpc.admin.deleteOrganizer.mutationOptions({ onSuccess: invalidate }),
  );

  function openCreate() {
    setDraft(BLANK);
    create.reset();
    update.reset();
    setMode({ kind: "create" });
  }

  function openEdit(organizer: (typeof organizers)[number]) {
    setDraft({
      name: organizer.name,
      email: organizer.email,
      password: "",
      image: organizer.image ?? "",
    });
    create.reset();
    update.reset();
    setMode({ kind: "edit", id: organizer.id });
  }

  function close() {
    setDraft(BLANK);
    // Clear a failed attempt so reopening doesn't show the last error.
    create.reset();
    update.reset();
    setMode(null);
  }

  // The one in flight, if either is. Both drive the same dialog, so the form
  // reads a single pending/error pair rather than branching at every use.
  const saving = mode?.kind === "edit" ? update : create;
  const pending = create.isPending || update.isPending || remove.isPending;
  // Each error renders where its action was taken: a failed save belongs in the
  // dialog the admin is still looking at, a failed delete on the row's panel.
  const panelError = remove.error;

  function onSubmit(submitEvent: React.FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    if (saving.isPending || !mode) return;

    // Mirrors the procedure's Zod schema so the obvious cases never round-trip.
    const name = draft.name.trim();
    const image = draft.image.trim();

    if (name.length < 1 || name.length > 100) return;

    if (mode.kind === "edit") {
      update.mutate({
        id: mode.id,
        name,
        // `null` clears the column; the procedure treats an absent key as "leave
        // alone", which is not what an emptied field means.
        image: image || null,
      });
      return;
    }

    const email = draft.email.trim();

    if (!email.includes("@")) return;
    if (draft.password.length < 8 || draft.password.length > 128) return;

    create.mutate({
      name,
      email,
      password: draft.password,
      // Omitted rather than null: there is no prior value to clear on a create.
      ...(image ? { image } : {}),
    });
  }

  const editing = mode?.kind === "edit";

  return (
    <div className="panel org-panel">
      <div className="panel-head">
        <h2>Organizers</h2>
        <button
          className="pill pill-sm btn-console"
          type="button"
          onClick={openCreate}
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
          {/* `table-layout: fixed` reads these — see events-table.tsx. */}
          <colgroup>
            <col style={{ width: "36%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "26%" }} />
          </colgroup>

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
                    <div className="org-row">
                      {organizer.image ? (
                        /* eslint-disable-next-line @next/next/no-img-element --
                           a pasted URL can point at any host, which next/image
                           would have to allow-list. */
                        <img
                          className="org-avatar"
                          src={organizer.image}
                          alt=""
                        />
                      ) : (
                        <span
                          className="org-avatar org-avatar-empty"
                          aria-hidden="true"
                        >
                          {initials(organizer.name)}
                        </span>
                      )}

                      <span>
                        <span className="tbl-title">{organizer.name}</span>
                        <span className="tbl-sub">{organizer.email}</span>
                      </span>
                    </div>
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
                        className="pill pill-sm btn-console"
                        type="button"
                        onClick={() => openEdit(organizer)}
                        // Admins are refused by `updateOrganizer` for the same
                        // reason they are by `deleteOrganizer`.
                        disabled={pending || isAdmin}
                        title={
                          isAdmin
                            ? "Admins cannot be edited here."
                            : undefined
                        }
                      >
                        Edit
                      </button>

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
          if (saving.isPending) e.preventDefault();
          else close();
        }}
        aria-labelledby="organizer-dialog-title"
      >
        {/* Mounted only while open, so the fields start from the current target
            and `autoFocus` lands on the name every time rather than only on the
            first open. */}
        {mode ? (
          <form onSubmit={onSubmit} noValidate>
            <div className="modal-head">
              <h3 id="organizer-dialog-title">
                {editing ? "Edit organizer" : "New organizer"}
              </h3>
            </div>

            <p className="modal-note">
              {editing ? (
                <>
                  Their name and picture as buyers see them on{" "}
                  <strong>/organizers</strong>. Email and password aren&rsquo;t
                  changed here.
                </>
              ) : (
                <>
                  They sign in at <strong>/sign-in</strong> with this email and
                  password. Accounts are always created as organizers.
                </>
              )}
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
                  disabled={saving.isPending}
                />
              </label>

              {editing ? null : (
                <>
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
                      disabled={saving.isPending}
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
                      disabled={saving.isPending}
                    />
                  </label>
                </>
              )}

              <PosterField
                label="Picture"
                hint="JPEG, PNG, WebP or AVIF · up to 4MB. Organizers without a picture get authored artwork."
                value={draft.image}
                onChange={(image) => setDraft({ ...draft, image })}
                disabled={saving.isPending}
              />
            </div>

            {saving.error ? (
              <p
                className="gate-error"
                role="alert"
                style={{ margin: "16px 22px 0" }}
              >
                {saving.error.message}
              </p>
            ) : null}

            <div className="modal-foot">
              <button
                className="pill pill-sm btn-console"
                type="button"
                onClick={close}
                disabled={saving.isPending}
              >
                Cancel
              </button>
              <button
                className="pill pill-sm pill-turq"
                type="submit"
                disabled={saving.isPending}
              >
                {saving.isPending
                  ? "Saving…"
                  : editing
                    ? "Save changes"
                    : "Create organizer"}
              </button>
            </div>
          </form>
        ) : null}
      </dialog>
    </div>
  );
}
