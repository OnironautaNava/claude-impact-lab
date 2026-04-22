# Data Source Matrix

Matriz preparada para migrar el ETL a este contrato de fuentes:

- `GTFS` = variantes, secuencia y sentido
- `SHP` = geometria y catalogo de lineas/estaciones
- `afluencia` = enrichment analitico

## Artefactos generados

- `data-source-matrix.csv` - matriz completa por linea para todos los sistemas con cobertura actual en `raw-data`

## Cobertura validada

- `Metro`: 12 lineas GTFS, SHP local disponible, afluencia local disponible
- `Metrobus`: 8 lineas GTFS, SHP local disponible, afluencia local disponible
- `Trolebus`: 11 lineas GTFS, SHP local disponible, afluencia local disponible
- `Cablebus`: 3 lineas GTFS, SHP local disponible, afluencia local disponible
- `Tren Ligero`: 1 linea GTFS, SHP local disponible, afluencia local disponible
- `RTP`: 114 lineas GTFS, SHP local disponible, afluencia local disponible

## Hallazgos importantes

- No falta `SHP` local para ninguno de los sistemas cubiertos por la matriz.
- No falta afluencia local para ninguno de los sistemas cubiertos por la matriz.
- Ya existe una copia local persistida en `D:\data_CDMX\raw-data\gtfs\gtfs_cdmx.zip`.

## Recomendacion de arquitectura

1. Migrar primero `Metrobus`, `Trolebus`, `Cablebus` y `Tren Ligero` a `GTFS + SHP + afluencia`.
2. Alinear `Metro` al mismo contrato para que toda la red use una sola logica topologica.
3. Decidir si `RTP` entra al alcance funcional del producto; si entra, ya tiene la base de datos necesaria.

## Siguiente cambio tecnico recomendado

- Mantener actualizado el feed oficial en `raw-data/gtfs/gtfs_cdmx.zip`.
- Reemplazar la dependencia principal de `KMZ` por lectura nativa de `SHP/DBF`.
- Hacer el join `GTFS <-> SHP` por `route_id`, `route_short_name`, `CVE_EST` y proximidad geografica.
