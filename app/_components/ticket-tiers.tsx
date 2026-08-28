"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { formatEGP } from "@/lib/format";
import { useTRPC } from "@/lib/trpc/react";
import type { RouterOutputs } from "@/lib/trpc/types";

type Event = RouterOutputs["events"]["getMyEvent"];
type Tier = Event["ticketTypes"][number];

/** The tier form's fields, as strings — prices in pounds, not piastres. */
type Draft = {
  name: string;
  price: string;
  quantity: string;
  maxPerOrder: string;
};

const BLANK: Draft = { name: "", price: "", quantity: "", maxPerOrder: "10" };

function toDraft(tier: Tier): Draft {
  return {
    name: tier.name,
    // Divide only to render (lib/format.ts) — the stored value stays integral.
    price: (tier.pricePiastres / 100).toString(),
    quantity: tier.quantity.toString(),
    maxPerOrder: tier.maxPerOrder.toString(),
  };
}

/**
 * The event's ticket tiers.
 *
 * Money is integer piastres everywhere behind this form (AGENTS.md): the input
 * takes pounds because that is what an organizer thinks in, and converts once on
 * submit. Nothing downstream ever sees the divided value.
 *
 * `quantity` here is capacity, not availability — availability is derived from
 * orders under a row lock at purchase time (spec §5.3).
 */
export function TicketTiers({ event }: { event: Event }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // `null` = closed, `"new"` = the add form, otherwise the tier being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(BLANK);

  function invalidate() {
    // A tier change can flip `events.status` via `syncSoldOut`, so the event
    // itself is stale too, not just the tier list.
    void queryClient.invalidateQueries({
      queryKey: trpc.events.getMyEvent.queryKey({ id: event.id }),
    });
    void queryClient.invalidateQueries({
      queryKey: trpc.events.getMyEventsWithStats.queryKey(),
    });
  }

  function close() {
    setEditing(null);
    setDraft(BLANK);
  }

  const create = useMutation(
    trpc.tickets.createTicketType.mutationOptions({
      onSuccess: () => {
        invalidate();
        close();
      },
    }),
  );

  const update = useMutation(
    trpc.tickets.updateTicketType.mutationOptions({
      onSuccess: () => {
        invalidate();
        close();
      },
    }),
  );

  const remove = useMutation(
    trpc.tickets.deleteTicketType.mutationOptions({ onSuccess: invalidate }),
  );

  const pending = create.isPending || update.isPending || remove.isPending;
  const error = create.error ?? update.error ?? remove.error;

  function onSubmit(submitEvent: React.FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    if (pending) return;

    const pricePiastres = Math.round(Number(draft.price) * 100);
    const quantity = Number(draft.quantity);
    const maxPerOrder = Number(draft.maxPerOrder);

    if (!Number.isFinite(pricePiastres) || pricePiastres < 0) return;
    if (!Number.isInteger(quantity) || quantity < 1) return;

    const fields = {
      name: draft.name.trim(),
      pricePiastres,
      quantity,
      maxPerOrder: Number.isInteger(maxPerOrder) ? maxPerOrder : 10,
    };

    if (editing === "new") {
      create.mutate({ eventId: event.id, ...fields });
    } else if (editing) {
      update.mutate({ id: editing, ...fields });
    }
  }

  const tiers = [...event.ticketTypes].sort(
    (a, b) => a.pricePiastres - b.pricePiastres,
  );

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Ticket tiers</h2>
        <button
          className="pill pill-sm btn-console"
          type="button"
          onClick={() => {
            setEditing("new");
            setDraft(BLANK);
          }}
          disabled={pending || editing === "new"}
        >
          + Add tier
        </button>
      </div>

      {error ? (
        <p className="gate-error" role="alert" style={{ margin: "18px 22px 0" }}>
          {error.message}
        </p>
      ) : null}

      {tiers.length === 0 ? (
        <div className="ed-body">
          <p className="status-note">
            No tiers yet. An event needs at least one before it can sell
            anything.
          </p>
        </div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            {/* `table-layout: fixed` reads these — see events-table.tsx. */}
            <colgroup>
              <col style={{ width: "34%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "26%" }} />
            </colgroup>

            <thead>
              <tr>
                <th>Tier</th>
                <th className="ta-r">Price</th>
                <th className="ta-r">Capacity</th>
                <th className="ta-r">Max / order</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier) => (
                <tr key={tier.id}>
                  <td>
                    <span className="tbl-title">{tier.name}</span>
                  </td>
                  <td className="ta-r num tier-price">
                    {formatEGP(tier.pricePiastres)}
                  </td>
                  <td className="ta-r num">{tier.quantity}</td>
                  <td className="ta-r num">{tier.maxPerOrder}</td>
                  <td>
                    <div className="tier-acts">
                      <button
                        className="pill pill-sm btn-console"
                        type="button"
                        onClick={() => {
                          setEditing(tier.id);
                          setDraft(toDraft(tier));
                        }}
                        disabled={pending}
                      >
                        Edit
                      </button>
                      <button
                        className="pill pill-sm btn-danger"
                        type="button"
                        onClick={() => {
                          if (
                            confirm(
                              `Delete the "${tier.name}" tier? This can't be undone.`,
                            )
                          ) {
                            remove.mutate({ id: tier.id });
                          }
                        }}
                        disabled={pending}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <form className="tier-form" onSubmit={onSubmit} noValidate>
          <h3>{editing === "new" ? "New tier" : "Edit tier"}</h3>

          <div className="tier-grid">
            <label className="fld">
              <span>Name</span>
              <input
                type="text"
                value={draft.name}
                onChange={(e) =>
                  setDraft({ ...draft, name: e.target.value })
                }
                maxLength={100}
                required
                autoFocus
                placeholder="Early bird"
                disabled={pending}
              />
            </label>

            <label className="fld">
              <span>Price</span>
              <input
                type="number"
                value={draft.price}
                onChange={(e) =>
                  setDraft({ ...draft, price: e.target.value })
                }
                min={0}
                step="0.01"
                required
                placeholder="250"
                disabled={pending}
              />
              <span className="fld-hint">EGP</span>
            </label>

            <label className="fld">
              <span>Capacity</span>
              <input
                type="number"
                value={draft.quantity}
                onChange={(e) =>
                  setDraft({ ...draft, quantity: e.target.value })
                }
                min={1}
                step={1}
                required
                placeholder="100"
                disabled={pending}
              />
            </label>

            <label className="fld">
              <span>Max / order</span>
              <input
                type="number"
                value={draft.maxPerOrder}
                onChange={(e) =>
                  setDraft({ ...draft, maxPerOrder: e.target.value })
                }
                min={1}
                max={100}
                step={1}
                disabled={pending}
              />
            </label>
          </div>

          <div className="tier-foot">
            <button
              className="pill pill-sm btn-console"
              type="button"
              onClick={close}
              disabled={pending}
            >
              Cancel
            </button>
            <button
              className="pill pill-sm pill-turq"
              type="submit"
              disabled={pending}
            >
              {pending ? "Saving…" : editing === "new" ? "Add tier" : "Save tier"}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
