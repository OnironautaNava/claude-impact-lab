# Smart Commute CDMX

MVP frontend con `MapLibre + Vite` y un ETL local que genera `public/data/mvp-data.json`.

## Separar raw-data del repo

Para evitar que el editor y el tooling indexen datasets pesados dentro del workspace, mueve la carpeta cruda fuera del repo y apunta el ETL con una variable de entorno.

### PowerShell

```powershell
$env:SMART_COMMUTE_DATA_DIR = "D:\raw-data\smart-commute-cdmx"
npm run generate:data
```

### CMD

```bat
set SMART_COMMUTE_DATA_DIR=D:\raw-data\smart-commute-cdmx
npm run generate:data
```

### Compatibilidad

Si `SMART_COMMUTE_DATA_DIR` no existe, el script sigue leyendo desde `../docs/data` para no romper el flujo actual.

### Archivos requeridos

- `afluenciastc_desglosado_03_2026.csv`
- `afluenciamb_desglosado_03_2026.csv`
- `cicloestaciones_ecobici.csv`
- `infraestructura-vial-ciclista.json`
