# CO2 Dashboard Data Cleaning Report

## 1. Original Dataset

- File: `data/raw/original_dataset.csv` (byte-identical to the supplied `co2_emissions_kt_by_country.csv`)
- Unit: kilotonnes (kt), indicated by the supplied filename; the CSV itself contains no unit metadata.
- Raw columns: `country_code`, `country_name`, `year`, `value`
- Observed value types: country_code and country_name are text; year and value parse as numeric.
- Rows: 13953; columns: 4.

## 2. Rows Before Cleaning

13953

## 3. Columns Before Cleaning

4: `country_code`, `country_name`, `year`, `value`.

## 4. Removed Columns

None. All four source fields identify an entity, locate the observation in time, or hold the measure. Region and derived year-over-year fields are added because they support dashboard filtering and analysis.

## 5. Missing Values

- `country_code`: 0
- `country_name`: 0
- `year`: 0
- `value`: 0

No missing values were present in the source file. No values were imputed.

## 6. Duplicates

- Duplicate `country_code + standardized country_name + year` records removed: 0.
- The Turkey/Turkiye naming standardization changed 30 row names before duplicate checks.

## 7. Outliers and Invalid Values

- Invalid/missing year rows removed: 0; valid years are integer years in [1800, 2200].
- Invalid/missing numeric value rows removed: 0.
- Negative emissions rows removed as invalid for this emissions measure: 1.
- Zero values retained: 21.
- Tukey high outlier rule on cleaned emissions values (above Q3 + 1.5 x IQR): Q1 = 590.387 kt, Q3 = 41426.099 kt, threshold = 102679.667 kt, flagged = 1583 rows. Flagged values are retained; large national totals are plausible and were not discarded solely for being statistical outliers.
- Incomplete reporting is preserved as absent country-year rows; no interpolation or backfilling was performed. Entity counts by year: 1960: 156, 1961: 157, 1962: 159, 1963: 160, 1964: 166, 1965: 166, 1966: 166, 1967: 166, 1968: 165, 1969: 166, 1970: 167, 1971: 168, 1972: 169, 1973: 169, 1974: 169, 1975: 169, 1976: 169, 1977: 169, 1978: 169, 1979: 169, 1980: 169, 1981: 169, 1982: 169, 1983: 169, 1984: 169, 1985: 169, 1986: 169, 1987: 169, 1988: 169, 1989: 169, 1990: 204, 1991: 204, 1992: 204, 1993: 204, 1994: 204, 1995: 204, 1996: 204, 1997: 204, 1998: 204, 1999: 204, 2000: 204, 2001: 204, 2002: 204, 2003: 204, 2004: 204, 2005: 204, 2006: 204, 2007: 204, 2008: 205, 2009: 205, 2010: 205, 2011: 205, 2012: 207, 2013: 207, 2014: 207, 2015: 206, 2016: 206, 2017: 191, 2018: 191, 2019: 191.
- Aggregate/world/region/income-group entities are removed using the source's entity names and World Bank aggregate codes. Territories remain when supplied as distinct reporting entities.

## 8. Columns Selected for Dashboard

- `country_code`
- `country_name`
- `continent`
- `year`
- `co2_kt`
- `co2_growth_rate`
- `co2_change`

## 9. Added Columns and Formulas

- `continent`: region label from the script's explicit country/territory lookup; unmatched entities are `Unknown`.
- `co2_change`: current-year emissions minus the same entity's previous consecutive-year emissions, in kt.
- `co2_growth_rate`: (current-year emissions - previous consecutive-year emissions) / previous consecutive-year emissions x 100; blank if the previous consecutive year is missing or zero.
- Runtime emissions class: for each selected year, entities are classified into five quintiles using that year's global 20th, 40th, 60th and 80th percentile thresholds. Ties remain in the lower band; the same class mapping drives the map, legend and classification chart.
- Population and CO2 per capita are absent from the source and are not calculated.

## 10. Map ISO Code Join and Validation

- Dataset primary key: `country_code` (ISO 3166-1 alpha-3 where assigned).
- Map primary key: ISO 3166-1 numeric `geometry.id`, translated to alpha-3 through `data/processed/map_country_codes.csv`; the map is joined by alpha-3, never by a raw country-name comparison.
- Crosswalk source: `datasets/country-codes` ISO 3166-1 alpha-3 and numeric fields; checked aliases are represented in the code crosswalk, including the Kosovo dataset code where the map has no assigned numeric ISO code.
- Map geometries: 177; dataset reporting entities: 207; matched ISO3 entities: 169; unmatched dataset entities: 38.
- Unmatched dataset entities: Andorra [AND], Antigua and Barbuda [ATG], Aruba [ABW], Bahrain [BHR], Barbados [BRB], Bermuda [BMU], British Virgin Islands [VGB], Cabo Verde [CPV], Cayman Islands [CYM], Comoros [COM], Curacao [CUW], Dominica [DMA], Faroe Islands [FRO], French Polynesia [PYF], Gibraltar [GIB], Grenada [GRD], Hong Kong SAR, China [HKG], Kiribati [KIR], Liechtenstein [LIE], Macao SAR, China [MAC], Maldives [MDV], Malta [MLT], Marshall Islands [MHL], Mauritius [MUS], Micronesia, Fed. Sts. [FSM], Nauru [NRU], Palau [PLW], Samoa [WSM], Sao Tome and Principe [STP], Seychelles [SYC], Singapore [SGP], Sint Maarten (Dutch part) [SXM], St. Kitts and Nevis [KNA], St. Lucia [LCA], St. Vincent and the Grenadines [VCT], Tonga [TON], Turks and Caicos Islands [TCA], Tuvalu [TUV].
- Geometries without an ISO identity: N. Cyprus, Somaliland; these are reported separately from countries with no emissions observations.
- Geometry is projected with D3 `geoNaturalEarth1` and rendered from TopoJSON features with antimeridian clipping. The map crosswalk and rendering diagnostics are also checked in the browser console at startup.

## 11. Rows After Cleaning

11102 rows across 207 reporting entities and 60 years (1960-2019).

## 12. Columns After Cleaning

7: `country_code`, `country_name`, `continent`, `year`, `co2_kt`, `co2_growth_rate`, `co2_change`.

## 13. Processing Summary

- Original source rows: 13953
- Aggregate entities excluded: 2850
- Invalid year rows removed: 0
- Invalid numeric rows removed: 0
- Negative emissions rows removed: 1
- Duplicate records removed: 0
- Processed rows: 11102

The interactive dashboard data is embedded in `assets/dashboard_data.js` so the dashboard can load under the browser's `file://` security model. The cleaned CSV remains available at `data/processed/dashboard_data.csv`.
