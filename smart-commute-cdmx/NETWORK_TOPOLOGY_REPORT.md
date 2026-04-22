# Network Topology Report

Generated after applying the topology correction in `scripts/generate_multimodal_data.py`.

## What changed

- Physical stations are deduplicated when the same line contains near-identical stop names at the same location.
- Routes are no longer built from one flat chain per line. The ETL now separates geometry variants using route metadata such as `RUTA`, `TRAMO`, and `circuito`.
- Stations are assigned to the best matching variant instead of being forced into every segment of the same line.
- Edges are emitted once per physical pair, even if multiple variants reuse the same corridor.

## Net effect

- Removed the self-like short edges previously seen in Metrobus and Trolebus (`Museo San Carlos -> Museo San Carlos`, `París -> París`, `Excelsior -> Excelsior`, etc.).
- Reduced Metrobus maximum edge length from about `3909 m` to `1505 m` in the general network summary.
- Reduced Trolebus maximum edge length from about `3941 m` to `2393 m`.
- Current network summary lives in `public/data/network-diagnostics.json`.

## System status

- `Metro`: healthy after review.
- `Cablebus`: healthy after review.
- `Tren Ligero`: healthy after review.
- `Metrobus`: much better, but `MB 4` still needs attention.
- `Trolebus`: large improvement; residual ambiguity remains mainly in `TB 9` and a few lines with opposite-direction stop pairs still separated in the source cartography.

## Detailed suspicious lines

### MB 4

- `54` stations, `43` edges, median `311 m`, max `1505 m`.
- Variants detected:
  - `Buenavista - San Lazaro Ruta Sur`
  - `Buenavista - San Lazaro Ruta Norte | Buenavista - San Lazaro`
  - `A aeropuerto`
  - `Alameda Oriente - Pantitlan`
- Remaining long edges:
  - `Cecilio Robelo -> Museo de la Ciudad` `1505 m`
  - `Alameda Oriente -> Calle 6` `1196 m`
- Interpretation: the variant split fixed the self-connections, but `MB 4` still mixes branch coverage unevenly because some sub-routes share only partial station inventories.

### MB 7

- `38` stations, `33` edges, median `427 m`, max `985 m`.
- Variants detected:
  - `Tacubaya - Paris | Tacubaya - Paris`
  - `Indios Verdes - Campo Marte | Circuito La Villa - Campo Marte`
  - `Indios Verdes - Campo Marte | Circuito La Villa Poniente`
  - `Indios Verdes - Campo Marte | Circuito La Villa Oriente`
  - `Hospital Infantil La Villa - Campo Marte | Hospital Infantil La Villa - Garrido`
  - `Hospital Infantil La Villa - Campo Marte | Garrido - Hospital Infantil La Villa`
- No residual short or long edges in diagnostics.
- Interpretation: this line is now structurally acceptable; remaining duplicate names are close opposite-direction stops, not overconnections.

### TB 5

- `116` stations, `127` edges, median `202 m`, max `587 m`.
- Variants detected:
  - `Circuito 1 | La Diana - San Felipe de Jesus`
  - `Circuito 1 | San Felipe de Jesus - La Diana`
  - `Circuito 2 | M. Hidalgo - San Felipe de Jesus`
  - `Circuito 2 | San Felipe de Jesus - M. Hidalgo`
- No residual short or long edges in diagnostics.
- Interpretation: this was one of the worst offenders before the fix and is now materially corrected. Remaining duplicates are physical stop pairs on opposite sides of the corridor.

### TB 9

- `36` stations, `30` edges, median `1368 m`, max `2393 m`.
- Variants detected:
  - `Villa de Cortes - Apatlaco - Tepalcates`
- No short edges, but edge lengths remain unusually high for urban trolley service.
- Interpretation: this line still looks suspicious because the source geometry exposes only one route variant, so the ETL cannot separate hidden operational branches any further with the current metadata.

### TB 8

- `34` stations, `32` edges, median `212 m`, max `788 m`.
- Variant detected: `Circuito Politecnico`.
- Residual long edge in diagnostics:
  - `Juan de Dios Batiz -> Cancha de Entrenamiento Pieles Rojas` `788 m`
- Interpretation: likely acceptable, but worth a visual check because this is the only residual long-edge warning outside `MB 4` and `TB 9`.

## Recommended next step

- Review `MB 4` and `TB 9` manually against the map and official route sheets.
- If the source cartography contains hidden branch semantics in another attribute or shapefile descriptor, feed that metadata into the ETL so the remaining long gaps can be split with the same variant-aware approach.
