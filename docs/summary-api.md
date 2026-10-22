# Public summary feeds

`/u/:handle/summary.json` and the legacy `/api/youtube/summary.json` use the
same current dashboard authorization as the site. Private dashboards stay
private, including after an aggregate has been cached.

The optional `detail=summary` query is intended for aggregate consumers such
as Infovore. It preserves statistics, daily and hourly series, short-form
breakdowns, top channels and videos, topics, keywords and keyword coverage.
It skips the dashboard's channel-race timeline and topic trend, returning
empty timeline arrays for those fields. Without this query, the full existing
response remains available. Neither response includes the `recent` list.

Both variants run through the bounded read thread pool and share in-flight
reads. The five-minute cache detects archive writes; it never caches an
authorization decision. `range` retains its existing meaning and default.
The legacy recent feed also uses the read pool while retaining its timestamp
and measured-duration filtering.
