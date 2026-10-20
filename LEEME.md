# Registro de Aplicaciones en Netlify

Esta versión es la misma app, adaptada para Netlify:

- Las pantallas se publican como sitio en Netlify.
- El servidor corre como una **Netlify Function** (`netlify/functions/api.mjs`).
- Los registros, cuentas y opciones se guardan en **Netlify Blobs**, el almacenamiento incluido en Netlify. No hay que contratar una base de datos aparte.

Al terminar tendrás una dirección como `https://registro-neufeld.netlify.app`. Funciona en la PC y en el celular, y en el celular se puede instalar como app.

> **Importante:** arrastrar la carpeta a "Netlify Drop" **no funciona** para esta app, porque Netlify tiene que instalar la parte del servidor. Usa uno de estos dos caminos.

## Camino 1: con GitHub (sin instalar nada)

1. Crea una cuenta en https://github.com (gratis).
2. Crea un repositorio nuevo, por ejemplo `registro-aplicaciones` (puede ser privado).
3. En el repositorio, entra a **Add file → Upload files** y arrastra **todo el contenido** de esta carpeta: `netlify.toml`, `package.json`, `LEEME.md` y las carpetas `public` y `netlify`. Presiona **Commit changes**.
4. Entra a https://app.netlify.com con tu cuenta (puedes entrar con GitHub).
5. Elige **Add new project → Import an existing project → GitHub** y selecciona el repositorio.
6. Deja la configuración como aparece (Netlify la lee de `netlify.toml`) y presiona **Deploy**.
7. Opcional: en **Project configuration → Change project name** pon un nombre fácil, por ejemplo `registro-neufeld`.

Cada vez que cambies un archivo en GitHub, Netlify publica la nueva versión solo.

## Camino 2: desde tu PC con la terminal

Necesitas Node.js 20 o más nuevo (https://nodejs.org). En esta carpeta ejecuta:

```
npm install
npx netlify-cli login
npx netlify-cli deploy --build --prod
```

La primera vez te pregunta si quieres crear un sitio nuevo. Contesta que sí y escribe el nombre.

## Primer uso

1. Abre la dirección de tu sitio.
2. Entra con el usuario **admin** y la contraseña **admin123**. La app te pide cambiarla en ese momento.
3. En **Empleados**, crea una cuenta para cada trabajador.
4. En el celular, abre la misma dirección y elige **Agregar a pantalla de inicio**: en Safari está en el botón Compartir y en Chrome en el menú ⋮.

Si quieres otra contraseña inicial **antes** del primer uso, en Netlify entra a **Project configuration → Environment variables** y agrega `ADMIN_USER` y `ADMIN_PASSWORD`. Después vuelve a publicar.

## Respaldos

Desde **Todos los registros → Descargar Excel (CSV)** bajas todos los registros con quién los hizo. Te recomiendo hacerlo cada semana o cada mes.
