const nativeFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/token") {
    return Response.json({ access_token: "test-access-token", refresh_token: "test-refresh-token", expires_in: 3600 });
  }
  if (url.hostname === "www.googleapis.com" && url.pathname === "/calendar/v3/users/me/calendarList") {
    return Response.json({ items: [
      { id: "medpark.remote@gmail.com", summary: "메드파크 기본 일정", backgroundColor: "#0a9b7e", foregroundColor: "#ffffff", primary: true, accessRole: "owner" },
      { id: "team@group.calendar.google.com", summary: "전사 주요 일정", backgroundColor: "#f6bf26", foregroundColor: "#1d1d1d", accessRole: "reader" }
    ] });
  }
  const match = url.hostname === "www.googleapis.com" && url.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events$/);
  if (match) {
    const calendarId = decodeURIComponent(match[1]);
    const items = calendarId === "medpark.remote@gmail.com"
      ? [{ id: "primary-event", summary: "경영회의", start: { dateTime: "2026-08-10T09:00:00+09:00" }, end: { dateTime: "2026-08-10T10:00:00+09:00" } }]
      : [{ id: "team-event", summary: "전사행사", start: { date: "2026-08-11" }, end: { date: "2026-08-12" } }];
    return Response.json({ items });
  }
  return nativeFetch(input, init);
};
