# Registro de Aplicaciones (Netlify)

App web en español para llenar el formato "REGISTRO DE APLICACIONES" de David Neufeld (Col. El Capulin, Campo # 8).
Publicada en https://registrosneufeld.netlify.app. Cada commit a la rama principal se publica solo en Netlify.

## Estructura
- `public/`: interfaz sin frameworks ni paso de compilación (`index.html`, `app.js`, `styles.css`, `sw.js` para PWA). Navegación con hash (`#/nuevo`, `#/registros`, `#/editar/:id`, `#/imprimir`, `#/empleados`, `#/catalogos`, `#/formato`, `#/cuenta`).
- `netlify/functions/api.mjs`: toda la API en una Netlify Function (`/api/*`). Los datos están en Netlify Blobs (store `registro-aplicaciones`) como documentos JSON: `users`, `options`, `records`, `settings` y `secret`. Las escrituras usan `mutate()` con `onlyIfMatch`/ETag para no pisar cambios simultáneos.
- `FIELDS` en `api.mjs` define las 13 columnas del formato en orden. La interfaz las lee de `/api/meta`.

## Reglas de la app
- Roles: `admin` ve, edita y borra todos los registros y ve quién los hizo. `empleado` crea registros y solo ve los suyos (sin editar).
- Los campos son opcionales (se puede guardar incompleto; la lista marca "Incompleto"), pero no se acepta un registro sin ningún dato además de la fecha. Los de tipo `option` son dropdowns con búsqueda y un botón "+ Agregar otra opción" al final.
- La hoja de impresión (`#/imprimir`) se puede editar a mano antes de imprimir. Esos cambios no se guardan.
- El dueño pidió que NO aparezcan correos electrónicos en la hoja ni en la configuración.
- Sesión: cookie `sid` firmada con HMAC. Las escrituras requieren el encabezado `X-Requested-With: registro-app`.

## Al hacer cambios
- Cambia `CACHE` en `public/sw.js` (registro-vN) cada vez que modifiques archivos de `public/`, para que los celulares tomen la versión nueva.
- Debe verse bien en celular (iPhone incluido) y en PC.
- Los textos para el usuario van en español.
