import QRCode from 'qrcode';

/**
 * QR rendering for issued tickets (spec §6.6).
 *
 * **Generated at render, never stored.** A data URL is 1.5–4 KB per ticket; a
 * column of them would TOAST the `tickets` table and drag kilobytes into every
 * dashboard listing and attendee CSV that does `SELECT *`. The image is a pure
 * function of `secret`, so it is cheaper to recompute than to carry.
 *
 * The QR encodes the ticket's `secret` alone — 32 random bytes, looked up
 * server-side, which spec §6.6 explicitly permits over the `{id}.{hmac}` form.
 * Never a sequential id, never the order total, never anything the scanner is
 * then trusted to have got right.
 */
export function qrDataUrl(secret: string) {
  return QRCode.toDataURL(secret, {
    // 'M' survives a scratched phone screen or a bad camera angle without
    // inflating the module count the way 'H' does.
    errorCorrectionLevel: 'M',
    // The quiet zone is not decoration: scanners need it to find the symbol.
    margin: 2,
    width: 320,
    color: {
      // Near-black on white rather than the brand brown — a QR is read by a
      // camera, not a person, and contrast is the only thing that matters.
      dark: '#231F20',
      light: '#FFFFFF',
    },
  });
}

/**
 * The same code as a PNG buffer, for email.
 *
 * Email needs this rather than `qrDataUrl` because Gmail (and most clients)
 * strip `data:` URIs in `<img src>` — a data URL in a message body renders as a
 * broken image and the buyer arrives at the door with nothing. Attached as a
 * `cid:` inline image instead.
 */
export function qrPngBuffer(secret: string) {
  return QRCode.toBuffer(secret, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
    color: { dark: '#231F20', light: '#FFFFFF' },
  });
}
