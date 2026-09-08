# bakrumAI

Juego de terror procedural estilo Backrooms en el navegador (Three.js).

- **Mundo infinito** generado por chunks con semilla determinista: pasillos, salas, salones y zonas vacías se mezclan en campos de ruido suave. La semilla se puede personalizar desde el menú inicial (y se muestra en el HUD).
- **Multijugador (hasta 6 jugadores)**: la SEMILLA es el código de sala. Quienes escriban la misma semilla caen en el mismo backroom (el mundo es determinista: misma semilla = mismo laberinto para todos). Usa un broker MQTT público (HiveMQ/EMQX) por WebSockets: presencia, posición/linterna a ~12 Hz y la entidad la simula el anfitrión (el de menor id) para que todos la vean sincronizada.
- **Paredes curvas ocasionales**: de vez en cuando un tramo recto se convierte en una pared lisa que se arquea hacia el pasillo (con colisión sellada: antes dejaban huecos por los que se colaba uno detrás de la pared).
- **Pilares asimétricos** en salas amplias y salones: posiciones y cantidades aleatorias, sin simetrías.
- **Sin estructuras repetidas**: cada sala es única; no hay hileras de habitaciones idénticas.
- **Oscuridad por zonas**: apagones totales donde solo alumbra la linterna (tecla F), zonas tenues y normales. Las luces de techo ahora iluminan de lejos (radio de 16 m por foco, 18 focos dinámicos) y la linterna es más potente y de más alcance.
- **El monstruo** te persigue: el contacto directo con línea de visión te mata; el flash de la cámara de cualquier jugador lo aturde para toda la sala.
- Muebles con física, tiza para marcar el camino, notas de lore y objetos recogibles.

## Cómo jugar en multijugador

1. Abre `index.html` (o `backrooms-single-file.html`) en un navegador con conexión.
2. Escribe un **nombre** y una **SEMILLA** (p. ej. `1`): esa semilla es el código de sala.
3. Comparte la semilla con hasta 5 amigos: caerán en el mismo backroom.
4. Si la sala está llena (6/6) o no hay conexión, el juego continúa en solitario.

> Nota: el broker MQTT es público y gratuito (sin cuenta). El límite de 6 jugadores se aplica de la mejor manera posible sin servidor propio: en casos raros de llegadas simultáneas la sala puede superarlo momentáneamente.

## Archivos

- `index.html` — entrada del juego (usa `js/`)
- `backrooms-single-file.html` — versión autocontenida en un solo archivo

## Cómo jugar

Abre `index.html` (o `backrooms-single-file.html`) en un navegador moderno.