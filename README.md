# bakrumAI

Juego de terror procedural estilo Backrooms en el navegador (Three.js).

- **Mundo infinito** generado por chunks con semilla determinista: pasillos, salas, salones y zonas vacías se mezclan en campos de ruido suave. La semilla se puede personalizar desde el menú inicial (y se muestra en el HUD).
- **Multijugador (hasta 6 jugadores)**: la SEMILLA es el código de sala. Quienes escriban la misma semilla caen en el mismo backroom (el mundo es determinista: misma semilla = mismo laberinto para todos). Usa un broker MQTT público (HiveMQ/EMQX) por WebSockets: presencia, posición/linterna a ~12 Hz y la entidad la simula el anfitrión (el de menor id) para que todos la vean sincronizada. Los **objetos recogibles son de un solo jugador** (el primero que los coge los reclama y desaparecen para todos, también para quien entre tarde) y los **dibujos de tiza se ven en toda la sala** en directo.
- **Paredes curvas ocasionales**: de vez en cuando un tramo recto se convierte en una pared lisa que se arquea hacia el pasillo (con colisión sellada: antes dejaban huecos por los que se colaba uno detrás de la pared).
- **Finales de pared enrasados**: los extremos y esquinas de las paredes adoptan el mismo grosor que la propia pared (antes sobresalía un cuadrado más grande junto a paredes finas).
- **Grafitis por todo el backroom**: 100 variantes de frases y símbolos típicos (SMILE!, NO EXIT, NOCLIP, flechas, espirales…) pintados en blanco, negro o rojo sobre las paredes; deterministas, toda la sala ve los mismos. Siempre pegados a la cara real de la pared, nunca sobresalen ni flotan.
- **Paredes inclinadas**: de vez en cuando una sala o salón tiene un tabique recto en ángulo (forma rectangular o trapezoidal, largo/giro/grosor aleatorios) con colisión real: hay que rodearlo y rompe la línea de visión de la entidad.
- **Notas en la pared**: parte de las notas van pegadas a las paredes en variantes distintas (chincheta, cinta adhesiva, papel rasgado, verticales u horizontales, con giros distintos); siguen siendo recogibles y sincronizadas por red.
- **Pilares asimétricos** en salas amplias y salones: posiciones y cantidades aleatorias, sin simetrías.
- **Sin estructuras repetidas**: cada sala es única; no hay hileras de habitaciones idénticas.
- **Oscuridad por zonas**: apagones totales donde solo alumbra la linterna (tecla F), zonas tenues y normales. Las luces de techo iluminan de lejos (radio de 16 m por foco, 64 focos dinámicos a las lámparas más cercanas, sin cambios de brillo al girar la vista) y la linterna es más potente y de más alcance.
- **El monstruo** te persigue: el contacto directo con línea de visión te mata; el flash de la cámara de cualquier jugador lo aturde para toda la sala.
- Muebles con física, tiza para marcar el camino, **50 notas de todo tipo** (diario, consejos, avisos y mensajes de otros exploradores) y objetos recogibles.

## Cómo jugar en multijugador

1. Abre `index.html` (o `backrooms-single-file.html`) en un navegador con conexión.
2. Escribe un **nombre** y una **SEMILLA** (p. ej. `1`): esa semilla es el código de sala.
3. Comparte la semilla con hasta 5 amigos: caerán en el mismo backroom.
4. Si la sala está llena (6/6) o no hay conexión, el juego continúa en solitario.

> Nota: el broker MQTT es público y gratuito (sin cuenta). El límite de 6 jugadores se aplica de la mejor manera posible sin servidor propio: en casos raros de llegadas simultáneas la sala puede superarlo momentáneamente.

## Archivos

- `index.html` — entrada del juego (usa `js/`)
- `backrooms-single-file.html` — versión autocontenida en un solo archivo

## Versión

La versión actual (`v1.8.0`) se muestra en el menú principal y en el HUD. Al hacer cambios:

1. Sube `GAME_VERSION` en `js/game.js` (p. ej. `1.5.0`).
2. Actualiza el `?v=...` de los `<script>`/`<link>` de `index.html` al mismo número (así el navegador descarta la caché vieja y los jugadores ven la versión nueva sin Ctrl+F5).
3. Regenera `backrooms-single-file.html` embebiendo los `js/` actualizados (los `<script>` inline se generan a partir de `js/`).

## Cómo jugar

Abre `index.html` (o `backrooms-single-file.html`) en un navegador moderno.

## Cómo jugar en móvil/tableta

Abre el juego desde el móvil y se activan los controles táctiles automáticamente:

- **Mitad izquierda de la pantalla**: joystick virtual para moverse.
- **Resto de la pantalla**: arrastra para mirar; un toque rápido dispara la cámara (si la llevas equipada) o interactúa con lo que apunte la mira.
- **Botones en pantalla**: 🔦 linterna, 📓 cuaderno, 🗺️ mapa, **E** interactuar, 🏃 correr (mantener pulsado) y ✏️ dibujar con la tiza (mantener pulsado y arrastrar con el otro dedo).
- Las ranuras del cinturón (tiza/cámara/agua/cuaderno) se tocan directamente.
- **Mapa compartido**: el botón 🗺️ (o tecla **M**) abre el mapa del backroom, que se desbloquea al explorar y es **compartido con la sala**: lo que ve cualquier jugador lo veis todos (niebla de guerra sincronizada por MQTT). Arrastra para moverte, botones −/+ para zoom y 🎯 para centrarte en ti.
- Coordenadas, semilla de sala y batería de la linterna son visibles en el HUD móvil.

## Detalles de mundo

- **Cajones reales**: las mesas tienen un pedestal con un cajón hueco que se abre con **[E]**; a veces esconde un objeto que queda **dentro del cajón** (se desliza con él, nunca cae al suelo) y es reclamable por red como cualquier pickup.
- **Puertas falsas (señuelos)**: a escala real (0,9 m sencillas, 1,6 m dobles, 2,05 m de alto), pegadas a las paredes, a veces entornadas o con grafiti: desde lejos parecen una salida que no existe. Deterministas por semilla.
- **Flechas del suelo**: chevrones brillantes que apuntan el camino hacia esas puertas falsas desde 8-34 m de distancia, con línea de visión despejada (nunca apuntan a través de un muro).
- **Salas de seguridad (FNAF)**: refugios raros (~1 de cada 24 chunks) con UNA puerta de metal que sube al techo, alimentada por pilas (se gasta con la puerta cerrada; [E] la abre/cierra y recarga con pilas de repuesto) y un monitor que retransmite en vivo las cámaras de seguridad generadas. Con la puerta cerrada la Entidad no puede verte ni alcanzarte. El estado de la puerta se comparte con la sala.
- **Cámaras de seguridad**: raras, montadas en las paredes; giran la cabeza y encienden su LED rojo cuando te vigilan, y su imagen se ve en el monitor de las salas de seguridad.
- **Pilas almacenables**: mantén **[I]** para recargar la linterna con las pilas de repuesto guardadas; úsalas también para dar energía a las puertas de metal.
- **Callejones sin salida variados**: rectos, en L, anchos, con alcoba lateral o con habitación muerta al fondo (a veces con un pilar que obliga a rodearlo).

## Novedades de v1.8.0

- **La Entidad ya se mueve de verdad**: el grafo de celdas por el que navega (BFS) excluía las celdas de borde de cada chunk, así que en cuanto el destino estaba en otro chunk no encontraba camino y se quedaba clavada. Ahora las puertas entre chunks forman parte del grafo y la Entidad cruza de un chunk a otro para perseguirte o vagar.
- **Cordura ligada a la visión real**: la estabilidad mental ya no drena solo porque la Entidad esté en modo persecución. Drena fuerte (4/s) mientras te ve de cerca, casi nada si va a tu última posición sin verte, y nada cuando te ha perdido. El espectro del multijugador tampoco drena a través de los muros.
- **Armarios apoyados en la cara REAL del muro**: antes la cara se calculaba al revés (la trasera del muro) y con claves de chunk equivocadas: los armarios nacían con el cuerpo metido dentro de la pared y solo se generaban en el chunk (0,0). Ahora se apoyan en la superficie fina de cualquier pared del mundo.
- **Puertas falsas entornadas hacia dentro**: la hoja sencilla abría la mitad de las veces hacia el interior del muro (se veía la puerta entreabierta atravesando la pared). Ahora siempre abre hacia la habitación.
- **Flechas del suelo apuntando a las puertas**: apuntaban PERPENDICULARES a la puerta (todas hacia el mismo lado). Ahora la punta señala el camino real. Además bajan de 5 cm a 1,8 cm sobre la moqueta (ya no parecen flotar).
- **Mesas y sillas más coherentes**: la mayoría nacen de pie y alineadas con la rejilla del mundo (0/90/180/270); las poses patas-arriba pasan a ser las más raras (antes 4 de cada 10 mesas nacían tumbadas o patas arriba).
- **Mapa sin muros fantasma**: en los chunks lejanos el mapa dibujaba cuadrados negros por celdas de muro que en el 3D no existen (postes aislados eliminados) o desplazados (juntas de borde centradas). La aproximación ahora imita los muros reales: láminas en su sitio, postes solo si tocan pared, núcleos macizos completos y juntas pegadas al borde.
- **Paredes y techo sin parpadeo ni textura estirada**: las cajas de pared ya no quedan coplanares con el plano del techo (z-fighting en el filo superior de todos los muros) y el papel pintado se repite cada 2,8 m en TODAS las caras (postes y tramos cortos ya no muestran el estampado a otra escala). Los tabiques diagonales tienen tapas con textura correcta (antes una franja estirada de un píxel).
- **Techo de losetas acústicas**: nueva textura de falso techo con losetas biseladas, rehundidas y porosas en vez de la losa plana con una cruz.
- **Puerta de metal sin colgar del techo**: al abrirse subía hasta 2,42 m y quedaba un trozo de puerta colgando bajo el techo; ahora se oculta tras el plano del techo.
- **Primera aparición de la Entidad a ~50 s**: antes el contador arrancaba en 50 y la primera aparición se retrasaba hasta ~100 s.

## Novedades de v1.7.1

- **Puertas dobles con las dos hojas dentro del marco**: la hoja derecha se construía hacia el lado equivocado y colgaba pegada por FUERA de la jamba ("la puerta 2 no está ni en el marco"). Ahora su bisagra está en la jamba derecha y cierra hacia el centro, como la izquierda.

## Novedades de v1.7.0

- **Compañeros visibles a través de las paredes**: si un muro tapa a otro jugador, su fantasma translúcido del color de su chaqueta se ve a través del muro (ya no se pierden de vista entre pasillos).
- **Paredes diagonales sólidas por ambos lados**: antes, al mirarlas desde detrás (o desde el bolsillo que forman), desaparecían y se veían las salas y jugadores de detrás ("entre las paredes se ven los jugadores").
- **Mesas caídas apoyadas planas en la moqueta**: antes rotaban mal y quedaban medio flotando apoyadas en el canto del tablero, con las patas en el aire. Ahora reposan sobre toda su cara lateral y su **cajón se abre** (hacia arriba) y puede esconder un objeto reclamable.
- **Semillas con letras de verdad**: "casa", "Casa" o "CÁSA" generan el MISMO mundo (se normalizan mayúsculas y tildes) y el HUD muestra el código de sala tal cual se escribió, listo para compartir.
- **Mundo 100% determinista entre jugadores**: los muebles, armarios, objetos y flechas se colocan siempre en los mismos sitios para toda la sala (antes dependían de qué trozos vecinos estuvieran cargados y cada jugador podía ver paredes/cosas distintas: "yo veo cosas que los otros no").
- **Flechas del suelo arregladas**: ya no parpadean "dentro y fuera del suelo" (z-fighting con la moqueta) ni se duplican apiladas al recargar trozos; toda la sala ve exactamente las mismas.
- **Mapa fiel a la realidad también en la distancia**: los muros reales (finos, curvos, inclinados y pilares) se conservan y dibujan aunque el trozo esté descargado; ya no aparece una "pared que no existe" por la que se camina en el 3D.
- **Multijugador más robusto**: al volver a entrar tras cerrar la pestaña ya no apareces como otro jugador duplicado con tu mismo nombre (se limpia tu presencia anterior); si el broker se micro-corta, los demás no te ven arrastrarte en cámara lenta (la interpolación se congela hasta que llegan datos nuevos); y se publica solo cuando hay movimiento real, así la sala llena va más fluida.

## Novedades de v1.6.0

- **La Entidad ya no atraviesa paredes**: navega por la rejilla de celdas transitables (BFS) con deslizamiento por ejes contra muros, tabiques y muebles; nunca se cruza un muro ni te persigue a través de ellos. Además es menos invasiva: vaga más lenta, aparece más lejos, se pierde si pierde tu rastro y desaparece si te alejas demasiado (vuelve a aparecer más tarde).
- **Mapa fiel a la realidad**: el mapa compartido dibuja las PAREDES REALES (finas, inclinadas y curvas) en vez de celdas negras macizas: ya no se camina por "partes negras" que en el juego son suelo libre.
- **Grafitis-guía**: cuando aparece una puerta falsa, se pintan flechas grandes con SALIDA / POR AQUÍ en las paredes con línea de visión hacia ella, apuntando en su dirección.
- **Puertas falsas raras** (~1 de cada 6 chunks) y con mejor modelo: hojas con bisagra real en su canto y dobles puertas de verdad (dos hojas que cierran al centro).
- **Paredes en diagonal con textura correcta**: los tabiques rectangulares usan la textura del papel pintado repetida por celda (antes salía estirada). Más esquinas recortadas, contrafuertes y tabiques sueltos: el mundo ya no parece hecho solo de cuadrados.
- **Pasillos de ancho variable**: un mismo pasillo puede estrecharse o ensancharse a mitad de recorrido.
- **Cajón con hueco real**: el pedestal de la mesa es hueco de verdad y la bandeja sale por una boca abierta (antes parecía atravesar un bloque macizo). Las mesas caídas de lado conservan su cajón (abre hacia arriba); solo las patas-arriba y volcadas no tienen cajón (antes la bandeja se hundía en el suelo o flotaba).
- **Tiza de colores**: el rojo y el negro se dibujan de su color (antes todo salía blanco).
- **Multijugador más robusto**: si minimizas la pestaña ya no te echan de la sala (latido de presencia en segundo plano + reconexión automática), y los demás jugadores te ven de frente (antes veían tu espalda y la linterna apuntaba hacia atrás).