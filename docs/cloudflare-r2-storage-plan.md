# Plan de almacenamiento en Cloudflare R2

## Objetivo

Mover la data local a Cloudflare R2 para poder acceder a ella desde cualquier equipo, con una estructura simple, barata y preparada para crecer hasta al menos 1 GB.

La organizacion contemplada es:

- `raw-data/`
- `processed-data/`
- `backup/`

---

## Por que Cloudflare R2

Para este caso, Cloudflare R2 es la opcion con mejor costo-beneficio porque:

- la data es pequena y estatica
- no necesitas una base de datos real, sino almacenamiento de archivos
- puedes acceder desde cualquier equipo usando API compatible con S3
- evita el sobrecosto y complejidad de usar una plataforma mas grande solo para guardar archivos

---

## Arquitectura recomendada

Usar **un bucket** con tres prefijos:

```text
project-data/
  raw-data/
  processed-data/
  backup/
```

### Por que un solo bucket

- mas simple de administrar
- suficiente para el volumen actual
- mas facil de automatizar
- si luego crece el proyecto, siempre puedes separar en tres buckets

Nombre sugerido del bucket:

```text
project-data
```

---

## Estructura sugerida

```text
project-data/
  raw-data/source-a/file1.csv
  raw-data/source-b/file2.parquet
  processed-data/model-v1/output.parquet
  backup/2026-04-20/raw-data.zip
```

Convenciones recomendadas:

- `raw-data/` contiene solo archivos originales
- `processed-data/` contiene datasets transformados o salidas intermedias/finales
- `backup/` contiene snapshots o exportaciones comprimidas con fecha

---

## Implementacion paso a paso

## Paso 1 - Crear cuenta y habilitar R2

1. Ingresar a Cloudflare.
2. Abrir el panel principal.
3. Ir a **R2 Object Storage**.
4. Activar el servicio si todavia no esta habilitado.

---

## Paso 2 - Crear el bucket principal

1. Hacer clic en **Create bucket**.
2. Crear el bucket con el nombre:

```text
project-data
```

3. Confirmar la creacion.

No hace falta crear manualmente las carpetas. Los prefijos se generan automaticamente al subir archivos con esas rutas.

---

## Paso 3 - Definir la estructura local

Antes de subir nada, organizar localmente tus carpetas asi:

```text
data/
  raw-data/
  processed-data/
  backup/
```

Si ya tienes otra estructura, no hace falta mover todo ahora, pero SI conviene definir desde el inicio que carpeta local mapea a cada prefijo remoto.

Mapeo sugerido:

- carpeta local `data/raw-data/` -> `project-data/raw-data/`
- carpeta local `data/processed-data/` -> `project-data/processed-data/`
- carpeta local `data/backup/` -> `project-data/backup/`

---

## Paso 4 - Crear credenciales S3 para acceso programatico

1. Dentro de R2, ir a la seccion de API tokens o S3 credentials.
2. Crear una nueva credencial.
3. Guardar estos datos:

- `Access Key ID`
- `Secret Access Key`
- `S3 endpoint`

### Recomendacion importante

No guardar estas credenciales dentro del repositorio ni en archivos versionados.

Guardarlas en:

- variables de entorno
- administrador de contrasenas
- archivo local ignorado por git si realmente hace falta

---

## Paso 5 - Instalar rclone en cada equipo

`rclone` es la forma mas simple y estable de trabajar con Cloudflare R2 desde varias maquinas.

Instalarlo desde la web oficial o con tu gestor de paquetes.

Verificar instalacion:

```bash
rclone version
```

---

## Paso 6 - Configurar un remote de rclone para R2

Ejecutar:

```bash
rclone config
```

Configurar un remote nuevo con estos criterios:

- nombre sugerido: `r2-project`
- tipo de storage: `s3`
- provider: `Cloudflare`
- endpoint: pegar el endpoint S3 de tu cuenta R2
- access key: pegar `Access Key ID`
- secret key: pegar `Secret Access Key`

Cuando termine, validar el acceso listando buckets:

```bash
rclone lsd r2-project:
```

Si todo esta bien, deberias ver el bucket `project-data`.

---

## Paso 7 - Probar carga inicial sin riesgo

Antes de sincronizar, hacer una prueba con `copy`.

### Subir raw-data

```bash
rclone copy "data/raw-data" "r2-project:project-data/raw-data" --progress
```

### Subir processed-data

```bash
rclone copy "data/processed-data" "r2-project:project-data/processed-data" --progress
```

### Subir backup

```bash
rclone copy "data/backup" "r2-project:project-data/backup" --progress
```

### Por que usar copy primero

Porque `copy` NO borra archivos en destino. Eso evita desastres al principio.

---

## Paso 8 - Verificar que la data quedo bien subida

Listar el contenido remoto:

```bash
rclone ls "r2-project:project-data/raw-data"
rclone ls "r2-project:project-data/processed-data"
rclone ls "r2-project:project-data/backup"
```

Tambien puedes revisar desde el panel web de Cloudflare.

---

## Paso 9 - Habilitar acceso desde otro equipo

En el segundo equipo:

1. Instalar `rclone`.
2. Ejecutar `rclone config`.
3. Crear otro remote hacia el mismo bucket.
4. Probar lectura.

Comando de prueba:

```bash
rclone ls "r2-project:project-data/raw-data"
```

Si quieres un acceso mas seguro, crear credenciales distintas por equipo.

---

## Paso 10 - Pasar de copy a sync cuando el flujo ya sea estable

Una vez que confirmes que la estructura y el flujo estan correctos, puedes usar `sync` para mantener origen y destino alineados.

Ejemplo:

```bash
rclone sync "data/raw-data" "r2-project:project-data/raw-data" --progress
```

### Advertencia critica

`sync` puede borrar en destino archivos que ya no existan en origen.

Por eso el orden correcto es:

1. empezar con `copy`
2. validar estructura y contenido
3. usar `sync` solo cuando ya tengas confianza en el proceso

---

## Paso 11 - Definir estrategia de backups reales

No confundas almacenamiento con backup.

Aunque R2 sea confiable, igual conviene guardar snapshots fechados dentro de `backup/`.

Ejemplo:

```text
backup/2026-04-20/raw-data.zip
backup/2026-04-20/processed-data.zip
backup/2026-04-27/raw-data.zip
```

### Estrategia minima recomendada

- un backup semanal
- un backup mensual
- mantener varios puntos de restauracion

---

## Paso 12 - Convenciones de nombres

Usar nombres consistentes desde el inicio.

Ejemplos recomendados:

```text
raw-data/source-name/2026-04-20/dataset.csv
processed-data/pipeline-name/v1/output.parquet
backup/2026-04-20/raw-data.zip
```

### Regla clave

La carpeta `raw-data/` no deberia contener archivos modificados manualmente. Si transformas algo, debe ir a `processed-data/`.

---

## Paso 13 - Automatizar el flujo

Cuando el proceso manual ya funcione, automatizarlo.

Orden recomendado:

1. script de subida de `raw-data`
2. script de publicacion de `processed-data`
3. script de backup periodico

Esto puede correrse con:

- Task Scheduler en Windows
- cron en Linux/macOS
- GitHub Actions si luego centralizas el flujo en CI

---

## Paso 14 - Politica de permisos recomendada

Si el proyecto crece, separar permisos:

- un acceso de lectura/escritura para tu equipo principal
- un acceso de solo lectura para otros equipos
- un acceso dedicado para automatizaciones

Esto reduce el riesgo de borrados accidentales.

---

## Paso 15 - Checklist de implementacion

- [ ] Crear cuenta en Cloudflare
- [ ] Activar R2
- [ ] Crear bucket `project-data`
- [ ] Crear credenciales S3
- [ ] Instalar `rclone`
- [ ] Configurar remote `r2-project`
- [ ] Subir `raw-data` con `copy`
- [ ] Subir `processed-data` con `copy`
- [ ] Subir `backup` con `copy`
- [ ] Validar acceso desde otro equipo
- [ ] Definir convencion de nombres
- [ ] Automatizar backups

---

## Costos esperados

Para 140 MB hoy y alrededor de 1 GB en el corto plazo, el costo sera muy bajo.

Lo importante en este escenario NO es optimizar centavos, sino elegir una arquitectura que sea:

- simple
- segura
- accesible desde cualquier equipo
- facil de automatizar despues

R2 cumple bien con eso.

---

## Recomendacion final

La mejor implementacion inicial para este proyecto es:

- Cloudflare R2
- un bucket llamado `project-data`
- tres prefijos: `raw-data/`, `processed-data/` y `backup/`
- `rclone` para acceder y sincronizar desde cualquier equipo

Esa decision te da el mejor equilibrio entre simplicidad, costo y crecimiento futuro.

---

## Comandos de referencia rapida

### Listar buckets

```bash
rclone lsd r2-project:
```

### Subir raw-data

```bash
rclone copy "data/raw-data" "r2-project:project-data/raw-data" --progress
```

### Subir processed-data

```bash
rclone copy "data/processed-data" "r2-project:project-data/processed-data" --progress
```

### Subir backup

```bash
rclone copy "data/backup" "r2-project:project-data/backup" --progress
```

### Sincronizar raw-data

```bash
rclone sync "data/raw-data" "r2-project:project-data/raw-data" --progress
```

### Listar archivos remotos

```bash
rclone ls "r2-project:project-data/raw-data"
```

###next steps
1. Te dejo un manifest por source (raw-data/<source>/manifest.json)       
     para gobernanza de versiones y validación automática.                   
     2. Te agrego un script de “auditoría de estructura” que falle si        
     alguien vuelve a dejar archivos sueltos fuera de raw-data/<source>/...  
     .  