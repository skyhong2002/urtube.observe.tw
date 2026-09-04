# Reference population method

- Method version: **channel-tags-equal-user-v1**
- Source labels: [governed channel tag policy](channel-tag-policy.md)
- Refresh: rebuilt when an Insights page is viewed
- Weighting: every consenting account has equal weight
- Minimum sample: five comparable consenting accounts per axis

## Consent and inclusion

Reference participation is a separate account setting. Matching consent and
public dashboard visibility do not enable it. Turning it off removes the
account from later calculations.

For the selected page range, an account contributes content-type percentages
when it has estimated watch time. It contributes political-channel percentages
only when it watched at least one source-labeled political channel. Each axis
shows its own sample size.

## Calculation

For each governed group, urtube calculates the equal-user mean, median, the
viewer-to-mean lift, and a midrank percentile. Results are rounded to one
decimal place. Percentiles are rounded to five-point steps. Overlapping
content groups remain overlapping and are never added into a single total.

The page shows the latest contributing data date, the tag policy and membership
versions, and a SHA-256 short version derived from the method, range, consenting
population, data dates, and group totals. Any relevant change produces a new
version.

## Privacy and limits

No result is produced below the five-account threshold. Output contains no
names, account identifiers, channels, videos, events, searches, matching data,
or individual values. The reference group is self-selected from this site. It
does not represent Taiwan, society, a political identity, or a normal value.
