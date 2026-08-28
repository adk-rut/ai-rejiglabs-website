// A fake `fetch` for handler tests: answers by URL + method, records every call.
// Prior art: the relay's test/ghl-outbound.test.mjs, which hand-rolls this per file. Site chat's
// handlers talk to GHL, OpenRouter and Telegram in one turn, so the routing table is shared.
//
// Usage:
//   const fake = fakeFetch([
//     [/openrouter\.ai/, { json: { choices: [{ message: { content: "hi" } }] } }],
//     ["POST https://api.telegram.org", { json: { ok: true } }],
//   ]);
//   globalThis.fetch = fake.fetch;
//   fake.calls[0].url / .method / .body   // body is parsed JSON when it parses, else the raw string
//
// A route is [match, reply]. `match` is a RegExp (tested against the URL), a plain string (matched
// as a URL substring), or "METHOD substring" to key on both. `reply` is an object
// { status = 200, json, text, headers } or a function (call) => that object, so a route can vary
// by request. Routes are tried in order; the FIRST match wins, so put the specific one first.
// An unmatched request throws — a silent 200 for a call nobody meant to make is how a handler test
// passes while talking to nothing.
const METHODS = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /;

const matches = (match, call) => {
  if (match instanceof RegExp) return match.test(call.url);
  const s = String(match);
  if (METHODS.test(s)) {
    const [method, ...rest] = s.split(" ");
    return call.method === method && call.url.includes(rest.join(" "));
  }
  return call.url.includes(s);
};

const parseBody = (body) => {
  if (typeof body !== "string") return body ?? null;
  try { return JSON.parse(body); } catch { return body; }
};

export function fakeFetch(routes = []) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    const call = {
      url: String(url),
      method: String(opts.method || "GET").toUpperCase(),
      headers: opts.headers || {},
      body: parseBody(opts.body),
    };
    calls.push(call);
    const route = routes.find(([match]) => matches(match, call));
    if (!route) throw new Error(`fakeFetch: no route for ${call.method} ${call.url}`);
    const spec = typeof route[1] === "function" ? route[1](call) : route[1];
    const { status = 200, json = null, text = null, headers = {} } = spec || {};
    const bodyText = text !== null ? text : JSON.stringify(json);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
      text: async () => bodyText,
      json: async () => (json !== null ? json : JSON.parse(bodyText)),
    };
  };
  return { fetch, calls, reset: () => { calls.length = 0; } };
}
