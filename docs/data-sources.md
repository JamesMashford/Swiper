# Data sources: national name statistics

Research for issue #5 (part of #4). Public national statistics are the only name data source (see #4).

**Status: INCOMPLETE. A human must sign off on every licence. No licence has been verified.**

## How this was researched, and the limit of it

In the session that wrote this, the official pages could not be read:

- Direct requests from the shell were blocked by the session's network policy for every agency host.
- After the agency hosts were added to the environment's allowed list, `www.ssa.gov` still answered the shell with an Akamai "Access Denied" (HTTP 403). That is the site refusing the client; it was not worked around.
- The page-reading tool failed with a DNS error (`getaddrinfo ENOTFOUND`) on all seven agencies' hosts.

So **no agency page was read**. Everything below comes from web-search result summaries and is labelled that way. The columns in the **Licence** rows are all unverified: no licence or reuse wording has been seen, so none is quoted. Fill those in from the linked pages before sign-off.

Marking used in this file: 🟢 = stated by a search-result summary that cites the URL beside it (page itself not read); 🟠 = assumption, inference, or unverified.

## Summary

| Source | Name data exists | Downloadable file/API (per search summary) | Licence verified |
|---|---|---|---|
| US SSA | 🟢 Yes | 🟢 `names.zip` | 🟠 No |
| UK ONS (England and Wales) | 🟢 Yes | 🟢 xlsx datasets | 🟠 No |
| Sweden | 🟢 Yes, but publisher changed | 🟠 Unknown | 🟠 No |
| Norway (SSB) | 🟢 Yes | 🟢 StatBank tables | 🟠 No |
| Denmark (DST) | 🟢 Yes | 🟠 Unclear | 🟠 No |
| Italy (Istat) | 🟢 Partly | 🟠 Probably no bulk file | 🟠 No |
| Brazil (IBGE) | 🟢 Yes | 🟢 JSON API (v2: 2010 census) | 🟠 No |

## US: Social Security Administration (SSA)

- **URL:** 🟢 <https://www.ssa.gov/oact/babynames/limits.html>; national file at `https://www.ssa.gov/oact/babynames/names.zip`. Also catalogued at <https://catalog.data.gov/dataset/baby-names-from-social-security-card-applications-national-data>.
- **Format:** 🟢 Zip of per-year text files; the layout is described in a readme inside the zip (a third-party repo describes `yob[year].txt` files and a merged comma-separated form of name, sex, occurrences, year). 🟠 Confirm against the readme in the zip.
- **Columns:** 🟢 name, year of birth, sex, number. 🟢 From a 100 percent sample of Social Security card applications, 1880 on.
- **Threshold:** 🟠 Secondary sources say names given to fewer than 5 babies in a year are omitted. Unverified; check the "limits" page above.
- **Licence:** 🟠 UNVERIFIED. No licence wording seen. Check the SSA page and the data.gov catalogue entry's licence field.
- **Evidence:** web search summary only.

## UK: Office for National Statistics (ONS), England and Wales

- **URL:** 🟢 <https://www.ons.gov.uk/peoplepopulationandcommunity/birthsdeathsandmarriages/livebirths/datasets/babynamesinenglandandwalesfrom1996>; sex-specific datasets such as <https://www.ons.gov.uk/peoplepopulationandcommunity/birthsdeathsandmarriages/livebirths/datasets/babynamesenglandandwalesbabynamesstatisticsboys>; historical top-100 dataset; data.gov.uk listing <https://www.data.gov.uk/dataset/afe1871f-dede-41bf-a6ba-0a1d32217cdb/baby_names_england_and_wales>.
- **Format:** 🟢 xlsx.
- **Columns:** 🟢 rank and count of names for boys and girls, change in rank, breakdown by country, region and month of birth. 🟠 Exact sheet and column layout unverified. Coverage reported as 1996 onward; the historical dataset covers top-100 lists 1904 to 2024 at 10-yearly intervals.
- **Scope:** 🟠 England and Wales only, not the whole UK (Scotland and Northern Ireland are published by other bodies). Not checked.
- **Licence:** 🟠 UNVERIFIED. The search results did not show it. 🟠 ONS content is commonly under the Open Government Licence, but this was not read here and must be confirmed on the dataset page.
- **Evidence:** web search summary only.

## Sweden

- **Finding that changes the plan:** 🟢 SCB stopped producing name statistics from 2024 and refers to Skatteverket; from 2024 Skatteverket publishes first-name statistics for newborns in its Statistikportal (top-1000 list, top lists by municipality, trends per name). Before 2023 the newborn name statistics were SCB's.
- **URLs:** 🟢 SCB name statistics (archive): <https://www.scb.se/hitta-statistik/statistik-efter-amne/befolkning-och-levnadsforhallanden/ovrigt/namnstatistik/>; Skatteverket: <https://www.skatteverket.se/omoss/varverksamhet/statistikportalen/namnpanyfodda.4.7da1d2e118be03f8e4f5b9d.html>.
- **Format and columns:** 🟠 UNVERIFIED. Whether a bulk download exists was not established; the Skatteverket portal is interactive.
- **Licence:** 🟠 UNVERIFIED for both SCB and Skatteverket.
- **Open question for the human:** which agency is the source of record for Sweden, and is a downloadable file available.
- **Evidence:** web search summary only.

## Norway: Statistics Norway (SSB)

- **URLs:** 🟢 <https://www.ssb.no/en/statbank/table/10467> (born persons by girls' and boys' names); <https://www.ssb.no/en/statbank/table/10501> (persons per first name at 31 December); overview <https://ssb.no/en/navn>.
- **Format:** 🟠 StatBank tables. Export formats not verified.
- **Columns:** 🟢 name, sex, year, count. 🟢 Table 10467 covers 1880 to 2025; figures under 4 persons are not published; year of birth before 2021, year of naming from 2021. Table 10501 covers first names used by 200 or more persons.
- **Licence:** 🟠 UNVERIFIED. Not seen. 🟠 Whether an open licence applies is not established.
- **Evidence:** web search summary only.

## Denmark: Statistics Denmark (DST)

- **URLs:** 🟢 <https://www.dst.dk/da/Statistik/dokumentation/statistikdokumentation/navne> and `dst.dk/navne`.
- **Datasets:** 🟢 Names in the whole population (1 January counts, from 2002) and first names of newborns (births in a calendar year, from 1985).
- **Format and columns:** 🟠 UNVERIFIED. 🟢 One documentation page says there are no Statbank matrices for names, so a Statbank API is not assumed; name lists and databases are said to be at `dst.dk/navne`.
- **Licence:** 🟠 UNVERIFIED. Releases carry a "© Danmarks Statistik" notice; reuse terms not seen.
- **Evidence:** web search summary only.

## Italy: Istat

- **URLs:** 🟢 <https://www.istat.it/en/data/interactive-contents/baby-names/>; Italian "contanomi" tool <https://www.istat.it/it/dati-analisi/contanomi>.
- **Format and columns:** 🟢 An interactive name counter (enter a name and sex, returns the series of babies registered with it from 1999), plus yearly rankings. 🟢 Chart export in several formats is offered. 🟠 A downloadable name/sex/year/count file was not found; this source may be unusable for a bulk import.
- **Data quality:** 🟢 Istat does not correct name spelling errors or name/sex mismatches.
- **Licence:** 🟠 UNVERIFIED. No licence statement seen (search found none); Istat describing itself as an open-data producer is not a licence.
- **Evidence:** web search summary only.

## Brazil: IBGE

- **URLs:** 🟢 API docs <https://servicodados.ibge.gov.br/api/docs/nomes?versao=2>; technical note <https://censo2010.ibge.gov.br/nomes/nota.tecnica.pdf>; press release <https://agenciadenoticias.ibge.gov.br/en/agencia-press-room/10446-brazil-of-marias-and-joses-ibge-releases-name-database-based-on-2010-population-census.html>.
- **Format:** 🟢 JSON API (v2): ranking of names by birth frequency per decade with decade, locality and sex parameters; and frequency by decade for a given name.
- **Columns:** 🟠 Exact response fields unverified.
- **Scope:** 🟢 Names come from the 2010 census, which recorded first name and last surname; the API does not handle compound names such as "Maria Luiza" (per a third-party client's docs). 🟠 A newer (2022 census) release exists per an IBGE press item; the v3 endpoint is only referenced by a community gist and is unverified.
- **Licence:** 🟠 UNVERIFIED.
- **Evidence:** web search summary only.

## Sign-off checklist (for the human)

- [ ] Read each linked page and quote the licence or reuse wording here, with the link.
- [ ] Confirm each source's real download format and columns.
- [ ] Decide Sweden (SCB vs Skatteverket), Denmark (is a bulk download available) and Italy (no bulk file found yet).
- [ ] Remove any source whose terms do not allow a free personal project, or note attribution needed.

Until this is done, issue #5 stays open and keeps its `ready-for-human` label.
