# Why Not — Guía de configuración

## Arquitectura

```
/ (Barra)           →  index.html + app.js
/portero.html       →  Portero / Door
/admin.html         →  Panel de administración
shared.js           →  Supabase client + Auth + Cámara (compartido)
schema.sql          →  Base de datos Supabase
```

---

## Paso 1 — Crear proyecto en Supabase

1. Ir a **https://supabase.com** → **Start for free**
2. Crear cuenta (o entrar con GitHub/Google)
3. **New project**:
   - Organization: tu organización
   - Name: `why-not-bar`
   - Database Password: anotarlo (no lo vas a usar directamente)
   - Region: elegir la más cercana (South America - São Paulo)
4. Esperar que el proyecto termine de inicializarse (~1 min)

---

## Paso 2 — Ejecutar el schema SQL

1. En Supabase → **SQL Editor** → **New query**
2. Copiar TODO el contenido de `schema.sql`
3. Pegar en el editor → **Run** (▶)
4. Verificar que no haya errores

---

## Paso 3 — Crear bucket de fotos

1. Supabase → **Storage** → **New bucket**
2. Name: `payment-photos`
3. **Public bucket**: ✅ activado (para poder ver las fotos desde el admin)
4. Guardar

---

## Paso 4 — Obtener las credenciales

1. Supabase → **Settings** → **API**
2. Copiar:
   - **Project URL** → ejemplo: `https://abcxyz123.supabase.co`
   - **anon public key** → clave larga que empieza con `eyJ...`

---

## Paso 5 — Configurar `shared.js`

Abrir el archivo `shared.js` y reemplazar las líneas:

```javascript
const SUPABASE_URL      = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY_HERE';
```

Con los valores del Paso 4:

```javascript
const SUPABASE_URL      = 'https://abcxyz123.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
```

---

## Paso 6 — Crear usuarios

### Desde Supabase Dashboard

1. Supabase → **Authentication** → **Users** → **Add user**
2. Crear un usuario por rol:

| Email | Contraseña | Rol |
|-------|-----------|-----|
| barra@tulocal.com | TuClave123! | bar |
| portero@tulocal.com | TuClave123! | door |
| admin@tulocal.com | TuClave123! | admin |

> **Importante:** Al crear cada usuario, en **User Metadata** agregar:
> ```json
> { "role": "bar", "display_name": "Barra 1" }
> ```
> (cambiar `"bar"` por `"door"` o `"admin"` según corresponda)

### Alternativamente, asignar roles manualmente en SQL:

```sql
-- Verificar que el trigger creó el perfil automáticamente
select * from profiles;

-- Si falta un perfil, agregar manualmente:
insert into profiles (id, role, display_name)
values ('UUID_DEL_USUARIO', 'admin', 'Administrador');
```

---

## Paso 7 — Crear el primer evento

1. Ir a `/admin.html` → ingresar con el usuario admin
2. Tab **Evento** → **+ Nuevo evento**
3. Completar nombre, fecha y cantidad de cuentas de barra (default: 120)
4. **Crear y activar** → el sistema crea el evento e inicializa las 120 cuentas

---

## Paso 8 — Deploy en Vercel

1. Asegurarse de que `shared.js` tenga las credenciales correctas
2. Push al repositorio Git
3. Vercel re-deploya automáticamente

### URLs de cada app:

| App | URL |
|-----|-----|
| Barra | `https://tu-app.vercel.app/` |
| Portero | `https://tu-app.vercel.app/portero.html` |
| Admin | `https://tu-app.vercel.app/admin.html` |

---

## Flujo de la noche del evento

### Antes del evento (Admin):
1. Crear evento en `/admin.html` → Tab Evento
2. Importar lista de asistentes (CSV) o agregar uno a uno
3. Asignar número de barra a cada asistente (columna "Barra #")
4. Imprimir tarjetas con los números

### Durante el evento:

**Portero** (`/portero.html`):
- Ve la lista de asistentes
- Click **Ingresar** cuando llega cada persona
- Si alguien necesita salir → click **Salir** (solo si no tiene consumo abierto)
- Puede cobrar cuentas de barra en la puerta

**Barra** (`/`):
- Mantener 0,5 s → agregar trago (+160, +260, +360)
- Mantener 2 s → quitar trago (corrección)
- Mantener 1 s en **Cerrar** → cobrar cuenta (abre cámara para foto de pago)

**Admin** (`/admin.html`):
- Dashboard con totales en tiempo real
- Ver consumo por persona
- Agregar gastos de la noche
- Cobrar cuentas desde la tabla
- Exportar a Excel al finalizar

### Al cerrar el evento:
1. Admin → Tab Asistentes → verificar que todos estén en estado "Pago"
2. Admin → Dashboard → ver totales finales
3. Admin → **Excel** → descargar reporte completo
4. Admin → Tab Evento → el evento queda en estado inactivo

---

## Importar asistentes en CSV

El CSV debe tener estas columnas (en la primera fila):

```
name,cedula,email,phone,status,bar_account_slot,entry_amount
Juan García,12345678,juan@email.com,099123456,invited,15,500
María López,87654321,,098765432,crew,32,0
```

Columnas disponibles:
- `name` — Nombre completo (requerido)
- `cedula` — Número de cédula
- `email` — Email
- `phone` — Teléfono
- `status` — `invited` / `crew` / `in_process` / `paid` / `no_show`
- `bar_account_slot` — Número de cuenta de barra asignada (1-120)
- `entry_amount` — Monto pagado de entrada

---

## Seguridad

- **Row Level Security (RLS)** activo en todas las tablas
- El rol `bar` solo puede leer y modificar cuentas de barra
- El rol `door` solo puede leer y actualizar asistentes, y cerrar cuentas
- Solo `admin` puede crear/borrar eventos, asistentes y gastos
- La clave `anon` de Supabase es segura de exponer en el frontend con RLS activado
- Las fotos de pago se guardan en Supabase Storage con URL pública (solo legible)
- No hay tokens secretos en el código del cliente

---

## Solución de problemas

**"Configuración requerida" al abrir la app**
→ Completar `SUPABASE_URL` y `SUPABASE_ANON_KEY` en `shared.js`

**"No hay evento activo"**
→ Crear y activar un evento en `/admin.html` → Tab Evento

**Error de permisos al agregar tragos**
→ Verificar que el usuario tenga rol `bar` o `admin` en la tabla `profiles`

**La cámara no abre al cerrar cuenta**
→ La app necesita permiso de cámara en el navegador. Si no está disponible, el cierre continúa sin foto.

**Los cambios no se sincronizan en tiempo real**
→ Verificar que el plan de Supabase tenga Realtime habilitado (el free tier lo incluye)
