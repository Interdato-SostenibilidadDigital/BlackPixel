# Seguridad

Para comunicar una vulnerabilidad, escribe a **contacto@interdato.com** con el repositorio, la versión o commit afectado, el impacto y pasos mínimos para reproducirla. No publiques credenciales, datos personales ni pruebas con información sensible en issues o pull requests públicos.

## Controles de este repositorio

- El workflow **Security** busca secretos en el historial git disponible en cada push y pull request; también puede ejecutarse manualmente y semanalmente.
- El escáner se descarga en una versión fija y se comprueba su SHA-256 antes de ejecutarlo. Sus resultados ocultan los valores detectados.
- Los nuevos controles de CI usan permisos de lectura y no reciben claves de servicios externos.
- Dependabot propone actualizaciones semanales de las acciones de GitHub. Las propuestas requieren revisión; no se fusionan automáticamente.

Estos controles detectan clases concretas de problemas y no sustituyen una revisión del cambio, los permisos de la cuenta o la configuración del hosting. El estado verde de CI no es una certificación de seguridad.

## Uso de BlackPixel

- Instala con `npm ci` en una versión de Node.js compatible. El navegador Chromium se descarga durante la instalación; conserva su sandbox al analizar sitios.
- El workflow **Tests** comprueba el conteo exacto, la exclusión del distintivo, el historial, los reportes y la instalación del footer. También ejecuta `npm audit` sobre las dependencias de producción.
- El footer generado contiene una imagen SVG y un enlace, sin scripts. Restringe los enlaces a HTTP(S), impide acceso a `window.opener` y evita enviar la URL visitante mediante Referer.
- Los reportes bloquean scripts con una política CSP. La captura limita dimensiones y tiempo; una página que supera los límites produce un error en lugar de publicar un porcentaje parcial.
- Analiza páginas públicas sin información sensible. Las capturas y los JSON conservan contenido visible, URL completa y parámetros; revisa estos archivos antes de publicarlos.
- Esta es una CLI local, no un servicio público de análisis de URLs. Exponerla como API requiere aislamiento del proceso y controles de red contra SSRF, además de autenticación, cuotas y límites de concurrencia.
- Dependabot también propone actualizaciones de npm. Una actualización del navegador puede cambiar el renderizado; comprueba los resultados antes de publicar una nueva medición.
