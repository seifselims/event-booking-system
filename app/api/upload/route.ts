import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";

/**
 * Client-upload token issuer for event posters.
 *
 * The browser sends the file straight to Vercel Blob rather than through this
 * route — the file never passes through the server, so the 4.5MB serverless
 * request body limit doesn't apply. What this route does is decide *whether*
 * the browser may upload, and hand back a short-lived scoped token.
 *
 * That makes it the permission. `handleUpload` is called twice per upload:
 * once by our own client before the transfer (`onBeforeGenerateToken`), and
 * once by Vercel Blob afterwards (`onUploadCompleted`) — so the session check
 * has to sit in the first, where a real browser request with cookies exists.
 * Without it this endpoint is an open file host for anyone who finds the URL.
 *
 * Note this authenticates but does not *authorise a specific event*: a signed-in
 * organizer may upload a poster before the event it belongs to is even saved.
 * The ownership check is on the write that stores the URL (`updateEvent`), which
 * is where it can actually be enforced.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async () => {
        const session = await auth.api.getSession({ headers: await headers() });

        // Thrown, not redirected: this is a fetch from an upload widget, and a
        // redirect to the sign-in page would arrive as unparseable HTML.
        if (!session) throw new Error("Not signed in.");

        return {
          allowedContentTypes: [
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/avif",
          ],
          maximumSizeInBytes: 4 * 1024 * 1024,
          // Two organizers uploading `poster.jpg` must not collide, and an
          // overwrite would silently repoint a published event's artwork.
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ userId: session.user.id }),
        };
      },

      // Vercel Blob calls this from its own servers once the transfer lands.
      // Nothing to do yet: the URL is stored when the organizer saves the form,
      // so an abandoned upload simply goes unreferenced.
      onUploadCompleted: async () => {},
    });

    return Response.json(result);
  } catch (error) {
    // 400, not 500 — the failure here is a rejected upload (not signed in, file
    // too large, wrong type), which is a bad request rather than a server fault.
    return Response.json(
      { error: error instanceof Error ? error.message : "Upload failed." },
      { status: 400 },
    );
  }
}
