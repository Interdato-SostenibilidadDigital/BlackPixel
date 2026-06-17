# BlackPixel

BlackPixel es una herramienta de línea de comandos para analizar qué porcentaje
de una página web está compuesto por píxeles negros puros (`#000000`).

La idea del proyecto es ayudar a equipos de diseño y desarrollo a visualizar
qué tan cerca está una interfaz de una experiencia más oscura y potencialmente
más eficiente en pantallas OLED/AMOLED.

> Importante: BlackPixel no mide consumo eléctrico real. Calcula la presencia
> visual de negro puro en una captura de pantalla. El ahorro energético depende
> del tipo de pantalla, brillo, contenido, dispositivo y comportamiento del
> usuario. El beneficio del negro puro es más claro en pantallas OLED/AMOLED,
> donde los píxeles negros pueden apagarse o consumir mucho menos energía. En
> pantallas LCD, el impacto suele ser mucho menor porque existe una
> retroiluminación activa.

## Cómo Funciona

BlackPixel usa Puppeteer para abrir un sitio web, toma una captura completa de
la página y después analiza la imagen con Jimp. El resultado indica:

- porcentaje de píxeles negros puros (`#000000`);
- cantidad total de píxeles analizados;
- estado de sostenibilidad visual según un semáforo;
- recomendación general para mejorar la presencia de negro.

## Semáforo BlackPixel

| Porcentaje de negro puro | Estado | Interpretación |
| --- | --- | --- |
| 66% o más | VERDE | Alta presencia de negro puro. Buen punto de partida para interfaces más eficientes en OLED/AMOLED. |
| 33% a 65.99% | AMARILLO | Presencia media de negro puro. Hay oportunidad de oscurecer fondos, secciones y superficies principales. |
| Menos de 33% | ROJO | Baja presencia de negro puro. La interfaz podría usar más áreas `#000000` si el objetivo es reducir consumo en OLED/AMOLED. |

## Instalación

Necesitas tener instalado Node.js.

```powershell
npm install
```

## Uso

Analiza cualquier sitio pasando su URL:

```powershell
npm run analyze -- https://tu-sitio.com
```

También puedes ejecutar el script directamente:

```powershell
node black-pixel-analyzer.js https://tu-sitio.com
```

La URL debe incluir el protocolo (`https://` o `http://`).

## Ejemplo De Resultado

```text
URL: https://example.com
Captura: page.png
Tamaño de imagen: 1200x800
Píxeles negros puros (#000000): 0 / 960000
Porcentaje de negro puro: 0.00%
Estado BlackPixel: ROJO
Recomendación: Baja presencia de negro puro. Considera usar más áreas #000000 si el objetivo es reducir consumo en OLED/AMOLED.
```

Cada ejecución genera una captura local llamada `page.png`. Esta imagen queda
fuera de git porque es un archivo generado.

## Por Qué Negro Puro

En pantallas OLED/AMOLED, cada píxel emite su propia luz. Por eso, los colores
oscuros y especialmente el negro puro pueden reducir el consumo del panel frente
a interfaces claras. En LCD, en cambio, la retroiluminación suele mantenerse
activa aunque el contenido sea oscuro, por lo que el ahorro no es equivalente.

Este proyecto usa `#000000` de forma intencional porque el negro puro es el caso
más directo para promover interfaces con menor emisión de luz en OLED/AMOLED.

## Referencias

- ResearchGate: figura sobre consumo de potencia ajustado para componentes RGB
  de un píxel OLED:
  https://www.researchgate.net/figure/Linear-fitted-power-consumption-for-the-R-G-and-B-components-of-an-OLED-pixel-by_fig2_311759321
- Dash, P. y Hu, Y. C. (2021). "How much battery does dark mode save? An
  Accurate OLED Display Power Profiler for Modern Smartphones". ACM MobiSys
  2021. DOI: https://doi.org/10.1145/3458864.3467682
- Purdue University: resumen de investigación sobre ahorro de batería en modo
  oscuro y pantallas OLED:
  https://www.purdue.edu/newsroom/archive/releases/2021/Q3/dark-mode-may-not-save-your-phones-battery-life-as-much-as-you-think%2C-but-there-are-a-few-silver-linings.html

## Limitaciones

- BlackPixel mide una captura renderizada, no el CSS directamente.
- Solo cuenta píxeles exactamente `#000000`; grises muy oscuros como `#111111`
  no cuentan como negro puro.
- El porcentaje puede cambiar si el sitio muestra banners, cookies, anuncios,
  contenido dinámico o estados personalizados por ubicación.
- El resultado debe interpretarse como una métrica de conciencia y diseño, no
  como una certificación ambiental.
