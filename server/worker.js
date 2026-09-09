import { handleApi } from "./api.js";

// The private Sites access gate protects this whole application and its API.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env.DB);
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "same-origin");
    return new Response(response.body, { status: response.status, headers });
  },
};
