/**
 * Authored sleeve art for events without a poster.
 *
 * `events.posterUrl` is nullable in the schema, so this is a permanent
 * fallback, not a placeholder: an organizer who never uploads a poster still
 * gets a card that belongs to the design.
 *
 * Colours are drawn from the rack palette so each variant sits correctly on
 * its card's ground. Variants are picked by position for now; keying off a
 * hash of `event.id` would keep art stable as the list reorders.
 */

type EventArtProps = {
  /** 0–5. Callers pass `index % 6`. */
  variant: number;
  title?: string;
};

export function EventArt({ variant, title }: EventArtProps) {
  const label = title ? `Artwork for ${title}` : undefined;
  const a11y = label
    ? { role: "img" as const, "aria-label": label }
    : { "aria-hidden": true as const };

  switch (variant % 6) {
    // Sunset over water with a crowd — the house style.
    case 0:
      return (
        <svg viewBox="0 0 300 268" {...a11y}>
          <rect width="300" height="268" fill="#00C7C3" />
          <circle cx="150" cy="104" r="72" fill="#FFC93C" />
          <g fill="#00C7C3" opacity="0.55">
            <rect x="82" y="132" width="136" height="7" rx="3.5" />
            <rect x="82" y="148" width="136" height="5" rx="2.5" />
          </g>
          <rect y="196" width="300" height="72" fill="#3A1F16" />
          <g fill="#3A1F16">
            <circle cx="52" cy="190" r="14" />
            <circle cx="96" cy="197" r="11" />
            <circle cx="138" cy="186" r="15" />
            <circle cx="184" cy="196" r="12" />
            <circle cx="226" cy="188" r="14" />
            <circle cx="268" cy="196" r="11" />
          </g>
          <g stroke="#3A1F16" strokeWidth="5" strokeLinecap="round">
            <path d="M40 186l-7-19M64 186l7-19M126 182l-8-21M150 182l8-21" />
          </g>
          <g stroke="#00C7C3" strokeWidth="2.5" fill="none" opacity="0.75">
            <path d="M0 216q26-9 52 0t52 0 52 0 52 0 52 0 52 0" />
            <path
              d="M0 236q26-9 52 0t52 0 52 0 52 0 52 0 52 0"
              opacity="0.5"
            />
          </g>
        </svg>
      );

    // Stacked speech bars — talks and conferences.
    case 1:
      return (
        <svg viewBox="0 0 300 268" {...a11y}>
          <rect width="300" height="268" fill="#F6D6B3" />
          <g fill="#E8452C">
            <rect x="30" y="60" width="240" height="26" rx="13" />
            <rect x="30" y="102" width="180" height="26" rx="13" />
            <rect x="30" y="144" width="210" height="26" rx="13" />
          </g>
          <circle cx="242" cy="196" r="40" fill="#3A1F16" />
          <circle cx="242" cy="196" r="13" fill="#F6D6B3" />
        </svg>
      );

    // Concentric rings — orchestral, a record seen head-on.
    case 2:
      return (
        <svg viewBox="0 0 300 268" {...a11y}>
          <rect width="300" height="268" fill="#E8452C" />
          <g fill="none" stroke="#FFF8EE" strokeWidth="3" opacity="0.85">
            <circle cx="150" cy="134" r="30" />
            <circle cx="150" cy="134" r="52" />
            <circle cx="150" cy="134" r="74" />
            <circle cx="150" cy="134" r="96" />
          </g>
          <circle cx="150" cy="134" r="13" fill="#FFC93C" />
        </svg>
      );

    // A microphone — comedy.
    case 3:
      return (
        <svg viewBox="0 0 300 268" {...a11y}>
          <rect width="300" height="268" fill="#FFC93C" />
          <path
            d="M150 44c34 0 62 26 62 60v40c0 34-28 60-62 60s-62-26-62-60V104c0-34 28-60 62-60z"
            fill="#3A1F16"
          />
          <rect x="140" y="204" width="20" height="34" rx="10" fill="#3A1F16" />
          <rect x="104" y="238" width="92" height="14" rx="7" fill="#3A1F16" />
          <g stroke="#FFC93C" strokeWidth="3">
            <path d="M110 96h80M110 120h80M110 144h80" />
          </g>
        </svg>
      );

    // An equaliser under a moon — late electronic sets.
    case 4:
      return (
        <svg viewBox="0 0 300 268" {...a11y}>
          <rect width="300" height="268" fill="#3A1F16" />
          <circle cx="216" cy="70" r="42" fill="#F6D6B3" />
          <g fill="#00C7C3">
            <rect x="24" y="150" width="16" height="94" rx="8" />
            <rect x="52" y="120" width="16" height="124" rx="8" />
            <rect x="80" y="168" width="16" height="76" rx="8" />
            <rect x="108" y="134" width="16" height="110" rx="8" />
            <rect x="136" y="180" width="16" height="64" rx="8" />
            <rect x="164" y="146" width="16" height="98" rx="8" />
            <rect x="192" y="192" width="16" height="52" rx="8" />
            <rect x="220" y="160" width="16" height="84" rx="8" />
            <rect x="248" y="200" width="16" height="44" rx="8" />
          </g>
        </svg>
      );

    // A ball, split — sport.
    default:
      return (
        <svg viewBox="0 0 300 268" {...a11y}>
          <rect width="300" height="268" fill="#FFF8EE" />
          <circle cx="150" cy="134" r="80" fill="#00C7C3" />
          <path
            d="M150 54c22 22 34 50 34 80s-12 58-34 80c-22-22-34-50-34-80s12-58 34-80z"
            fill="#FFF8EE"
          />
          <path d="M70 134h160" stroke="#FFF8EE" strokeWidth="7" />
          <circle cx="150" cy="134" r="13" fill="#E8452C" />
        </svg>
      );
  }
}

/**
 * The hero sleeve's art — a larger, squarer composition than the rack
 * variants, used once. Its gradient id is unique to this component.
 */
export function SleeveArt() {
  return (
    <svg viewBox="0 0 400 400" role="img" aria-label="Nile Delta Nights sleeve">
      <defs>
        <radialGradient id="gate-sleeve-sun" cx="50%" cy="42%" r="52%">
          <stop offset="0" stopColor="#FFE07A" />
          <stop offset="0.55" stopColor="#FFC93C" />
          <stop offset="1" stopColor="#FF7A1A" />
        </radialGradient>
      </defs>
      <rect width="400" height="400" fill="#00C7C3" />
      <circle cx="200" cy="158" r="104" fill="url(#gate-sleeve-sun)" />
      <g fill="#00C7C3" opacity="0.55">
        <rect x="96" y="196" width="208" height="9" rx="4.5" />
        <rect x="96" y="216" width="208" height="7" rx="3.5" />
        <rect x="96" y="234" width="208" height="5" rx="2.5" />
      </g>
      <rect y="286" width="400" height="114" fill="#3A1F16" />
      <g stroke="#00C7C3" strokeWidth="3.4" fill="none" strokeLinecap="round">
        <path
          d="M12 312q26-12 52 0t52 0 52 0 52 0 52 0 52 0"
          opacity="0.9"
        />
        <path
          d="M12 338q26-12 52 0t52 0 52 0 52 0 52 0 52 0"
          opacity="0.6"
        />
        <path
          d="M12 364q26-12 52 0t52 0 52 0 52 0 52 0 52 0"
          opacity="0.35"
        />
      </g>
      <g fill="#3A1F16">
        <circle cx="44" cy="276" r="19" />
        <rect x="30" y="276" width="28" height="26" rx="12" />
        <circle cx="96" cy="284" r="15" />
        <rect x="85" y="284" width="22" height="20" rx="10" />
        <circle cx="146" cy="272" r="20" />
        <rect x="131" y="272" width="30" height="28" rx="13" />
        <circle cx="202" cy="282" r="16" />
        <rect x="190" y="282" width="24" height="22" rx="11" />
        <circle cx="254" cy="274" r="19" />
        <rect x="240" y="274" width="28" height="26" rx="12" />
        <circle cx="308" cy="284" r="15" />
        <rect x="297" y="284" width="22" height="20" rx="10" />
        <circle cx="358" cy="276" r="18" />
        <rect x="345" y="276" width="26" height="24" rx="12" />
      </g>
      <g stroke="#3A1F16" strokeWidth="7" strokeLinecap="round">
        <path d="M28 272l-9-26M60 272l9-26M130 268l-10-30M162 268l10-30M238 270l-9-28M270 270l9-28" />
      </g>
    </svg>
  );
}
